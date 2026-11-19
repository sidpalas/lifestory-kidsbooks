# Kite art sources

The art-import fixtures (`fixtures/imports`, D42): `kite.psd`, a layered file with Background, Kid (drawn bald), Hair
and a hidden Sketch layer, and `kite-flat.jpg`, one flat page. It stands in for art an illustrator made in their own
tool: gouache drawn on 2026-11-19 with OpenAI `gpt-image-2.6-sunburst` (3 generations, US$0.12; prompts in `gen.mjs`)
and one bald edit that split the girl from her hair (US$0.05). OpenAI assigns its output to the customer (Services
Agreement §4.1); it is AI-generated. The generated images (`raw/`) are not committed. To redo it, with `OPENAI_API_KEY`:

```sh
node fixtures/art-sources/kite/gen.mjs <raw dir>
node fixtures/art-sources/kite/build.ts <raw dir>
```
