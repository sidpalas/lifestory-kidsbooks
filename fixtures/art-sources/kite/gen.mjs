// Paints the demo's outside art with OpenAI, like an illustrator's tool would. Skips files that exist.
import { existsSync, writeFileSync } from "node:fs";
const out = process.argv[2];
const STYLE = "Children's picture-book illustration in opaque gouache with a thin dark-brown ink outline, flat soft shapes, visible brush texture on warm paper.";
const KID = "a 6-year-old girl with warm light-brown skin, rosy cheeks, a big open smile, and short curly dark-brown hair, wearing a sunflower-yellow T-shirt, teal shorts and red sneakers, arms and legs showing, standing upright facing the viewer";
const jobs = {
  "p01-flat.png": [`${STYLE} A windy meadow on a bright spring morning: ${KID}, holding the string of a red kite flying high in the blue sky, standing in the middle of the picture, her whole body visible and about half the picture's height. Rolling green hills, a few wildflowers, soft white clouds. Keep the bottom fifth calm and light (pale grass) so text can sit on it. No text.`, "1024x1024"],
  "p02-plate.png": [`${STYLE} Background plate: the same windy meadow at golden late afternoon, a big round oak tree on the left, rolling hills, a red kite caught in the oak's branches, warm peach sky. No people, no animals, no text. Keep the bottom fifth calm and light so text can sit on it.`, "1024x1024"],
  "p02-kid.png": [`${STYLE} A full-body front view of ${KID}, looking up with a surprised happy face, on plain white paper with nothing else: no scenery, no ground, no shadow, no text. The whole figure fits in the frame with generous margin.`, "1024x1536"],
};
let spent = 0;
await Promise.all(Object.entries(jobs).map(async ([name, [prompt, size]]) => {
  if (existsSync(`${out}/${name}`)) return;
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-2.6-sunburst", prompt, size, quality: "medium", output_format: "png", n: 1 }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${name}: ${JSON.stringify(body).slice(0, 400)}`);
  writeFileSync(`${out}/${name}`, Buffer.from(body.data[0].b64_json, "base64"));
  const u = body.usage ?? {};
  const cost = ((u.input_tokens ?? 0) * 5 + (u.output_tokens ?? 0) * 30) / 1e6;
  spent += cost;
  console.log(name, JSON.stringify(u), `$${cost.toFixed(3)}`);
}));
console.log(`total $${spent.toFixed(3)}`);
