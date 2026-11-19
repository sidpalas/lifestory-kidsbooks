# The Paper Boat: where the art comes from

Placeholder art for a sample story, made to test the recolour and print on textured raster art like an
illustrator's (docs/decisions.md, D24). Replace it before the story is sold or printed for a customer.

- **Source:** generated on 2026-11-19 with OpenAI `gpt-image-2.6-sunburst` through the Images API (24 calls: 4 bald
  base figures, 3 plates and the reeds as generations; 16 in-place edits of the bases for the hairstyles and glasses).
  About US$1.40. Prompts and the scripts that cut the layers out: `fixtures/art-sources/paper-boat/`.
- **v3 poses (2026-11-19):** 57 more calls, US$2.76: 5 poses drawn from v2's front figures (an edit asking for the same
  character in a new pose), 4 oval faces from them, 2 edits with the raised arm lowered (for the occluder), and 46
  in-place part edits with the app's own part prompt. Every figure is now posed: the grown-up seen from behind and the
  child pointing (page 1), the child kneeling side-on (page 2, next to v2's standing grown-up), and both sitting, the
  grown-up shading their eyes with a hand in front of the forehead (page 3).
- **Licence:** OpenAI assigns its output to the customer (Services Agreement §4.1), so the art belongs to the project
  like the rest of this repository. It is AI-generated: say so wherever the law asks for a disclosure.
- **Fonts:** Literata, SIL Open Font License (`fonts/OFL.txt`), the same static instances as The Moon Picnic.
- **Text:** written for this sample.

How the layers were made (v2: `prep.py`, `build.py`; v3 poses: `bases.ts`, `parts.ts`, `build-v3.ts`, which run the
app's own art-import and part code, D36 and D42):

- v3: each pose is matted off the paper (`figureOffPaper`) and made a base (`makeBase`: skin mask, overlay with the
  blush and open mouth). By hand on top: the shoes kept out of the skin mask (the colour model took red and tan shoes
  for skin), paper-white shine on the scalps painted out, and the hand of the sitting grown-up cut as the occluder
  against the arm-lowered edit. Parts are `cutOutLayer` of `partPrompt` edits within a zone per pose. The pose seen
  from behind is drawn once and serves both face types. D43's hairstyles are on the pointing child's round face and
  its facial hair on the sitting grown-up's round face only; the rest come as additions (D41).

- Each base figure is matted off its white paper, cropped to a canvas shared by both face types of the role, and its
  skin turned to neutral greys inside the skin mask. The skin mask covers face, ears, neck, arms, hands and legs with
  the pencil line around them, and leaves out clothes.
- Colour inside the skin goes to each base's `overlay` (v2), which is drawn as is above the recoloured base: an open
  mouth (found by its teeth) in its own colours, and the cheek blush as a translucent rose (#c8585c at up to 35%). In
  the base the blush is evened out to the skin around it, so it doesn't darken twice. v1 had no overlays: it kept the
  mouth out of the skin mask and dropped the blush.
- Each part is what an edit made darker than its base, after aligning the edit to the base (under 1.3 px) and matching
  its colour (under 2 levels); its colour is unmixed against the base, so soft edges composite cleanly.
- Plates are JPEG (quality 90, 2048 px, about 234 ppi at this trim); the reeds are a WebP with alpha.
- Palettes put their stops where this art's tones are: skin between 0.75 and 0.9, hair between 0.1 and 0.65.
