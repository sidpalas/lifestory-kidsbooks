# Rebuilds the picker's portrait parts from the FLUX 3 Klein 24-combination grid (thread
# T-01a1f012-4acc-7483-a9a5-8d5c5353cdee, attachment 098895e1...-file.png). The grid is 8 columns
# (bob, bob+glasses, braids, braids+glasses, coily, coily+glasses, ponytail, ponytail+glasses) by 3 rows
# (light, medium, deep skin), composed there from one bald base, a skin mask, and in-place hair/glasses parts.
# Tiles differ only where those parts or the skin recolour changed something, so:
#   skin mask  = pixels that change between the light and deep rows (any hairstyle)
#   bald base  = the medium row, taking each pixel from a hairstyle that doesn't cover it
#   hair part  = pixels of a hairstyle tile that differ from the bald base, turned into neutral greys
#   glasses    = pixels that differ between a tile with and without glasses
# Usage: python -I extract.py <grid.png> <out-dir>
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

grid = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.float32)
out = sys.argv[2]
H, W, _ = grid.shape
tw, th = W // 8, H // 3
tile = lambda r, c: grid[r * th:(r + 1) * th, c * tw:(c + 1) * tw]
LIGHT, MEDIUM, DEEP = 0, 1, 2
styles = {"bob": 0, "braids": 2, "coily": 4, "ponytail": 6}

diff = lambda a, b: np.abs(a - b).max(axis=2)

# Skin visibility per style (soft), from how much a pixel moves between light and deep skin.
skin = {}
for name, col in styles.items():
    d = np.abs(tile(LIGHT, col) - tile(DEEP, col)).sum(axis=2)
    ref = np.percentile(d[d > 20], 60)
    skin[name] = np.clip((d - 8) / (ref - 8), 0, 1)
skin_union = np.max(np.stack(list(skin.values())), axis=0)

# Bald base on medium skin: a pixel identical in every style is base; otherwise take it from the style
# showing the most skin there; pixels every style covers with hair are never visible, so inpaint them.
med = {name: tile(MEDIUM, col) for name, col in styles.items()}
stack = np.stack(list(med.values()))
skin_stack = np.stack(list(skin.values()))
# Hair per style: pixels that look like hair (dark and not blue, or red), aren't skin in that style, and differ
# from another style there. Pixels where three or more styles agree are base (eyes, brows, outlines).
n = len(styles)
lum_of = lambda rgb: 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
def hairish(rgb):
    red = (rgb[..., 0] > rgb[..., 1] * 1.35) & (rgb[..., 0] > rgb[..., 2] * 1.5) & (rgb[..., 0] > 90)
    return (rgb[..., 2] <= rgb[..., 0] + 8) & ((lum_of(rgb) < 150) | red)
agree = np.zeros(stack.shape[:3], np.int32)
for i in range(n):
    for j in range(n):
        if i != j:
            agree[i] += (np.abs(stack[i] - stack[j]).max(axis=2) < 10)
hair = np.stack([hairish(stack[i]) & (skin_stack[i] < 0.5) & (agree[i] < 2) & (agree[i] < n - 1) for i in range(n)])
hair = np.stack([ndimage.binary_opening(h, iterations=1) for h in hair])
free = ~hair
known = free.any(axis=0)
# The base is the mean of the styles without hair at a pixel.
weights = free.astype(np.float32)[..., None]
base = (stack * weights).sum(axis=0) / np.maximum(weights.sum(axis=0), 1)
# Fill unknown pixels with the mean skin colour, then blur them into their surroundings.
mean_skin = base[skin_union > 0.9].mean(axis=0)
filled = base.copy()
filled[~known] = mean_skin
blurred = np.asarray(Image.fromarray(filled.astype(np.uint8)).filter(ImageFilter.GaussianBlur(3))).astype(np.float32)
base = np.where(known[..., None], base, blurred)
unknown_skin = (~known).astype(np.float32)
skin_mask = np.maximum(skin_union, unknown_skin)
skin_mask = np.asarray(Image.fromarray((skin_mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32) / 255

def save_rgba(path, rgb, alpha):
    a = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), a])).save(path, optimize=True)

save_rgba(f"{out}/base.png", base, np.ones(base.shape[:2]))
# A mask is opaque where the region is (D24): black with the mask as alpha.
save_rgba(f"{out}/skin-mask.png", np.zeros_like(base), skin_mask)

# Hair parts: alpha from the difference with the bald base, colour as neutral greys stretched to 0.1-0.85,
# so one palette per hair colour fits every hairstyle (the parts were black, dark brown, and red).
for name, file in [("bob", "hair-short"), ("coily", "hair-curly"), ("braids", "hair-long"), ("ponytail", "hair-ponytail")]:
    t = med[name]
    d = diff(t, base)
    h = hair[list(styles).index(name)]
    near = ndimage.binary_dilation(h, iterations=2)
    alpha = np.maximum(h.astype(np.float32), np.clip((d - 14) / 30, 0, 1) * near) * (1 - skin[name] * 0.9)
    alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(3))).astype(np.float32) / 255
    # The two black hairstyles agree on some crown pixels, which leaves holes in the hair: fill small enclosed gaps.
    solid = alpha > 0.5
    labels, count = ndimage.label(~solid)
    sizes = ndimage.sum(np.ones_like(labels), labels, range(count + 1))
    border = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])))
    holes = np.isin(labels, [i for i in range(1, count + 1) if sizes[i] < 400 and i not in border])
    alpha = np.where(holes, 1.0, alpha)
    lum = 0.2126 * t[..., 0] + 0.7152 * t[..., 1] + 0.0722 * t[..., 2]
    # Hole pixels are hair in the tile too (the base matched it by accident), so their tone is right as it is.
    lo, hi = np.percentile(lum[alpha > 0.5], [3, 97])
    grey = 0.1 + 0.75 * np.clip((lum - lo) / max(1, hi - lo), 0, 1)
    save_rgba(f"{out}/{file}.png", np.dstack([grey * 255] * 3), alpha)

# Glasses: union over hairstyles of what adding glasses changed, on medium skin.
alpha = np.zeros(base.shape[:2], np.float32)
rgb = np.zeros_like(base)
for name, col in styles.items():
    with_g = tile(MEDIUM, col + 1)
    a = np.clip((diff(with_g, med[name]) - 5) / 25, 0, 1)
    take = a > alpha
    rgb[take] = with_g[take]
    alpha = np.maximum(alpha, a)
save_rgba(f"{out}/glasses-round.png", rgb, alpha)

skin_lum = (0.2126 * base[..., 0] + 0.7152 * base[..., 1] + 0.0722 * base[..., 2])[skin_mask > 0.9] / 255
print("tile", tw, th, "base skin luminance p5/p50/p95", np.percentile(skin_lum, [5, 50, 95]).round(3))
