# The Moon Walk: art sources

A four-page photo story (book format 4, 8.5 × 8.5 in) with two roles, a child (`hero`) and a parent (`grownup`), in a
third style beside Dream Adventure and The Fox and the Red Hat: a very loose, scribbly black-and-white graphite pencil
sketch, with wobbly overlapping strokes, unerased construction lines and lots of bare paper.

<!-- oxfmt-ignore -->
| Page | Figures (back to front) | Note |
| --- | --- | --- |
| p01 (cover) | child pointing up at the moon (mirrored), dad holding up a lantern | Title page |
| p02 | dad walking with the lantern, child running ahead | Both in side view |
| p03 | child alone on tiptoe, arms up to the moon | One-role page in a two-role story |
| p04 | dad sitting cross-legged, child hugging knees and yawning | Seated poses; the text stops short of the moon |

The art is AI-generated (OpenAI `gpt-image-2.6-sunburst`, prompts in `gen.mjs`; stock figures with
`gpt-image-2.5-sunburst`); OpenAI assigns its output to the customer (Services Agreement §4.1). No real person's photo
is in it. A first, more polished pencil round was replaced at Sid's request (2026-11-27); with it, the whole story cost
about US$2.02 (v1 to v4). The images and the built story stay out of the repository; these scripts rebuild them:

```sh
node fixtures/art-sources/moon-walk/gen.mjs <raw dir>                          # with OPENAI_API_KEY; ~US$0.60
node fixtures/art-sources/moon-walk/compose.mjs <raw dir> <export dir>
node packages/core/src/story-from-export.ts --export <export dir> --config fixtures/art-sources/moon-walk.json \
  --sheet hero=<raw dir>/hero-sheet.png --sheet grownup=<raw dir>/grownup-sheet.png --out <story dir> [--stock <stock dir>]
node fixtures/art-sources/moon-walk/stock.ts <story dir> <stock dir>          # with OPENAI_API_KEY; US$0.036 a figure
```

There are no PSDs: `compose.mjs` writes the layer export directly, as `psd-export.py` would, with each page's
`figures` listed for the two roles. Head boxes are read off the raw drawings, so they change when the art is redrawn.
Build the story once without `--stock` for `stock.ts` to read, then again with it.

A loose sketch leaves the paper inside a figure transparent. `compose.mjs` fills each bald figure's silhouette with
the plate's paper colour so it is opaque like an illustrator's figure layer: without that, `fitFigure`'s tint matched
the redrawn figures to the bald ones' dark pencil lines and turned them solid grey or brown, and their overlap with
the bald figure fell to 0.28. It also re-tones every figure as graphite on that paper (lightness times the paper's
colour): the model drew the bald child cooler than the dad, and the tint carried that into a blue-grey child (v1).

v2 (Sid, 2026-11-27) re-toned the figures as above and made the child smaller beside the dad: about 52% of his
height standing (p01), 63% on p02 and 70% sitting on p04. The child's stock figures were redrawn for US$0.14.

v3 (Sid, 2026-11-27) made every figure equally light: the model shaded some bald figures much heavier than others
(mean ink 20 to 57 levels below the paper, darkest on the cover, the dad on p02 and the child on p03), and the tint
copied that into the book. `compose.mjs` scales each figure's ink to the same mean (`INK`); the stock figures were
re-fitted from the same drawings, at no cost.

v4 (Sid, 2026-11-27) made p02's running child smaller still, about 49% of the walking dad's height (63% in v2 and
v3): a running pose loses height, so it read larger than its share. Only that figure was redrawn (US$0.036).
