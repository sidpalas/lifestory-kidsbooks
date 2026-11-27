// Draws The Moon Walk's art with OpenAI, as an illustrator's tool would: plates without people, each figure drawn
// bald on a transparent background in its page's pose, and the two stock characters' sheets. Every image after the
// first takes the first plate as its style reference. Skips files that exist.
//   node fixtures/art-sources/moon-walk/gen.mjs <raw dir> [name ...]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const [out, ...only] = process.argv.slice(2);
if (!out) throw new Error("usage: gen.mjs <raw dir> [name ...]");
mkdirSync(out, { recursive: true });
const MODEL = "gpt-image-2.6-sunburst";
const STYLE =
  "a very loose, quick, gestural black-and-white graphite pencil sketch for a children's picture book, on plain off-white paper: fast scribbly lines that overshoot and wobble, several searching strokes per edge, unerased construction lines, sparse scribbled hatching instead of smooth shading, lots of bare paper, unfinished edges that fade out, no clean outlines, no polished detail, no smooth gradients, no colour, like a 5-minute sketchbook thumbnail by a picture-book illustrator";
const SAME =
  "in exactly the same very loose, scribbly, gestural graphite pencil sketch style as the reference image: quick wobbly overlapping strokes, visible construction lines, sparse hatching, lots of bare paper, no polished rendering, black and white only";
const CHILD =
  "a 6-year-old child with round cheeks, drawn completely bald: a smooth round bald head with no hair at all (eyebrows stay), wearing a chunky knitted jumper, dungarees and wellington boots";
const PARENT =
  "a dad in his thirties, drawn completely bald: a smooth bald head with no hair and no beard (eyebrows stay), wearing a long wool coat, a scarf and walking boots";
const ALONE =
  "Only this one person, on a transparent background: no scenery, no ground line, no cast shadow, no paper texture around them, no text. The whole figure fits in the frame with a margin.";
const plate = (scene) =>
  `Background plate for a square picture-book page, ${SAME}. ${scene} No people, no text. Keep the top quarter calm, mostly bare paper with a few light strokes, so text can sit on it.`;
const figure = (who, pose, size = "1024x1536") => ({
  prompt: `${who}, ${pose}, ${SAME}. ${ALONE}`,
  size,
  refs: ["p01-plate.png"],
  background: "transparent",
});

const jobs = {
  // The style anchor: text only.
  "p01-plate.png": {
    prompt: `Background plate for a square page of ${STYLE}. A cottage garden at dusk, sketched quickly: a little cottage with a lit window on the far left, a wooden garden gate and a low picket fence behind, a winding path, tall grass and a few flowers, a big round full moon low in the sky on the right. Leave the lower middle of the picture open: two people will stand there. No people, no animals, no text. Keep the top quarter calm, mostly bare paper with a few light strokes, so text can sit on it.`,
    size: "1024x1024",
    refs: [],
  },
  "p02-plate.png": {
    prompt: plate(
      "A path winding through a quiet wood at night, tall tree trunks on both sides, ferns, the round moon peeking between the branches in the upper right, an owl on a branch. Leave the lower middle open: two people walk there.",
    ),
    size: "1024x1024",
    refs: ["p01-plate.png"],
  },
  "p03-plate.png": {
    prompt: plate(
      "A clearing at the edge of the wood: a big fallen tree log lying straight across the lower middle of the picture (its top at about 82% of the height), grass and stones in front, a huge round moon close above it in the middle of the sky. Nobody on the log.",
    ),
    size: "1024x1024",
    refs: ["p01-plate.png"],
  },
  "p04-plate.png": {
    prompt: plate(
      "The top of a gentle grassy hill at night, the grass ending in a soft curve, far below a little village with a few lit windows, the big round moon high in the sky on the right with a few stars. The hilltop is completely empty grass: nobody sitting or standing anywhere in the picture, no silhouettes.",
    ),
    size: "1024x1024",
    refs: ["p01-plate.png"],
  },
  // Each figure, bald, in its page's pose.
  "p01-grownup.png": figure(
    PARENT,
    "standing upright in three-quarter view turned to the right, holding up an old lantern in one hand, smiling warmly down to his right",
  ),
  "p01-hero.png": figure(
    CHILD,
    "standing in three-quarter view turned to the left, one arm pointing straight up at the sky, an excited open-mouthed smile",
  ),
  "p02-grownup.png": figure(
    PARENT,
    "walking to the right in side view, mid-stride, holding a lantern low in front of him, a calm happy face",
  ),
  "p02-hero.png": figure(
    CHILD,
    "running to the right in side view, both feet off the ground, arms swinging, laughing with the mouth wide open",
  ),
  "p03-hero.png": figure(
    CHILD,
    "standing on tiptoe facing the viewer, both arms stretched straight up over the head reaching for something high above, eyes looking up, a delighted face",
  ),
  "p04-grownup.png": figure(
    PARENT,
    "sitting cross-legged on the ground in three-quarter view turned to the right, leaning back on one hand, looking up and smiling",
    "1536x1024",
  ),
  "p04-hero.png": figure(
    CHILD,
    "sitting on the ground in three-quarter view turned to the right, hugging the knees, yawning sleepily with the eyes half closed",
    "1536x1024",
  ),
  // The stock characters' sheets.
  "hero-sheet.png": {
    prompt: `A character sheet of a 6-year-old girl with round cheeks and short bobbed hair with a fringe, wearing a chunky knitted jumper, dungarees and wellington boots: front, three-quarter and back views side by side, full body, on plain white paper, ${SAME}. No text, no frame.`,
    size: "1536x1024",
    refs: ["p01-plate.png"],
  },
  "grownup-sheet.png": {
    prompt: `A character sheet of a dad in his thirties with short wavy hair and a short beard, wearing a long wool coat, a scarf and walking boots: front, three-quarter and back views side by side, full body, on plain white paper, ${SAME}. No text, no frame.`,
    size: "1536x1024",
    refs: ["p01-plate.png"],
  },
};

const prices = { imageInput: 8, textInput: 5, output: 30 }; // US$ per million tokens (packages/core/src/providers/openai.ts)
let spent = 0;
const draw = async (name, job) => {
  const fields = { model: MODEL, prompt: job.prompt, size: job.size, quality: "medium", output_format: "png", n: "1" };
  let response;
  if (job.refs.length === 0) {
    response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ ...fields, n: 1 }),
    });
  } else {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
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
};
const wanted = Object.entries(jobs).filter(
  ([name]) => (!only.length || only.includes(name)) && !existsSync(`${out}/${name}`),
);
// The style anchor first: every other job reads it.
const anchor = wanted.find(([name]) => name === "p01-plate.png");
if (anchor) await draw(...anchor);
await Promise.all(wanted.filter(([name]) => name !== "p01-plate.png").map(([name, job]) => draw(name, job)));
console.log(`total $${spent.toFixed(3)}`);
