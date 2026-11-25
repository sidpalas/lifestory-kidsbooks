# The Fox and the Red Hat: art sources

A five-page photo story (book format 4, 8.5 × 8.5 in) made as a second test case beside Dream Adventure, in a very
different style: flat 1960s screen-print, with bold flat colour, thick navy outlines, halftone shading and misregistered colour.
Each page tests something different:

<!-- oxfmt-ignore -->
| Page | Pose and face | Occlusion |
| --- | --- | --- |
| p01 | Standing, front view, arms flung wide, big grin | `occluder: hero (bobble hat)`: the child's own hat, merged into the bald reference |
| p02 | Crouching in profile, pointing, surprised | `occluder: scenery (snowdrift)` over the boots: plain foreground |
| p03 | Three-quarter view, leaning on a wall, sad, holding a carrot up | Sandwich: `occluder: scenery (stone wall)` hides the body; the forearms, mitten and carrot are in front of it |
| p04 | Seen from above, lying in a snow angel, tilted 18°, laughing with eyes shut | None (control) |
| p05 | Asleep on the side, head on the pillow | Sandwich: `occluder: scenery (quilt)` hides the body; the arm and the toy fox lie on top of it |

The art is AI-generated (OpenAI `gpt-image-2.6-sunburst`, 13 images, US$0.60, 2026-11-25; prompts in `gen.mjs`); OpenAI
assigns its output to the customer (Services Agreement §4.1). No real person's photo is in it. The images, PSDs and
the built story stay out of the repository (about 145 MB); these scripts rebuild them:

```sh
node fixtures/art-sources/snow-fox/gen.mjs <raw dir>                       # with OPENAI_API_KEY
python3 -I fixtures/art-sources/snow-fox/compose.py <raw dir> <layers dir>  # psd-tools venv (preparing-layered-art)
node fixtures/art-sources/snow-fox/build-psds.mjs <layers dir> <psd dir>
python3 -I fixtures/art-sources/psd-export.py --config <export-config.json> --out <export dir>
node packages/core/src/story-from-export.ts --export <export dir> --config fixtures/art-sources/snow-fox.json \
  --sheet <stock sheet> --out <story dir> --stock <stock dir>
node fixtures/art-sources/snow-fox/stock.ts <story dir> <stock sheet> <stock dir>  # with OPENAI_API_KEY
```

`stock.ts` draws the example child's figure on each page the way a book draws a family's (page reference,
photo-hero-v3 prompt, `fitFigure`; US$0.036 a page), so the stock pages also show what the pipeline does today. Build
the story once without `--stock` for `stock.ts` to read, then again with it.

Each PSD has the `plate`, `hero` and `foreground` groups `psd-export.py` reads, plus two hidden groups it skips:
`guides` (the `original head hole`) and, on p03 and p05, `front zones` with a `front of: <occluder>` layer that marks where
the child comes in front of that occluder. That layer is a proposal for the sandwich case
(thread T-3a5d893e-d672-4ba3-bafd-0ce401886d77), not part of book format 4; without it the occluder covers the arm and
held prop too.
