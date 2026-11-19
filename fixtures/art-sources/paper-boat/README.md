# Paper Boat art sources

How `fixtures/stories/paper-boat` was made (see its `ART.md`). The generated images (`raw/`, ~45 MB) are not
committed; the story directory holds the layers cut from them. To redo it, with `OPENAI_API_KEY` set:

```sh
cd fixtures/art-sources/paper-boat
py="uv run --with numpy,opencv-python-headless python"
# 1. generate (gen.py skips files that exist), prompts below
# 2. cut out bases, skin masks and parts into out/
$py prep.py out   # also the overlays (blush, open mouth)
# 3. write fixtures/stories/paper-boat (assets, manifest.json, story.json)
$py build.py ../../..
```

Then v3's poses (TypeScript, from the repo root, using the app's own cut-out code; edits cached in `raw/v3`):

```sh
node fixtures/art-sources/paper-boat/bases.ts     # raw/v3/<role>-<pose>-<face>.png -> bases, skin masks, overlays, occluder
node fixtures/art-sources/paper-boat/parts.ts     # part edits (partPrompt) and cut-outs (cutOutLayer), with review images
node fixtures/art-sources/paper-boat/build-v3.ts  # pages, boxes and v3 manifest
```

`poses.ts` lists the poses, their shoe areas kept out of the skin mask and the occluder's area; `parts.ts` the zones
and which pose gets D43's options; `takes.json` the retakes (stubble took two).

A changed manifest or changed art needs a new `version` in `story.json`: stored versions never change.

## Prompts

All with `gpt-image-2.6-sunburst`. `STYLE` for figures:

> Children's picture-book illustration in loose traditional watercolour on cold-press paper: visible paper grain, soft
> wet-in-wet washes, pigment granulation, blooms and hard drying edges, thin warm-grey pencil outlines. Plain white paper
> background with nothing else on it: no scenery, no ground, no shadow, no text.

`BALD`: "completely bald: a smooth bare scalp with no hair at all, because hairstyles are painted on later as separate
layers. Visible ears. Light peach skin. The whole figure fits in the frame with generous white margin all around."

Bases (generate, 1024×1536, medium), `STYLE` + one of:

- `hero-round-base.png`: A full-body front view of a 6-year-old child with a round face and full cheeks, standing
  upright and smiling, arms hanging relaxed slightly away from the body, wearing a short-sleeved mustard-yellow T-shirt,
  navy-blue shorts and red sneakers, so the arms and legs show. The child is `BALD`
- `hero-oval-base.png`: the same with "a narrow oval face and a pointed chin, standing upright with a shy smile".
- `grownup-round-base.png`: A full-body front view of a friendly grown-up about 45 years old with a round face and soft
  jaw, standing upright and smiling warmly, arms hanging relaxed slightly away from the body, wearing a moss-green
  short-sleeved shirt, rust-brown knee-length shorts and brown walking shoes, so the forearms and lower legs show. The
  grown-up is `BALD`
- `grownup-oval-base.png`: the same with "a long oval face, high cheekbones and a narrow chin".

Parts (edit of each base, 1024×1536, medium), each followed by `KEEP`: "Change nothing else: keep the face,
expression, ears, body, clothes, pose, framing, white paper background and every existing brush stroke exactly as they
are, in the same loose watercolour style with paper grain."

- `-short`: Paint short, neatly cropped dark-brown hair with a soft side-swept fringe on this bald child/grown-up.
- `-curly`: Paint a full, rounded head of tight springy dark-brown curly hair (a curly afro) on this bald child/grown-up.
- `-long`: Paint long, straight dark-brown hair with a fringe on this bald child/grown-up, falling down past the
  shoulders on both sides of the neck.
- `-glasses`: Paint a pair of round glasses with thin dark-brown wire frames on this bald child/grown-up's face, sitting
  on the nose in front of the eyes, with clear lenses so the eyes stay visible.

Plates (generate, 2048×2048, high), each after: "Children's picture-book background plate in loose traditional
watercolour on cold-press paper: visible paper grain, soft wet-in-wet washes, pigment granulation, blooms and hard
drying edges, thin warm-grey pencil lines. No people, no animals, no text."

- `p01-plate.png`: A small city park on a bright morning just after rain: a curving gravel path in the foreground and
  middle ground, wet grass with a few shining puddles, a round pond with lily pads further back, two leafy trees, a
  wooden bench, pale blue sky with soft clouds. Wide open path area across the lower-middle of the picture where
  characters will stand; keep the bottom fifth calm and light (pale gravel) so text can sit on it.
- `p02-plate.png`: The grassy, muddy edge of a round park pond seen from close by: calm water across the middle and
  right with reflections of trees, reeds and lily pads, a little paper boat folded from newspaper floating near the
  bank, wet grass bank in the lower left. Keep the top quarter a calm, pale sky wash so text can sit on it.
- `p03-plate.png`: The same round park pond at golden late afternoon: warm peach and lilac sky reflected in the water,
  a tiny paper boat sailing far out on the water towards a little island with a willow tree, a gravel bank in the
  foreground. Keep the bottom fifth calm and light (pale gravel bank) so text can sit on it.

Foreground (generate, 1536×1024, medium), `p02-foreground.png`: Loose traditional watercolour on cold-press paper with
visible paper grain and pigment granulation, children's picture-book style: a clump of tall green reeds, cattails and
long grass growing along the very bottom edge of the picture, painted only in the bottom third, leaning slightly.
Everything above them is plain white paper. No water, no ground, no scenery, no text.

### v3 poses

All edits of `raw/v3/ref-<role>.png` (v2's round front base, recoloured to light peach, on white, 1024×1536), medium:
"The first image shows a bald character from a children's picture book. Draw this exact same character again: the
same age, body proportions, round face with full cheeks, light peach skin, smooth bare bald scalp with no hair at all,
visible ears, the same clothes and colours, in the same loose traditional watercolour [...], in a new pose: <pose>
Plain white paper background with nothing else on it [...]", where <pose> is one of: kneeling side-on setting
something on water (hero, 1024²); three-quarter view pointing far to the right with an open-mouthed smile (hero;
flipped so it points left); sitting hugging the knees (hero, 1024²); seen from behind, hands on hips (grown-up);
sitting cross-legged with one hand flat against the forehead shading the eyes (grown-up, 1024²). Oval faces: the
art import's `derivePrompt("face:oval")` on each pose. Occluder: "Change only the raised arm: lower it so that hand
rests on the other knee too, and paint the bald forehead, eyebrow and ear that the hand covered [...]".
