---
name: preparing-layered-art
description: Turn an illustrator's layered PSDs into a layer export that story-from-export.ts builds a book format 4 story from (plate, bald hero, occluders), and fix the PSDs with scripts when a page's layers are wrong. Use when restructuring or repairing a story's PSDs, exporting a book's art, or when a generated hero copies something odd from its bald reference.
---

# Preparing layered art

A book format 4 page (D56) is a plate, one bald reference per figure that the model redraws as the family's child,
and scenery drawn over the result. The art stays on the machine that has it (README "A real book's art"); only the
tools and a story's converter settings (`fixtures/art-sources/<story>.json`) are committed.

1. **Check for photos of real people first.** Commercial picture books are often built around a photo of the
   original child (a head hole in the page, smart objects, filtered photo pixels left under the hole). Look at every
   layer by eye, hidden ones too. Nothing from those pixels may reach an export: rebuild the page instead, and show
   the user any page you're unsure about rather than guessing.
2. **Give every PSD the layout below,** by hand in the illustrator's tool or with `psd-layers.py`.
3. **Export** with `psd-export.py`, read its warnings, and look at the contact sheet.
4. **Convert and check** with `story-from-export.ts` (README), then look at generated pages: whatever is in the bald
   reference, the model draws.

## The PSD layout

Three top-level groups (names configurable in the export config):

<!-- oxfmt-ignore -->
| Group | Holds | Rules |
| --- | --- | --- |
| `plate` | The scene without the hero | Complete behind the hero, including behind anything you add to the hero later. Exported even if hidden. |
| `hero` | The bald hero, merged bottom to top (normal blend; opacity and clipping are honoured) | Bald. Cut tight to the figure: a band of copied background around it is warned about and the model redraws it. Every visible limb must read as one body: a stray shape (an extra boot, a cap of a sleeve with no shoulder) gets copied every time. Where the body goes under scenery, draw enough of it (neck, shoulder) for the model to see how it connects. Trace and helper layers (`re-ink`, `skin fill`, `skin (neutral grey)`) are left out of the export. |
| `foreground` | One layer per occluder | `occluder: scenery (…)` goes over the redrawn hero (a blanket, a railing, a friend's tail). `occluder: hero (…)` is the figure's own hat or helmet: it's merged into the bald reference so the model redraws it. A scenery occluder should cover the edge where the body disappears, so nothing the model invents there shows. |

A layer named `original head hole` (any pixels) gives the head box; without it the export estimates the head from
the largest area of a `skin` layer and warns.

## Exporting

```sh
python3 -I fixtures/art-sources/psd-export.py --config <art dir>/export-config.json --out <export dir> --sheet <contact.jpg>
```

An example config, kept next to the art (it may name the original child, so it doesn't belong in this repository):

```json
{
  "canvas": [3375, 2625],
  "cropAnchor": { "p02": [0.5, 1] },
  "pages": [
    { "pageId": "p01", "psd": "../psds/p01.psd", "notes": ["title page"] },
    { "pageId": "p02", "image": "../scans/p02.jpg" },
    { "pageId": "p03", "psd": "../psds/p03-under-bed.psd", "flat": true },
    { "pageId": "p04", "white": true }
  ],
  "occluders": { "Tiny tail": { "slug": "tiny-tail", "kind": "scenery" } },
  "pageOccluders": { "p01": { "occluder (from export)": { "slug": "hero-space-helmet", "kind": "hero" } } },
  "copy": { "../text/book.txt": "book.txt", "../text/text-layout.json": "text-layout.json" },
  "copyDirs": { "../text/fonts": "assets/fonts" },
  "textReplacements": { "<the original child's name>": "{{hero.name}}" },
  "photocraft": "/Applications/PhotoCraft.app/Contents/MacOS/photocraft-cli"
}
```

`canvas` is the print sheet, trim plus bleed at 300 ppi, and the trim must be one of the sizes we print
(`PRINT_SIZES`): 8.5x8.5 in is [2625, 2625], 8.5x11 in [2625, 3375], 11x8.5 in [3375, 2625]. Every page is
cover-fitted to it with one transform for all its layers, cropped equally from both sides; `"cropAnchor": {"p03": [0.5,
1]}` keeps a page's bottom edge instead (0 keeps the left or top). A crop that cuts into a hero is a warning. Then `grep` the
export for the original child's name: it must appear nowhere.

## Fixing a PSD with a script

Back the file up first. Write the new layers as full-canvas RGBA PNGs, then:

```sh
python3 -I fixtures/art-sources/psd-layers.py <page.psd> /tmp/page.psd \
  --set "hero/body=body.png" --set "foreground/occluder: scenery (blanket)=blanket.png" \
  --rename "foreground/occluder (from export)=occluder: hero (rain hat)" --show foreground --photocraft <photocraft-cli>
```

It refuses to write if any other layer's pixels changed. Copy the result over the original yourself, after looking at
it. Things that worked on Dream Adventure (thread T-01a1fe52-571e-740b-9ac7-821990daba31):

- **Cutting a stray shape off a limb:** erase on the far side of the pencil line that already runs along the limb's
  edge, keeping the line as the new outline, in every hero layer.
- **Drawing a missing neck or shoulder:** the painter tool on a crop of the hero over white, asking for only the
  missing part with the rest pinned; keep the original pixels wherever they exist, colour-match the new ones to the
  page (an affine fit on pixels both share; night scenes are tinted), and end the new part at the scenery occluder's
  edge with a pencil line.
- **The same drawing on two pages at different sizes:** register them (SIFT + RANSAC similarity on the composites;
  fit head and limbs separately if they were pasted separately) and reuse the finished hero, recoloured, rather than
  repairing both.

## Tools on the art machine

- psd-tools, pillow, numpy and scipy in a throwaway venv (`python3 -m venv /tmp/psdvenv`). A venv under `/tmp` can
  vanish between sessions; recreate it.
- **PhotoCraft** (`photocraft-cli info <file> --detail` lists the layer tree; `convert` re-saves). psd-tools writes a
  merged preview other programs show wrong, so re-save anything psd-tools wrote through `convert` (or the editor).
  `convert` refuses to overwrite its input without `--in-place`.
- **psd-tools turns a new layer into the document's colour mode,** which drops its transparency (an empty layer
  becomes an opaque black pixel). `psd-layers.py` builds layers in a scratch RGBA document instead; do the same in
  any other script.
- Moving the export between Amp threads: `upload_thread_file` takes at most 4 MiB per file and needs the destination
  folder to exist; split a zip and `cat` the parts back together.
