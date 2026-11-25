// Paints The Fox and the Red Hat's art with OpenAI, as an illustrator's tool would: plates without the child, the
// child drawn bald on a transparent background in each page's pose, and the scenery that goes over the child.
// Every image after the first takes the first plate as its style reference. Skips files that exist.
//   node fixtures/art-sources/snow-fox/gen.mjs <raw dir> [name ...]
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [out, ...only] = process.argv.slice(2);
const MODEL = "gpt-image-2.6-sunburst";
export const STYLE =
  "a flat mid-century screen-print children's book illustration: bold simple shapes in flat colour, a limited palette of deep teal, coral red, mustard yellow, cream and dark navy, thick confident navy outlines, a fine halftone-dot texture in the shadows and slightly misregistered colour layers, like a 1960s printed picture book";
const SAME = "in exactly the same style, palette and line as the reference image";
const CHILD =
  "a 6-year-old child with warm brown skin and round rosy cheeks, drawn completely bald: a smooth round bald head with no hair at all (eyebrows stay)";
const COAT = "wearing a mustard-yellow puffy winter coat, teal trousers, red mittens and red boots";
const ALONE =
  "Only the child, on a transparent background: no scenery, no ground, no shadow, no snow, no text. The whole figure fits in the frame with a margin.";
const plate = (scene) =>
  `Background plate for a square picture-book page, ${SAME}. ${scene} No people, no text. Keep the bottom fifth calm and plain so text can sit on it.`;

const jobs = {
  // The style anchor: text only.
  "p01-plate.png": {
    prompt: `Background plate for a square page of ${STYLE}. A snowy back garden on a bright winter morning: a little teal house with a red door on the left with a doorstep, a bare tree on the right, gentle snowy ground, pale cream sky with a low mustard sun. Leave the middle of the picture open: a child will stand there. No people, no animals, no text. Keep the bottom fifth calm and plain so text can sit on it.`,
    size: "1024x1024",
    refs: [],
  },
  "p02-plate.png": {
    prompt: plate(
      "The same snowy garden further out, close to the ground: a line of small neat fox paw prints crossing the snow from the right towards the left, a few bare twigs, a low fence far behind, the sky windy with swirling snow. Leave the left-middle of the picture open: a crouching child goes there.",
    ),
    size: "1024x1024",
    refs: ["p01-plate.png"],
  },
  "p03-plate.png": {
    prompt: plate(
      "A low garden wall of rounded stones topped with snow runs straight across the picture at mid-height, seen from the front. Behind it: a snowy garden, a half-built snowman with no nose, and bare trees. The wall's top edge sits at 55% of the height and its front face fills the band down to 80%; below the wall, flat snow.",
    ),
    size: "1024x1024",
    refs: ["p01-plate.png"],
  },
  "p04-plate.png": {
    prompt: plate(
      "Seen from straight above: a wide field of smooth fresh snow with gentle shadows, a few fallen twigs and berries. In the top right corner, a small red fox sits looking down at the viewer, wearing a red knitted bobble hat. Leave the centre of the picture empty smooth snow: a child lying on their back goes there.",
    ),
    size: "1024x1024",
    refs: ["p01-plate.png"],
  },
  "p05-plate.png": {
    prompt: plate(
      "A cosy child's bedroom at night, seen from the side of the bed: a wooden bed with a big plump cream pillow on the left half of the bed, a window behind with a navy night sky, falling snow and a crescent moon, a little lamp glowing mustard. The bed's mattress and an empty folded-back sheet are visible; there is no quilt (it is a separate layer). Leave the bed empty.",
    ),
    size: "1024x1024",
    refs: ["p01-plate.png"],
  },
  // The child, bald, one pose per page.
  "p01-hero.png": {
    prompt: `${CHILD}, ${COAT} and a red knitted bobble hat pulled down over the top of the bald head and the ears, standing upright facing the viewer, arms flung wide with joy, a huge open-mouthed grin, ${SAME}. ${ALONE}`,
    size: "1024x1536",
    refs: ["p01-plate.png"],
    background: "transparent",
  },
  "p02-hero.png": {
    prompt: `${CHILD}, ${COAT}, seen exactly side-on in profile facing left, crouching low on bent knees, one arm pointing down and forward at something on the ground, a surprised face: eyebrows raised high, eyes wide and round, mouth a small round "o", ${SAME}. The whole body is drawn, including both feet and boots. ${ALONE}`,
    size: "1024x1536",
    refs: ["p01-plate.png"],
    background: "transparent",
  },
  "p03-hero.png": {
    prompt: `${CHILD}, ${COAT}, seen in three-quarter view turned slightly to the right, standing and leaning forward with both forearms resting flat and horizontal at chest height as if on top of a wall, the right mitten holding up a long orange carrot, a sad worried face: eyebrows tilted up in the middle, a small downturned mouth, ${SAME}. Draw the whole body down to the boots. ${ALONE}`,
    size: "1024x1536",
    refs: ["p01-plate.png"],
    background: "transparent",
  },
  "p04-hero.png": {
    prompt: `${CHILD}, ${COAT}, lying on their back seen from straight above, making a snow angel: arms spread wide up and out, legs spread apart, head at the top of the picture, laughing hard with eyes squeezed shut and mouth wide open, ${SAME}. ${ALONE}`,
    size: "1536x1024",
    refs: ["p01-plate.png"],
    background: "transparent",
  },
  "p05-hero.png": {
    prompt: `${CHILD}, wearing teal pyjamas with mustard stars, lying in bed on their side under the covers seen from the side, the head tilted and resting sideways on a pillow, fast asleep with eyes closed and a peaceful little smile, one arm lying across the top of the covers hugging a small soft red toy fox against the chest. Draw the whole body lying down (the covers are a separate layer and not drawn), the bald head on the left, ${SAME}. Only the child and the toy fox, on a transparent background: no bed, no pillow, no covers, no text.`,
    size: "1536x1024",
    refs: ["p01-plate.png"],
    background: "transparent",
  },
  // Scenery that goes over the child.
  "p02-drift.png": {
    prompt: `A low rounded snowdrift with a few twigs sticking out, seen from the side, wide and low, ${SAME}. Only the snowdrift, on a transparent background, no text.`,
    size: "1536x1024",
    refs: ["p01-plate.png"],
    background: "transparent",
  },
  "p05-quilt.png": {
    prompt: `A plump patchwork quilt in teal, coral and mustard squares, lying flat over a bed as seen from the side, its top edge a soft folded hem running horizontally across the picture, its lower edge hanging over the side of the bed, ${SAME}. Only the quilt, on a transparent background, no bed, no people, no text.`,
    size: "1536x1024",
    refs: ["p01-plate.png"],
    background: "transparent",
  },
  // The example child's character sheet (the stock sheet).
  "stock-sheet.png": {
    prompt: `A character sheet of a 6-year-old child with warm brown skin, round rosy cheeks and short springy black curly hair, ${COAT}: front, three-quarter and back views side by side, full body, on a plain white background, ${SAME}. No text, no frame.`,
    size: "1536x1024",
    refs: ["p01-plate.png"],
  },
};

const prices = { imageInput: 8, textInput: 5, output: 30 }; // US$ per million tokens (packages/core/src/providers/openai.ts)
let spent = 0;
await Promise.all(
  Object.entries(jobs).map(async ([name, job]) => {
    if (only.length && !only.includes(name)) return;
    if (existsSync(`${out}/${name}`)) return;
    let response;
    if (job.refs.length === 0) {
      response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          prompt: job.prompt,
          size: job.size,
          quality: "medium",
          output_format: "png",
          n: 1,
        }),
      });
    } else {
      const form = new FormData();
      for (const [k, v] of Object.entries({
        model: MODEL,
        prompt: job.prompt,
        size: job.size,
        quality: "medium",
        output_format: "png",
        n: "1",
      }))
        form.set(k, v);
      if (job.background) form.set("background", job.background);
      for (const ref of job.refs)
        form.append("image[]", new Blob([readFileSync(`${out}/${ref}`)], { type: "image/png" }), ref);
      response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
      });
    }
    const body = await response.json();
    if (!response.ok) return console.error(`${name}: ${JSON.stringify(body).slice(0, 400)}`);
    writeFileSync(`${out}/${name}`, Buffer.from(body.data[0].b64_json, "base64"));
    const u = body.usage ?? {};
    const image = u.input_tokens_details?.image_tokens ?? 0;
    const text = u.input_tokens_details?.text_tokens ?? (u.input_tokens ?? 0) - image;
    const cost = (image * prices.imageInput + text * prices.textInput + (u.output_tokens ?? 0) * prices.output) / 1e6;
    spent += cost;
    console.log(name, `$${cost.toFixed(3)}`);
  }),
);
console.log(`total $${spent.toFixed(3)}`);
