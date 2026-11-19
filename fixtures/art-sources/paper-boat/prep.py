"""Turns the generated watercolour art into Paper Boat's book-format layers.

For each role (hero, grownup): both face bases and their 4 edits (short, curly, long, glasses) are aligned to the
base, cropped to one shared canvas, and split into
  base-<face>.png        figure on transparent, skin desaturated to neutral greys (D26)
  base-<face>-skin.png   skin mask (alpha = in the region): face, ears, neck, arms, hands, legs, and the lines on them
  <face>-<option>.png    the part, cut out by comparison with the base, cropped to a rect snapped to 5 permille
and writes parts.json with each part's rect in thousandths of the figure box.
usage: prep.py <out dir>
"""
import json, os, sys
import cv2
import numpy as np

RAW = os.path.join(os.path.dirname(__file__), "raw")
OUT = sys.argv[1]
OPTIONS = {"short": "hair:short", "curly": "hair:curly", "long": "hair:long", "glasses": "glasses:round"}


def load(name):
    return cv2.imread(os.path.join(RAW, name), cv2.IMREAD_COLOR).astype(np.float32)


def align(base, edit):
    """Affine-aligns `edit` to `base` on the lower body (unchanged by the edit) and removes its colour offset there."""
    g1, g2 = (cv2.cvtColor(i, cv2.COLOR_BGR2GRAY) for i in (base, edit))
    m = np.zeros(g1.shape, np.uint8)
    m[900:1500] = 1
    w = np.eye(2, 3, dtype=np.float32)
    _, w = cv2.findTransformECC(g1, g2, w, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6), m, 5)
    out = cv2.warpAffine(edit, w, (edit.shape[1], edit.shape[0]), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
    out -= (out[900:1500] - base[900:1500]).mean(axis=(0, 1))
    return np.clip(out, 0, 255)


def lab(img):
    return cv2.cvtColor(img / 255, cv2.COLOR_BGR2LAB)


def fill_holes(mask):
    h, w = mask.shape
    flood = mask.copy()
    ff = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(flood, ff, (0, 0), 1)
    return mask | (1 - flood)


def figure_alpha(img):
    """Watercolour on white paper: alpha from how far a pixel is from the paper; enclosed whites (eyes, soles) are opaque."""
    d = 255 - img.min(axis=2)
    a = np.clip((d - 7) / 22, 0, 1)
    solid = fill_holes((a > 0.5).astype(np.uint8))
    solid = cv2.morphologyEx(solid, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(solid)
    keep = 1 + np.argsort(-stats[1:, cv2.CC_STAT_AREA])[:1]
    body = np.isin(labels, keep).astype(np.uint8)
    body = cv2.dilate(body, np.ones((5, 5), np.uint8))  # soft edges just outside the solid body
    a = np.where(fill_holes((a > 0.5).astype(np.uint8) & body) > 0, 1.0, a) * body
    return a


def unmix(img, a, bg):
    """Colour of a layer with alpha `a` drawn over `bg`: C = a·F + (1 − a)·bg."""
    aa = np.maximum(a, 1e-3)[..., None]
    return np.clip((img - (1 - aa) * bg) / aa, 0, 255)


def skin_mask(img, alpha):
    L, A, B = cv2.split(lab(img))
    seed = ((L > 60) & (A > 3) & (A < 34) & (B > 8) & (B < 44) & (alpha > 0.9)).astype(np.uint8)
    seed = cv2.morphologyEx(seed, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(seed)
    big = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] > 1500]
    seed = np.isin(labels, big).astype(np.uint8)
    seed = fill_holes(cv2.morphologyEx(seed, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)))
    # Skin (head, arms, legs) always reaches the figure's outline; a skin-coloured patch enclosed by clothes is a
    # light wash on the shorts or shoes.
    n, labels = cv2.connectedComponents(seed)
    outside = (alpha < 0.5).astype(np.uint8)
    for i in range(1, n):
        comp = (labels == i).astype(np.uint8)
        ring = cv2.dilate(comp, np.ones((15, 15), np.uint8)) - comp
        if (ring & outside).sum() < 0.25 * ring.sum():
            seed[labels == i] = 0
    # Clothes: saturated or dark pixels that aren't skin-coloured; never in the mask.
    clothes = (((B > 46) | (A < 0) | (B < 2) | (A > 38) | ((L < 58) & (A > 20))) & (alpha > 0.5)).astype(np.uint8)
    clothes = cv2.morphologyEx(clothes, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    # The pencil outline around skin belongs to the skin; a soft edge keeps it from showing a seam.
    m = cv2.dilate(seed, np.ones((7, 7), np.uint8)).astype(np.float32)
    m[clothes > 0] = 0
    m = cv2.GaussianBlur(m, (5, 5), 1.2) * alpha
    return np.clip(m, 0, 1)


def desaturate(img, mask):
    grey = cv2.cvtColor(img.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)[..., None]
    return img * (1 - mask[..., None]) + grey * mask[..., None]


def face_fixes(img, skin, alpha):
    """A gradient map keeps only tone, so two things the illustrator drew in colour go wrong on dark skin:
    the cheek blush (a darker tone) turns into a dark smudge, and an open mouth's pink tongue turns skin-brown.
    The blush is evened out to the tone around it; the mouth's interior leaves the skin mask and keeps its colour."""
    L, A, B = cv2.split(lab(img))
    ys = np.nonzero(skin.max(axis=1) > 0.5)[0]
    face = np.zeros(skin.shape, bool)
    face[ys.min() : ys.min() + int((ys.max() - ys.min()) * 0.2)] = True
    face &= skin > 0.5
    # Mouth: teeth (white) or tongue (dark red) enclosed in the face's lower half, with the lip line around them.
    mouth = (face & (((L > 86) & (A < 8) & (B < 14)) | ((A > 22) & (L < 72) & (B < 30)))).astype(np.uint8)
    mouth = cv2.morphologyEx(mouth, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mouth)
    mouth = np.isin(labels, [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] > 150]).astype(np.uint8)
    mouth = fill_holes(cv2.morphologyEx(mouth, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)))
    skin = skin * (1 - cv2.GaussianBlur(mouth.astype(np.float32), (5, 5), 1.0))
    # Blush: warm, slightly darker patches on the cheeks. Raise their lightness to the skin's around them.
    warm = (face & (A > 16) & (mouth == 0)).astype(np.float32)
    warm = cv2.GaussianBlur(warm, (31, 31), 8)
    ref = cv2.GaussianBlur(L * face * (A <= 16), (61, 61), 0) / np.maximum(cv2.GaussianBlur((face & (A <= 16)).astype(np.float32), (61, 61), 0), 1e-3)
    lift = np.clip(ref - L, 0, 12) * np.clip(warm * 2, 0, 1) * (L > 55)
    lab_img = cv2.merge([L + lift, A, B])
    fixed = np.clip(cv2.cvtColor(lab_img, cv2.COLOR_LAB2BGR) * 255, 0, 255)
    return fixed, skin


def part_alpha(base, edit, zone):
    """The part is whatever the edit made darker than the base (dark hair, dark frames), soft only at faint edges."""
    dL = (lab(base)[..., 0] - lab(edit)[..., 0])
    chroma = np.abs(lab(base)[..., 1:] - lab(edit)[..., 1:]).sum(axis=2)
    # Hair over skin darkens it by 30+ L; the shading the edit adds to the skin below a fringe by less than ~15, and
    # it must stay with the base (it takes the skin palette, not the hair's).
    a = np.clip((np.maximum(dL, chroma * 0.5) - 14) / 16, 0, 1) * zone
    solid = (a > 0.35).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(solid)
    big = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] > 60]
    keep = cv2.dilate(np.isin(labels, big).astype(np.uint8), np.ones((5, 5), np.uint8))
    return a * keep


def rgba(img, a):
    return np.dstack([img, a * 255]).round().clip(0, 255).astype(np.uint8)


def mask_png(m):
    return np.dstack([np.full(m.shape, 255, np.float32)] * 3 + [m * 255]).round().astype(np.uint8)


def role(name):
    faces = {"round": "face:round", "oval": "face:oval"}
    imgs = {}
    for face in faces:
        b = load(f"{name}-{face}-base.png")
        imgs[face] = {"base": b, **{opt: align(b, load(f"{name}-{face}-{opt}.png")) for opt in OPTIONS}}
    # One canvas for both faces: union of every figure's extent, padded, sized to a multiple of 200 px.
    extent = np.zeros(imgs["round"]["base"].shape[:2], np.uint8)
    for face in faces:
        for img in imgs[face].values():
            extent |= (figure_alpha(img) > 0.02).astype(np.uint8)
    ys, xs = np.nonzero(extent)
    cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
    W = int(np.ceil((xs.max() - xs.min() + 24) / 200) * 200)
    H = int(np.ceil((ys.max() - ys.min() + 24) / 200) * 200)
    x0, y0 = int(round(cx - W / 2)), int(round(cy - H / 2))

    def crop(img):
        pad = cv2.copyMakeBorder(img, 400, 400, 400, 400, cv2.BORDER_CONSTANT, value=(255, 255, 255) if img.ndim == 3 else 0)
        return pad[y0 + 400 : y0 + 400 + H, x0 + 400 : x0 + 400 + W]

    os.makedirs(os.path.join(OUT, name), exist_ok=True)
    parts = []
    for face, face_id in faces.items():
        base = crop(imgs[face]["base"])
        a = figure_alpha(base)
        colour = unmix(base, a, 255.0)
        skin = skin_mask(base, a)
        colour, skin = face_fixes(colour, skin, a)
        cv2.imwrite(os.path.join(OUT, name, f"base-{face}.png"), rgba(desaturate(colour, skin), a), [cv2.IMWRITE_PNG_COMPRESSION, 9])
        cv2.imwrite(os.path.join(OUT, name, f"base-{face}-skin.png"), mask_png(skin), [cv2.IMWRITE_PNG_COMPRESSION, 9])
        # Where parts may be: the head and, for long hair, the shoulders and chest.
        head = np.zeros((H, W), np.float32)
        ys, xs = np.nonzero(skin > 0.5)
        top = ys.min()
        neck = top + int((ys.max() - top) * (0.32 if name == "hero" else 0.26))
        head[: neck, :] = 1
        for opt, option in OPTIONS.items():
            edit = crop(imgs[face][opt])
            zone = head.copy()
            if opt == "long":
                zone[: int(neck + (H - neck) * 0.45), :] = 1
            if opt == "glasses":
                zone[: top + int((neck - top) * 0.25), :] = 0
            # Over the bare paper, the part is unmixed against white; over the figure, against the base.
            pa = np.maximum(part_alpha(base, edit, zone), np.clip((255 - edit.min(axis=2) - 7) / 22, 0, 1) * (a < 0.05) * zone)
            pa = cv2.GaussianBlur(pa, (3, 3), 0.6)
            under = base * a[..., None] + 255 * (1 - a[..., None])
            f = unmix(edit, pa, under)
            ys, xs = np.nonzero(pa > 0.01)
            snap = lambda v, size, up: int((np.ceil if up else np.floor)(v / size * 200) * 5)
            px0, py0 = snap(xs.min(), W, False), snap(ys.min(), H, False)
            px1, py1 = min(1000, snap(xs.max() + 1, W, True)), min(1000, snap(ys.max() + 1, H, True))
            sx0, sy0, sx1, sy1 = px0 * W // 1000, py0 * H // 1000, px1 * W // 1000, py1 * H // 1000
            path = f"{face}-{opt}.png"
            cv2.imwrite(os.path.join(OUT, name, path), rgba(f, pa)[sy0:sy1, sx0:sx1], [cv2.IMWRITE_PNG_COMPRESSION, 9])
            parts.append({"face": face_id, "option": option, "asset": f"{name}/{path}", "at": [px0, py0, px1, py1]})
    return {"size": [W, H], "parts": parts, "bases": {face_id: f"{name}/base-{face}" for face, face_id in faces.items()}}


json.dump({r: role(r) for r in ["hero", "grownup"]}, open(os.path.join(OUT, "parts.json"), "w"), indent=1)
print(open(os.path.join(OUT, "parts.json")).read())
