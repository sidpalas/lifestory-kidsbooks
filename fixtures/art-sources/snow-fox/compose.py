# Lays out The Fox and the Red Hat's pages from the generated art (gen.mjs) as full-canvas RGBA layers, one folder per
# page, for build-psds.mjs to stack into PSDs: plate.png, hero.png (bald), hero-hat.png (p01's own hat),
# occluder-<slug>.png (scenery over the child), front-of-<slug>.png (where the child's arm or held prop comes in front
# of that occluder: not part of the book format yet, kept in a "front zones" group the export skips) and
# head-hole.png (the head box). Also writes preview.png, the page as the stock child would look.
#   python3 -I fixtures/art-sources/snow-fox/compose.py <raw dir> <layers dir>
import os, sys

import numpy as np
from PIL import Image
from scipy import ndimage

raw, out = sys.argv[1], sys.argv[2]
S = 2625  # 8.5 x 8.5 in trim plus 0.125 in bleed, at 300 ppi


def load(name):
    return Image.open(os.path.join(raw, name)).convert("RGBA")


def blank():
    return Image.new("RGBA", (S, S), (0, 0, 0, 0))


def tight(im):
    """Alpha below 0.1 cleared, colour under it cleared."""
    a = np.asarray(im).copy()
    a[a[..., 3] < 26] = 0
    return Image.fromarray(a)


def place(im, box, x, y, height=None, width=None, angle=0, flip=False):
    """Crop im to box (fractions of im), scale to height or width (fractions of the page), rotate, then put its
    top-left at (x, y) (fractions of the page). Returns the full-canvas layer and the transform for points."""
    W, H = im.size
    crop = im.crop((round(box[0] * W), round(box[1] * H), round(box[2] * W), round(box[3] * H)))
    if flip:
        crop = crop.transpose(Image.FLIP_LEFT_RIGHT)
    k = (height * S / crop.height) if height else (width * S / crop.width)
    crop = crop.convert("RGBa").resize((round(crop.width * k), round(crop.height * k)), Image.LANCZOS)
    if angle:
        crop = crop.rotate(angle, resample=Image.BICUBIC, expand=True)
    layer = blank()
    layer.paste(crop.convert("RGBA"), (round(x * S), round(y * S)))
    return tight(layer)


def mask_layer(layer, keep):
    a = np.asarray(layer).copy()
    a[~keep] = 0
    return Image.fromarray(a)


def rect(x0, y0, x1, y1):
    m = np.zeros((S, S), bool)
    m[round(y0 * S):round(y1 * S), round(x0 * S):round(x1 * S)] = True
    return m


def abox(im):
    """The bounds of alpha >= 0.1, as fractions of im."""
    m = np.asarray(im)[..., 3] >= 26
    ys, xs = np.nonzero(m)
    return (xs.min() / im.width, ys.min() / im.height, (xs.max() + 1) / im.width, (ys.max() + 1) / im.height)


def skin_of(layer):
    a = np.asarray(layer).astype(int)
    return (a[..., 3] > 200) & (a[..., 0] > 170) & (a[..., 1] > 0.52 * a[..., 0]) & (a[..., 1] < 170) & (a[..., 2] < 130)


def head_of(layer, extra=None):
    """The head box: the largest skin-coloured area (the bald head), joined with extra (a hat) when given."""
    skin = skin_of(layer)
    lab, n = ndimage.label(ndimage.binary_opening(skin, iterations=2))
    sizes = ndimage.sum(skin, lab, range(1, n + 1))
    ys, xs = np.nonzero(lab == sizes.argmax() + 1)
    box = [xs.min() / S, ys.min() / S, (xs.max() + 1) / S, (ys.max() + 1) / S]
    if extra is not None:
        e = bbox(extra)
        box = [min(box[0], e[0]), min(box[1], e[1]), max(box[2], e[2]), max(box[3], e[3])]
    return tuple(box)


def bbox(layer):
    return np.asarray(layer.getchannel("A").getbbox()) / S


def plate(name):
    return load(name).convert("RGB").resize((S, S), Image.LANCZOS).convert("RGBA")


pages = {}

# p01: standing, front view, arms wide, a big grin. The red bobble hat is the figure's own (occluder: hero).
p = {"plate": plate("p01-plate.png")}
hero = place(load("p01-hero.png"), (0, 0, 1, 1), 0.32, 0.13, height=0.6)
b = bbox(hero)
fw, fh = b[2] - b[0], b[3] - b[1]
# The hat: everything in the top of the figure outside the face (the crown, the pompom and the flaps over the ears).
# The face is the largest skin-coloured area, closed and filled so eyebrows and eyes stay in it.
skin = skin_of(hero)
lab, n = ndimage.label(ndimage.binary_opening(skin, iterations=2))
face = lab == ndimage.sum(skin, lab, range(1, n + 1)).argmax() + 1
face = ndimage.binary_fill_holes(ndimage.binary_closing(face, iterations=8))
top = rect(b[0] + 0.22 * fw, b[1], b[0] + 0.78 * fw, b[1] + 0.30 * fh)
hat = top & (np.asarray(hero)[..., 3] > 25) & ~ndimage.binary_dilation(face, iterations=3)
p["hat"] = mask_layer(hero, hat)
# The hero keeps the hat's outline along the face, so the bald face stays closed under it.
p["hero"] = mask_layer(hero, ~(hat & ~ndimage.binary_dilation(face, iterations=16)))
pages["p01"] = p

# p02: profile facing left, crouching and pointing at the paw prints, surprised. A snowdrift hides the boots.
p = {"plate": plate("p02-plate.png")}
hero = place(load("p02-hero.png"), (0, 0, 1, 1), 0.38, 0.33, height=0.5)
b = bbox(hero)
p["hero"] = hero
fh = b[3] - b[1]
fw = b[2] - b[0]
drift = load("p02-drift.png")
# The mound covers the boots from mid-calf down; the twigs stick up above it.
p["occluders"] = {"snowdrift": place(drift, abox(drift), b[0] + 0.6 * fw - 0.36, b[3] - 0.10, height=0.11)}
pages["p02"] = p

# p03: three-quarter view, sad, standing behind the stone wall: the wall hides the body, the forearms rest across
# the wall's face and the right mitten holds a carrot up in front of it (the sandwich case).
WALL_TOP, WALL_BOTTOM = 0.583, 0.80
p = {"plate": plate("p03-plate.png")}
hero = place(load("p03-hero.png"), (0, 0, 1, 1), 0.0, 0.33, height=0.9)
b = bbox(hero)
# The body below the wall's bottom edge is never seen: cut it there, under the wall.
p["hero"] = mask_layer(hero, ~rect(0, WALL_BOTTOM - 0.03, 1, 1))
fh = b[3] - b[1]
fw = b[2] - b[0]
wall = np.zeros((S, S), bool)
wall[round(WALL_TOP * S):round(WALL_BOTTOM * S)] = True
p["occluders"] = {"stone wall": mask_layer(p["plate"], wall)}
# Both forearms (the near one folded across the chest) where they lie over the wall's top, the mittens and the
# carrot. Above the wall the child shows anyway.
# In the source drawing the forearms run from 30% to 42% down and the carrot hand starts 68% across; the drawing is
# placed at (0, 0.33) at 0.9 of the page's height, so 0.6 of its width.
ARMS_BOTTOM = 0.33 + 0.9 * 0.42
arms = rect(b[0] + 0.12 * fw, WALL_TOP - 0.02, 1, ARMS_BOTTOM) | rect(0.6 * 0.68, 0, 1, ARMS_BOTTOM)
p["front"] = {"stone wall": mask_layer(hero, arms & (np.asarray(hero)[..., 3] > 25))}
pages["p03"] = p

# p04: seen from above, lying in the snow making a snow angel, tilted; laughing with eyes shut. No occluder.
p = {"plate": plate("p04-plate.png")}
hero = place(load("p04-hero.png"), (0.2, 0.0, 0.8, 1.0), 0.12, 0.04, height=0.62, angle=-18)
p["hero"] = hero
pages["p04"] = p

# p05: asleep on the side, head on the pillow, under the quilt; the arm and the toy fox lie on top of the quilt.
p = {"plate": plate("p05-plate.png")}
hero = place(load("p05-hero.png"), (0, 0, 1, 1), 0.19, 0.25, width=0.53)
b = bbox(hero)
fw, fh = b[2] - b[0], b[3] - b[1]
p["hero"] = hero
quilt = load("p05-quilt.png")
q = place(quilt, abox(quilt), b[0] + 0.30 * fw, b[1] + 0.22 * fh, width=0.97 - (b[0] + 0.30 * fw))
p["occluders"] = {"quilt": q}
zone = rect(b[0] + 0.17 * fw, b[1] + 0.40 * fh, b[0] + 0.46 * fw, 1)
p["front"] = {"quilt": mask_layer(hero, zone & (np.asarray(hero)[..., 3] > 25))}
pages["p05"] = p

for pid, p in pages.items():
    p["head"] = head_of(p["hero"], p.get("hat"))

for pid, p in pages.items():
    d = os.path.join(out, pid)
    os.makedirs(d, exist_ok=True)
    p["plate"].convert("RGB").save(os.path.join(d, "plate.png"))
    p["hero"].save(os.path.join(d, "hero.png"))
    if "hat" in p:
        p["hat"].save(os.path.join(d, "hero-hat.png"))
    for slug, im in p.get("occluders", {}).items():
        im.save(os.path.join(d, f"occluder-{slug}.png"))
    for slug, im in p.get("front", {}).items():
        im.save(os.path.join(d, f"front-of-{slug}.png"))
    hole = blank()
    x0, y0, x1, y1 = (round(v * S) for v in p["head"])
    hole.paste((255, 0, 255, 255), (x0, y0, x1, y1))
    hole.save(os.path.join(d, "head-hole.png"))
    # Preview: plate, hero, occluders, then the front zones over them (what a correct sandwich looks like).
    im = p["plate"].copy()
    im.alpha_composite(p["hero"])
    for o in p.get("occluders", {}).values():
        im.alpha_composite(o)
    for f in p.get("front", {}).values():
        im.alpha_composite(f)
    im.convert("RGB").resize((800, 800), Image.LANCZOS).save(os.path.join(d, "preview.jpg"), quality=88)
    print(pid, "hero", [round(v, 3) for v in bbox(p["hero"])], "head", [round(v, 3) for v in p["head"]])
