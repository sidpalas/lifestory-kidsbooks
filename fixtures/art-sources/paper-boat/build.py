"""Builds fixtures/stories/paper-boat from the generated art (raw/) and the cut-outs (out/, from prep.py).
usage: build.py <repo root>
"""
import json, os, shutil, sys
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = sys.argv[1]
DST = os.path.join(ROOT, "fixtures/stories/paper-boat")
OUT = os.path.join(HERE, "out")
RAW = os.path.join(HERE, "raw")

shutil.rmtree(DST, ignore_errors=True)
os.makedirs(os.path.join(DST, "pages"), exist_ok=True)
shutil.copytree(os.path.join(ROOT, "fixtures/stories/moon-picnic/fonts"), os.path.join(DST, "fonts"))
for role in ["hero", "grownup"]:
    shutil.copytree(os.path.join(OUT, role), os.path.join(DST, "figures", role))

for p in ["p01", "p02", "p03"]:
    img = cv2.imread(os.path.join(RAW, f"{p}-plate.png"))
    cv2.imwrite(os.path.join(DST, "pages", f"{p}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 90])

# Reeds along the bottom of p02: the 3:2 drawing on white paper, matted against the paper and placed at the
# bottom of a square, transparent canvas the size of the plate.
reeds = cv2.imread(os.path.join(RAW, "p02-foreground.png")).astype(np.float32)
reeds = cv2.resize(reeds, (2048, 1365), interpolation=cv2.INTER_AREA)
a = np.clip((255 - reeds.min(axis=2) - 9) / 24, 0, 1)
a[: int(1365 * 0.45)] = 0
aa = np.maximum(a, 1e-3)[..., None]
f = np.clip((reeds - (1 - aa) * 255) / aa, 0, 255)
canvas = np.zeros((2048, 2048, 4), np.float32)
canvas[2048 - 1365 :, :, :3] = f
canvas[2048 - 1365 :, :, 3] = a * 255
ys = np.nonzero(canvas[..., 3].max(axis=1) > 0)[0]
cv2.imwrite(os.path.join(DST, "pages", "p02-reeds.webp"), canvas.round().astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 90])

parts = json.load(open(os.path.join(OUT, "parts.json")))
AGES = {"hero": ["young-child", "older-child"], "grownup": ["adult", "older-adult"]}


def figure(slot, box, **extra):
    info = parts[slot]
    bases, figure_parts = [], []
    for age in AGES[slot]:
        for face, stem in info["bases"].items():
            bases.append({"age": age, "face": face, "asset": f"figures/{stem}.png", "skinMask": f"figures/{stem}-skin.png", "overlay": f"figures/{stem}-overlay.png"})
        for part in info["parts"]:
            axis = "glasses" if part["option"].startswith("glasses:") else "hair"
            figure_parts.append(
                {
                    "age": age,
                    "face": part["face"],
                    "axis": axis,
                    "option": part["option"],
                    "asset": f"figures/{part['asset']}",
                    "at": part["at"],
                    "palette": "none" if axis == "glasses" else "hairColour",
                    "approved": True,
                }
            )
    return {"kind": "figure", "slotId": slot, "box": box, **extra, "bases": bases, "parts": figure_parts}


def box(cx, bottom, height):
    """A figure box (canvas 1:2) whose centre is at x = cx and whose bottom edge is at y = bottom."""
    w = height // 2
    return [cx - w // 2, bottom - height, cx - w // 2 + w, bottom]


def skin(shadow, mid, light, line="#1e1612"):
    return [
        {"at": 0, "colour": line},
        {"at": 0.45, "colour": shadow},
        {"at": 0.8, "colour": mid},
        {"at": 0.9, "colour": light},
        {"at": 0.97, "colour": "#fbf5ef"},
        {"at": 1, "colour": "#ffffff"},
    ]


def hair(darkest, dark, mid, light, highlight):
    return [
        {"at": 0, "colour": darkest},
        {"at": 0.15, "colour": dark},
        {"at": 0.32, "colour": mid},
        {"at": 0.55, "colour": light},
        {"at": 0.85, "colour": highlight},
        {"at": 1, "colour": "#ffffff"},
    ]


moon = json.load(open(os.path.join(ROOT, "fixtures/stories/moon-picnic/manifest.json")))
manifest = {
    "formatVersion": 2,
    # Lulu wants text at least 0.5 in inside the trim (print thread, 2026-11-19).
    "trim": {**moon["trim"], "safeMarginIn": 0.5},
    "fonts": moon["fonts"],
    "textStyles": moon["textStyles"],
    "characterSlots": [
        {
            "slotId": "hero",
            "label": "The child",
            "description": "A child about 6 years old who sails the boat",
            "example": {
                "name": "Leo",
                "pronouns": "he/him",
                "look": {"age": "young-child", "face": "face:round", "skin": "skin:s1", "hair": "hair:short", "hairColour": "hair-colour:blonde", "glasses": "glasses:round"},
            },
            "ages": AGES["hero"],
        },
        {
            "slotId": "grownup",
            "label": "A grown-up",
            "description": "A parent or grandparent who folds the boat",
            "example": {
                "name": "Amara",
                "title": "Mum",
                "pronouns": "she/her",
                "look": {"age": "adult", "face": "face:oval", "skin": "skin:s5", "hair": "hair:curly", "hairColour": "hair-colour:black", "glasses": "glasses:none"},
            },
            "ages": AGES["grownup"],
        },
    ],
    "palettes": {
        "skin": {
            "skin:s1": skin("#c99278", "#f0cdb8", "#fae3d5"),
            "skin:s2": skin("#b57c5c", "#e4b593", "#f1cfb4"),
            "skin:s3": skin("#8f5a3a", "#c88c62", "#dca57d"),
            "skin:s4": skin("#5e3620", "#9a6340", "#b57c55", "#140d09"),
            "skin:s5": skin("#2e1b10", "#5e3a24", "#7a4e33", "#0f0a07"),
        },
        "hairColour": {
            "hair-colour:black": hair("#0b0807", "#16110f", "#2a2220", "#4a3f3c", "#7a6e6a"),
            "hair-colour:brown": hair("#1a0f08", "#3a2214", "#5a3520", "#8a5a36", "#c09468"),
            "hair-colour:blonde": hair("#4a3214", "#8a6428", "#b48a45", "#dcbb73", "#f4e3b2"),
            "hair-colour:grey": hair("#2a2a2e", "#55555a", "#8a8a8e", "#b9b9bd", "#e6e6e8"),
        },
    },
    "partOrder": ["hair", "glasses"],
    "pages": [
        {
            "pageId": "p01",
            "layout": "full-bleed-art/text-bottom",
            "text": [
                {"style": "title", "content": "The Paper Boat"},
                {
                    "style": "body",
                    "content": "After the rain, {{hero.name}} and {{grownup.title}} folded yesterday’s newspaper into a boat with a pointy sail, and carried it to the pond.",
                },
            ],
            "illustration": {
                "layers": [
                    {"kind": "art", "asset": "pages/p01.jpg"},
                    figure("grownup", box(380, 760, 560)),
                    figure("hero", box(560, 770, 420)),
                ]
            },
        },
        {
            "pageId": "p02",
            "layout": "full-bleed-art/text-top",
            "text": [
                {
                    "style": "body",
                    "content": "{{hero.name}} set the boat down on the water. It wobbled. It turned. Then the wind found its sail, and away it went.",
                }
            ],
            "illustration": {
                "layers": [
                    {"kind": "art", "asset": "pages/p02.jpg"},
                    figure("grownup", box(170, 1000, 640)),
                    figure("hero", box(330, 1000, 500)),
                    {"kind": "art", "asset": "pages/p02-reeds.webp"},
                ]
            },
        },
        {
            "pageId": "p03",
            "layout": "full-bleed-art/text-bottom",
            "text": [
                {
                    "style": "body",
                    "content": "It sailed all afternoon, all the way to the willow island. “It’s exploring,” said {{grownup.title}}. {{hero.They}} waved until the sky turned pink.",
                }
            ],
            "illustration": {
                "layers": [
                    {"kind": "art", "asset": "pages/p03.jpg"},
                    figure("grownup", box(300, 800, 520)),
                    figure("hero", box(440, 800, 400)),
                ]
            },
        },
    ],
}
json.dump(manifest, open(os.path.join(DST, "manifest.json"), "w"), indent=2, ensure_ascii=False)
json.dump(
    {
        "id": "story_paper_boat",
        "slug": "the-paper-boat",
        "title": "The Paper Boat",
        "summary": "A child and a grown-up fold a newspaper boat and sail it on the park pond. Sample story with watercolour placeholder art.",
        "version": 2,
        "publishedAt": "2026-11-19T18:00:00Z",
    },
    open(os.path.join(DST, "story.json"), "w"),
    indent=2,
)
print("built", DST)
