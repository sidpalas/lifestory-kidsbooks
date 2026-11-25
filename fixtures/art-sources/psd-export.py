# Writes a layer export (the input of packages/core/src/story-from-export.ts) from an illustrator's layered PSDs.
# Runs on the machine that has the art; the art and the export stay out of this repository.
#
#   python3 -I fixtures/art-sources/psd-export.py --config <export config.json> --out <export dir> [--sheet <contact.jpg>]
#
# Needs psd-tools, pillow, numpy and scipy (a throwaway venv: python3 -m venv /tmp/psdvenv && /tmp/psdvenv/bin/pip
# install psd-tools pillow numpy scipy). Reads every PSD, writes nothing next to them.
#
# Each PSD has three top-level groups (names configurable): "plate" (the scene without the hero, complete behind it),
# "hero" (the bald hero, merged bottom to top) and "foreground" (each visible layer with pixels is one occluder). Every
# page is cover-fitted to the print sheet (scale until it is filled, centre, crop the overflow equally from both sides),
# with one transform for the plate, the hero and the occluders.
#
# The config (paths relative to it; see .agents/skills/preparing-layered-art/SKILL.md for an example):
#   canvas        [width, height] of the sheet in px, trim plus bleed (10x8 in + 0.125 in bleed at 300 ppi: [3075, 2475])
#   pages         [{pageId, psd | image | white: true, notes?}]: a PSD page, or a flat plate from an image (or a PSD
#                 flattened whole, via "flat": true), or a white page; notes are copied into export.json
#   groups        optional {plate, hero, foreground}; heroSkip: hero layers left out of hero.png (trace layers, masks)
#   headLayer     optional layer whose bounds are the head box (default "original head hole"); otherwise the largest
#                 connected area of the "skin" hero layer, marked as an estimate
#   occluders     {"<layer name>": {slug, kind}} for every page, and pageOccluders {pageId: {...}} per page.
#                 kind "scenery" goes over the redrawn hero; "hero" (the figure's own hat or helmet) is merged into the
#                 bald reference. Layers named "occluder: scenery (...)" or "occluder: hero (...)" need no entry.
#   copy          optional {"<source file>": "<name in the export>"} copied as text with textReplacements applied, and
#                 copyDirs {"<source dir>": "<dir in the export>"} copied as they are
#   photocraft    optional path of photocraft-cli, used to flatten "flat" PSDs (psd-tools' composite otherwise)
import argparse, json, os, re, shutil, subprocess, sys, tempfile

import numpy as np
from PIL import Image, ImageDraw
from psd_tools import PSDImage
from scipy import ndimage

p = argparse.ArgumentParser()
p.add_argument("--config", required=True)
p.add_argument("--out", required=True)
p.add_argument("--sheet", help="also write a contact sheet of every page (plate + hero + occluders) here")
args = p.parse_args()
cfg = json.load(open(args.config))
base = os.path.dirname(os.path.abspath(args.config))
path = lambda f: os.path.join(base, f)
CW, CH = cfg["canvas"]
G = {"plate": "plate", "hero": "hero", "foreground": "foreground", **cfg.get("groups", {})}
SKIP = set(cfg.get("heroSkip", ["re-ink", "skin fill", "skin (neutral grey)"]))
HEAD = cfg.get("headLayer", "original head hole")
ALPHA_MIN = 26  # hero.png keeps alpha >= 0.1


def fit(W, H):
    s = max(CW / W, CH / H)
    sw, sh = max(CW, round(W * s)), max(CH, round(H * s))
    return s, sw, sh, (sw - CW) // 2, (sh - CH) // 2


def to_sheet_rgb(im):
    s, sw, sh, ox, oy = fit(*im.size)
    return im.convert("RGB").resize((sw, sh), Image.LANCZOS).crop((ox, oy, ox + CW, oy + CH))


def to_sheet_rgba(im):
    """Resize premultiplied (no dark fringes), return the whole scaled image and its crop to the sheet."""
    s, sw, sh, ox, oy = fit(*im.size)
    big = im.convert("RGBa").resize((sw, sh), Image.LANCZOS).convert("RGBA")
    return big, big.crop((ox, oy, ox + CW, oy + CH))


def to_sheet_box(b, W, H):
    s, sw, sh, ox, oy = fit(W, H)
    x0, y0, x1, y1 = b
    r = [int(np.floor(x0 * s - ox)), int(np.floor(y0 * s - oy)), int(np.ceil(x1 * s - ox)), int(np.ceil(y1 * s - oy))]
    return [max(0, r[0]), max(0, r[1]), min(CW, r[2]), min(CH, r[3])]


def clear(im):
    a = np.asarray(im).copy()
    a[a[..., 3] == 0] = 0  # no colour under fully transparent pixels: smaller files, nothing hidden
    return Image.fromarray(a)


def full(layer, size):
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    if layer.width > 0 and layer.height > 0:
        im.paste(layer.topil().convert("RGBA"), (layer.left, layer.top))
    return im


def merge(group, size):
    """Visible layers bottom to top, normal blend, with opacity and clipping (clipped to the last unclipped layer)."""
    out, base_a, merged = Image.new("RGBA", size, (0, 0, 0, 0)), None, []
    for l in group:
        if l.is_group() or not l.visible or l.width == 0 or l.name in SKIP:
            continue
        if l.blend_mode.name not in ("NORMAL", "PASS_THROUGH"):
            sys.exit(f"{group.name}/{l.name}: blend mode {l.blend_mode.name} isn't supported; use normal")
        a = np.asarray(full(l, size)).astype(np.float32)
        a[..., 3] *= l.opacity / 255
        if l.clipping and base_a is not None:
            a[..., 3] *= base_a
        else:
            base_a = a[..., 3] / 255
        out = Image.alpha_composite(out, Image.fromarray(a.round().clip(0, 255).astype(np.uint8)))
        merged.append(l.name + (" (clipped)" if l.clipping else ""))
    return out, merged


def flatten(src):
    if src.lower().endswith((".psd", ".psb")):
        if cfg.get("photocraft"):
            with tempfile.TemporaryDirectory() as t:
                subprocess.run([cfg["photocraft"], "convert", src, os.path.join(t, "flat.png")], check=True,
                               capture_output=True)
                im = Image.open(os.path.join(t, "flat.png")); im.load()
                return im
        return PSDImage.open(src).composite()
    im = Image.open(src); im.load()
    return im


def band(hero, plate):
    """Mean width in px of the hero's rim that is copied background: pixels next to its edge matching the plate."""
    h = np.asarray(hero).astype(np.float32); pl = np.asarray(plate).astype(np.float32)
    a = h[..., 3] > 25
    if not a.any():
        return 0.0
    match = a & (np.abs(h[..., :3] - pl).mean(-1) < 14)
    lab, _ = ndimage.label(match)
    edge = a & ~ndimage.binary_erosion(a)
    touching = np.unique(lab[edge & match])
    return float(np.isin(lab, touching[touching > 0]).sum() / max(edge.sum(), 1))


def occluder_name(pid, name):
    o = cfg.get("pageOccluders", {}).get(pid, {}).get(name) or cfg.get("occluders", {}).get(name)
    if o:
        return o["slug"], o["kind"]
    m = re.match(r"occluder: (scenery|hero) \((.+)\)$", name)
    if m:
        return re.sub(r"[^a-z0-9]+", "-", m.group(2).lower()).strip("-"), m.group(1)
    sys.exit(f'{pid}: foreground layer "{name}" needs an entry in "occluders" or "pageOccluders" (slug and kind)')


if os.path.exists(args.out):
    shutil.rmtree(args.out)
os.makedirs(args.out)
pages, warnings, flats = [], [], []
for spec in cfg["pages"]:
    pid = spec["pageId"]
    d = os.path.join(args.out, "pages", pid)
    os.makedirs(d)
    e = {"pageId": pid, "source": None, "hero": None, "occluders": [], "occluderKinds": {}, "notes": list(spec.get("notes", []))}
    if spec.get("white"):
        plate = Image.new("RGB", (CW, CH), (255, 255, 255))
        e["notes"].append("white page")
    elif "image" in spec or spec.get("flat"):
        src = path(spec.get("image") or spec["psd"])
        e["source"] = os.path.relpath(src, base)
        im = flatten(src)
        plate = to_sheet_rgb(Image.alpha_composite(Image.new("RGBA", im.size, (255, 255, 255, 255)), im.convert("RGBA")))
        e["notes"].append(f"flat page, {im.size[0]}x{im.size[1]} scaled x{fit(*im.size)[0]:.4f}")
    else:
        src = path(spec["psd"])
        e["source"] = os.path.relpath(src, base)
        psd = PSDImage.open(src)
        W, H = psd.size
        s, sw, sh, ox, oy = fit(W, H)
        e["notes"].append(f"PSD {W}x{H} scaled x{s:.4f}, cropped {ox} px from left and right, {oy} px from top and bottom")
        groups = {g.name: g for g in psd if g.is_group()}
        for k in ("plate", "hero"):
            if G[k] not in groups:
                sys.exit(f"{pid}: {e['source']} has no top-level group \"{G[k]}\"")
        # The plate is exported whole even where a layer is hidden: it has to be complete behind the hero.
        plate_full = Image.new("RGBA", (W, H), (255, 255, 255, 255))
        for l in groups[G["plate"]].descendants():
            if not l.is_group():
                plate_full = Image.alpha_composite(plate_full, full(l, (W, H)))
                if not l.visible:
                    e["notes"].append(f'plate layer "{l.name}" is hidden in the PSD; exported anyway')
        plate = to_sheet_rgb(plate_full)
        hero_full, merged = merge(groups[G["hero"]], (W, H))
        if merged:
            big, hero = to_sheet_rgba(hero_full)
            lost = np.asarray(big)[..., 3] >= ALPHA_MIN
            lost[oy:oy + CH, ox:ox + CW] = False
            if lost.any():
                warnings.append(f"{pid}: the cover-fit crop cuts {int(lost.sum())} px off the hero")
            a = np.asarray(hero).copy()
            a[a[..., 3] < ALPHA_MIN] = 0
            hero = Image.fromarray(a)
            bb = hero.getchannel("A").getbbox()
            clear(hero.crop(bb)).save(os.path.join(d, "hero.png"), optimize=True)
            layers = {l.name: l for l in psd.descendants() if not l.is_group()}
            if HEAD in layers and layers[HEAD].width > 0:
                head = to_sheet_box(layers[HEAD].bbox, W, H)
            elif "skin" in layers and layers["skin"].width > 0:
                skin = np.asarray(full(layers["skin"], (W, H)))[..., 3] > 128
                lab, n = ndimage.label(skin)
                biggest = lab == (np.argmax(ndimage.sum(skin, lab, range(1, n + 1))) + 1)
                ys, xs = np.nonzero(biggest)
                head = to_sheet_box((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1), W, H)
                warnings.append(f"{pid}: no \"{HEAD}\" layer; head box estimated from the largest skin area")
            else:
                sys.exit(f'{pid}: no "{HEAD}" layer and no "skin" layer to estimate the head from')
            e["hero"] = {"box": list(bb), "head": head}
            e["notes"].append("hero.png = " + " + ".join(merged))
            w = band(Image.fromarray(np.asarray(hero)), plate)
            if w > 4:
                warnings.append(f"{pid}: hero.png has a band of background about {w:.0f} px wide around the figure")
            hero_mask = np.zeros((CH, CW), bool)
            hero_mask[bb[1]:bb[3], bb[0]:bb[2]] = np.asarray(hero)[bb[1]:bb[3], bb[0]:bb[2], 3] > 0
        fg = groups.get(G["foreground"])
        if fg is not None and not fg.visible and any(l.width > 0 for l in fg.descendants()):
            warnings.append(f'{pid}: the "{G["foreground"]}" group is hidden in the PSD, so its layers were not exported')
        n = 0
        for l in (fg.descendants() if fg is not None and fg.visible else []):
            if l.is_group() or l.width == 0 or not l.visible:
                continue
            slug, kind = occluder_name(pid, l.name)
            n += 1
            fn = f"{n:02d}-{slug}.png"
            os.makedirs(os.path.join(d, "occluders"), exist_ok=True)
            oc = clear(to_sheet_rgba(full(l, (W, H)))[1])
            oc.save(os.path.join(d, "occluders", fn), optimize=True)
            e["occluders"].append(fn)
            e["occluderKinds"][fn] = kind
            cover = int(((np.asarray(oc)[..., 3] > 25) & hero_mask).sum()) if e["hero"] else 0
            e["notes"].append(f'occluders/{fn}: layer "{l.name}", {kind}, covers {cover} hero px')
            if e["hero"] and cover == 0:
                warnings.append(f"{pid}: occluder {fn} covers none of the hero")
    plate.save(os.path.join(d, "plate.jpg"), quality=92)
    pages.append(e)
    if args.sheet:
        im = plate.convert("RGBA")
        if e["hero"]:
            im.alpha_composite(Image.open(os.path.join(d, "hero.png")), tuple(e["hero"]["box"][:2]))
        for fn in e["occluders"]:
            im = Image.alpha_composite(im, Image.open(os.path.join(d, "occluders", fn)))
        t = im.convert("RGB").resize((480, round(480 * CH / CW)), Image.LANCZOS)
        dr = ImageDraw.Draw(t)
        if e["hero"]:
            k = 480 / CW
            dr.rectangle([v * k for v in e["hero"]["box"]], outline=(255, 0, 0))
            dr.rectangle([v * k for v in e["hero"]["head"]], outline=(0, 255, 255))
        label = f"{pid} {'hero ' if e['hero'] else ''}occ {len(e['occluders'])}"
        dr.rectangle([0, 0, len(label) * 6 + 8, 14], fill=(0, 0, 0))
        dr.text((4, 2), label, fill=(255, 255, 0))
        flats.append(t)
for src, dst in cfg.get("copy", {}).items():
    s = open(path(src), encoding="utf-8").read()
    for a, b in cfg.get("textReplacements", {}).items():
        s = s.replace(a, b)
    open(os.path.join(args.out, dst), "w", encoding="utf-8").write(s)
for src, dst in cfg.get("copyDirs", {}).items():
    shutil.copytree(path(src), os.path.join(args.out, dst))
json.dump({"canvas": [CW, CH], "pages": pages, "warnings": warnings},
          open(os.path.join(args.out, "export.json"), "w"), indent=2, ensure_ascii=False)
if args.sheet and flats:
    cols = 6
    th = flats[0].height
    sheet = Image.new("RGB", (cols * 490, -(-len(flats) // cols) * (th + 10)), (25, 25, 25))
    for i, t in enumerate(flats):
        sheet.paste(t, ((i % cols) * 490, (i // cols) * (th + 10)))
    sheet.save(args.sheet, quality=85)
for e in pages:
    print(e["pageId"], e["source"] or "white", "hero" if e["hero"] else "-", " ".join(e["occluders"]))
print("\n".join(["warnings:"] + warnings) if warnings else "no warnings")
