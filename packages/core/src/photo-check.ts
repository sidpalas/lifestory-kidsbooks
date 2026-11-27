// The photo check (D56): each uploaded photo is moderated, then looked at by a small vision model, and the rules below
// decide in code whether it can make a character sheet. `PHOTO_CHECK=fake` (the default) looks at nothing and refuses
// a photo whose file name contains `two-faces`, shows no face for `back-of-head`, and takes an extra photo whose name
// contains `other-person` as someone else and one with `unsure-person` as unsure, so tests and orbs make no API calls;
// `openai` calls OpenAI.
import type { JsonObject } from "absurd-sdk";
import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";
import sharp from "sharp";

import { ageOptions, type Age } from "./book-format/ages.ts";
import {
  EyeColour,
  HairColour,
  HairLength,
  HairTexture,
  type PhotoCheckResult,
  type PhotoIssue,
  type PhotoPose,
  PhotoReport,
  SkinTone,
} from "./contracts.ts";

export class PhotoCheckFailed extends Schema.TaggedError<PhotoCheckFailed>()("PhotoCheckFailed", {
  message: Schema.String,
}) {}

export type Moderation = PhotoReport["moderation"];
export type Inspection = Omit<PhotoReport, "moderation">;

export interface PhotoInput {
  readonly body: Uint8Array;
  readonly contentType: string;
  /** The file name the parent uploaded, which only the fake reads. */
  readonly fileName: string;
}

export class PhotoCheck extends Context.Service<
  PhotoCheck,
  {
    readonly name: string;
    /** Moderation scores, 0–1, for the categories the rules read. */
    readonly moderate: (photo: PhotoInput) => Effect.Effect<Moderation, PhotoCheckFailed>;
    /** The vision model's report on the main face and the photo. */
    readonly inspect: (
      photo: PhotoInput,
    ) => Effect.Effect<Inspection & { readonly usage?: JsonObject }, PhotoCheckFailed>;
    /**
     * Whether an extra photo shows the same person as the main photo, without saying who either is: "unsure" when
     * the extra photo doesn't show enough to tell, such as the back of their head.
     */
    readonly samePerson: (main: PhotoInput, extra: PhotoInput) => Effect.Effect<boolean | "unsure", PhotoCheckFailed>;
  }
>()("@lifestory/core/PhotoCheck") {}

/** The rules' thresholds, from the spike on 10 of Sid's photos (D56). */
export const photoRules = {
  /** Moderation refuses at these scores; `flagged` is too eager (a pool table scored violence 0.40). */
  sexual: 0.3,
  violence: 0.8,
  selfHarm: 0.8,
  /** A main face narrower than this can't carry a likeness. */
  minFaceWidthPx: 150,
  /** Warn when the apparent age is this many buckets or more from every age the role accepts. */
  ageWarnBuckets: 2,
} as const;

const issue = (code: string, message: string): PhotoIssue => ({ code, message });

/** Moderation's verdict alone: refusals, or none. A refused photo is deleted at once (D56). */
export const moderationRefusals = (moderation: Moderation): ReadonlyArray<PhotoIssue> =>
  moderation.sexual >= photoRules.sexual ||
  moderation.violence >= photoRules.violence ||
  moderation.selfHarm >= photoRules.selfHarm
    ? [issue("moderation", "We can't use this photo. Please choose an everyday photo of the person.")]
    : [];

const ageIndex = (age: Age) => ageOptions.findIndex((option) => option.id === age);

/** The extra photos that may not show the face (D56): the side or back of the hair, and another angle. */
const faceOptional = (pose: PhotoPose | undefined) => pose === "hair" || pose === "angle";

/**
 * The rules (D56): refuse with no visible main face, a second prominent face, a face under about 150 px across, or a
 * blurred face; background faces never refuse. An extra photo (`pose`) is refused when there's no passing main photo
 * to compare it with, or when it shows someone else; when the comparison can't tell, the expression photo is refused
 * and the hair and angle photos pass with a warning. The hair and angle photos need no visible face or face size, but
 * are refused when anyone else is close to the camera, and get no age warning. Warn on a hat, helmet, goggles or
 * sunglasses, poor light, and an age that doesn't match: one the role accepts but the parent didn't choose (the
 * sheet draws the chosen age, so a toddler chosen as a young child comes out about six), or one far from the role's.
 */
export const judgePhoto = (
  report: PhotoReport,
  role: { readonly ages: ReadonlyArray<Age>; readonly chosen?: Age },
  pose?: PhotoPose,
): PhotoCheckResult => {
  const refusals = [...moderationRefusals(report.moderation)];
  const warnings: Array<PhotoIssue> = [];
  const anyFace = faceOptional(pose);
  if (refusals.length === 0) {
    if (pose && report.samePerson === undefined)
      refusals.push(issue("no-main", "Add a main photo that works first, so we can compare this one with it."));
    else if (!anyFace && !report.mainFaceVisible)
      refusals.push(issue("no-face", "We couldn't see a face clearly. Choose a photo where the face is in view."));
    else if (report.prominentFaces > 1 || (anyFace && (report.otherPeopleClose ?? 0) > 0))
      refusals.push(
        issue("two-faces", "There's more than one person close to the camera. Crop the photo to just this person."),
      );
    else if (!anyFace && report.mainFaceWidthPx < photoRules.minFaceWidthPx)
      refusals.push(issue("small-face", "The face is too small. Choose a closer photo, or crop it around the face."));
    else if (report.sharpness === "blurred")
      refusals.push(
        issue(
          "blurred",
          anyFace ? "The photo is blurred. Choose a sharper one." : "The face is blurred. Choose a sharper photo.",
        ),
      );
    else if (report.samePerson === false)
      refusals.push(issue("other-person", "This looks like a different person from the first photo."));
    else if (report.samePerson === "unsure" && !anyFace)
      refusals.push(
        issue(
          "unsure-person",
          "We couldn't tell whether this is the same person as the first photo. Choose a clearer one.",
        ),
      );
    else if (report.samePerson === "unsure")
      warnings.push(
        issue(
          "unsure-person",
          "We couldn't tell from this photo whether it's the same person as the first one. Keep it only if it is.",
        ),
      );
  }
  if (refusals.length === 0) {
    const covered = report.occlusions.filter((o) => ["hat", "helmet", "sunglasses", "goggles"].includes(o));
    if (covered.length > 0)
      warnings.push(
        issue("covered", `The ${covered.join(" and ")} may hide the hair or eyes, so the drawing may guess them.`),
      );
    if (report.lighting !== "good")
      warnings.push(issue("lighting", "The light is poor, so colours may come out wrong."));
    const ages = role.ages.map(ageIndex);
    const distance = Math.min(...ages.map((age) => Math.abs(age - ageIndex(report.apparentAge))));
    const looks = ageOptions[ageIndex(report.apparentAge)]!;
    // A photo from the side or behind shows too little for an age; the main photo's warning covers it.
    if (!anyFace && role.chosen && role.chosen !== report.apparentAge && role.ages.includes(report.apparentAge)) {
      const chosen = ageOptions[ageIndex(role.chosen)]!;
      warnings.push(
        issue(
          "age",
          `This photo looks like a ${looks.label.toLowerCase()} (${looks.years}), but you chose ` +
            `${chosen.label.toLowerCase()} (${chosen.years}). We draw them at the age you choose, so change it if that's wrong.`,
        ),
      );
    } else if (!anyFace && distance >= photoRules.ageWarnBuckets)
      warnings.push(
        issue(
          "age",
          "The person looks far from this role's age. That's fine: the drawing shows them at the age you chose.",
        ),
      );
  }
  return { status: refusals.length > 0 ? "refused" : "passed", refusals, warnings, report };
};

/** The fake check: a clean photo, or what the file name says (`two-faces`, `back-of-head`, `other-person`, `unsure-person`). */
export const FakePhotoCheck = Layer.succeed(PhotoCheck, {
  name: "fake",
  moderate: () => Effect.succeed({ sexual: 0, violence: 0, selfHarm: 0 }),
  inspect: (photo) =>
    Effect.succeed({
      prominentFaces: photo.fileName.includes("two-faces") ? 2 : photo.fileName.includes("back-of-head") ? 0 : 1,
      backgroundFaces: 0,
      otherPeopleClose: photo.fileName.includes("two-faces") ? 1 : 0,
      mainFaceVisible: !photo.fileName.includes("back-of-head"),
      mainFaceWidthPx: photo.fileName.includes("back-of-head") ? 0 : 400,
      sharpness: "sharp" as const,
      lighting: "good" as const,
      occlusions: [],
      apparentAge: "young-child" as const,
      hairColour: "brown" as const,
      hairLength: "short" as const,
      hairTexture: "wavy" as const,
      eyeColour: "brown" as const,
      skinTone: "light" as const,
      glasses: false,
      freckles: false,
      facialHair: "none" as const,
      tip: "",
    }),
  samePerson: (_main, extra) =>
    Effect.succeed(
      extra.fileName.includes("other-person") ? false : extra.fileName.includes("unsure-person") ? "unsure" : true,
    ),
});

const visionPrompt = `You check a photo a parent uploaded so an illustrator can draw the main person in a children's book.
Do not identify the person or guess who they are. Describe only what is visible.
- prominentFaces: faces near the camera and in focus, the main person included. backgroundFaces: small, distant or out-of-focus faces.
- otherPeopleClose: people other than the main person near the camera and in focus, counted whether or not their face shows.
- mainFaceVisible: whether the main person's face is clearly in view (not turned away, not covered).
- mainFaceWidth: the main face's width as a fraction of the image width (0-1), 0 when it isn't in view.
- sharpness of the main face, or of the main person's head when the face isn't in view; lighting of the photo; occlusions on the main person's head or face.
- apparentAge: the age bucket the main person looks.
- hairColour, hairLength, hairTexture: the main person's hair from the lists, each null when it is hidden (hairLength "none" for a bald head).
- eyeColour and skinTone from the lists, each null when you can't tell; glasses and freckles, null when you can't tell.
- tip: one short sentence for the parent on how to take a better photo, or "" when the photo is good.`;

const { moderation: _moderation, mainFaceWidthPx: _width, ...visionFields } = PhotoReport.fields;
const VisionReply = Schema.Struct({
  ...visionFields,
  hairLength: Schema.NullOr(HairLength),
  hairTexture: Schema.NullOr(HairTexture),
  eyeColour: Schema.NullOr(EyeColour),
  skinTone: Schema.NullOr(SkinTone),
  glasses: Schema.NullOr(Schema.Boolean),
  freckles: Schema.NullOr(Schema.Boolean),
  mainFaceWidth: Schema.Number,
  otherPeopleClose: Schema.Number,
});
const nullable = (literals: ReadonlyArray<string>) => ({ type: ["string", "null"], enum: [...literals, null] });

const visionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "prominentFaces",
    "backgroundFaces",
    "otherPeopleClose",
    "mainFaceVisible",
    "mainFaceWidth",
    "sharpness",
    "lighting",
    "occlusions",
    "apparentAge",
    "hairColour",
    "hairLength",
    "hairTexture",
    "eyeColour",
    "skinTone",
    "glasses",
    "freckles",
    "facialHair",
    "tip",
  ],
  properties: {
    prominentFaces: { type: "integer" },
    backgroundFaces: { type: "integer" },
    otherPeopleClose: { type: "integer" },
    mainFaceVisible: { type: "boolean" },
    mainFaceWidth: { type: "number" },
    sharpness: { type: "string", enum: ["sharp", "soft", "blurred"] },
    lighting: { type: "string", enum: ["good", "dim", "harsh"] },
    occlusions: {
      type: "array",
      items: { type: "string", enum: ["hat", "helmet", "sunglasses", "goggles", "mask", "hand", "other"] },
    },
    apparentAge: { type: "string", enum: ageOptions.map((option) => option.id) },
    hairColour: nullable(HairColour.literals),
    hairLength: nullable(HairLength.literals),
    hairTexture: nullable(HairTexture.literals),
    eyeColour: nullable(EyeColour.literals),
    skinTone: nullable(SkinTone.literals),
    glasses: { type: ["boolean", "null"] },
    freckles: { type: ["boolean", "null"] },
    facialHair: { type: "string", enum: ["none", "stubble", "moustache", "beard"] },
    tip: { type: "string" },
  },
};

const samePersonPrompt = `Two photos a parent uploaded of one family member for a children's book illustrator.
Do not identify the people or guess who they are. Say only whether the main person in the second photo looks like the
same person as the main person in the first, allowing for a different expression, angle, hairstyle, light or a few
years of age. The second photo may show them from the side or from behind: then judge from what it shows, such as the
hair, build, skin tone and clothes.
Answer "same" when they look like the same person, "different" when they look like someone else, and "unsure" only
when the second photo doesn't show enough of them to tell.`;
const SamePersonReply = Schema.Struct({ samePerson: Schema.Literals(["same", "different", "unsure"]) });
const samePersonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["samePerson"],
  properties: { samePerson: { type: "string", enum: ["same", "different", "unsure"] } },
};

const dataUrl = (photo: PhotoInput) => `data:${photo.contentType};base64,${Buffer.from(photo.body).toString("base64")}`;

/** OpenAI: `omni-moderation-latest`, then OPENAI_CHECK_MODEL (`gpt-5.4-mini`) through /v1/responses (D56). */
export const OpenAIPhotoCheck = Layer.effect(
  PhotoCheck,
  Effect.gen(function* () {
    const apiKey = yield* Config.Redacted("OPENAI_API_KEY");
    const model = yield* Config.String("OPENAI_CHECK_MODEL").pipe(Config.withDefault("gpt-5.4-mini"));
    const endpoint = yield* Config.String("OPENAI_BASE_URL").pipe(Config.withDefault("https://api.openai.com/v1"));

    const post = (path: string, body: unknown) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(`${endpoint}${path}`, {
              method: "POST",
              headers: { authorization: `Bearer ${Redacted.value(apiKey)}`, "content-type": "application/json" },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(60_000),
            }),
          catch: (error) => new PhotoCheckFailed({ message: `request failed: ${String(error)}` }),
        });
        const text = yield* Effect.promise(() => response.text());
        if (!response.ok)
          return yield* new PhotoCheckFailed({ message: `OpenAI returned ${response.status}: ${text.slice(0, 300)}` });
        return JSON.parse(text) as Record<string, any>;
      });

    const responseJson = (content: ReadonlyArray<unknown>, name: string, schema: object) =>
      post("/responses", {
        model,
        input: [{ role: "user", content }],
        text: { format: { type: "json_schema", name, strict: true, schema } },
      }).pipe(
        Effect.flatMap((body) => {
          const text = (body.output ?? [])
            .flatMap((item: any) => item.content ?? [])
            .find((part: any) => part.type === "output_text")?.text;
          return Effect.try({
            try: () => ({ reply: JSON.parse(String(text)) as unknown, body }),
            catch: () => new PhotoCheckFailed({ message: `unreadable reply: ${String(text).slice(0, 200)}` }),
          });
        }),
      );

    return {
      name: `openai:${model}`,
      samePerson: (main, extra) =>
        responseJson(
          [
            { type: "input_text", text: samePersonPrompt },
            { type: "input_image", image_url: dataUrl(main) },
            { type: "input_image", image_url: dataUrl(extra) },
          ],
          "same_person",
          samePersonSchema,
        ).pipe(
          Effect.flatMap(({ reply }) => Schema.decodeUnknownEffect(SamePersonReply)(reply)),
          Effect.mapError((error) =>
            error instanceof PhotoCheckFailed ? error : new PhotoCheckFailed({ message: String(error) }),
          ),
          Effect.map((reply) => (reply.samePerson === "unsure" ? "unsure" : reply.samePerson === "same")),
        ),
      moderate: (photo) =>
        post("/moderations", {
          model: "omni-moderation-latest",
          input: [{ type: "image_url", image_url: { url: dataUrl(photo) } }],
        }).pipe(
          Effect.map((body) => {
            const scores = body.results?.[0]?.category_scores ?? {};
            return { sexual: scores.sexual ?? 0, violence: scores.violence ?? 0, selfHarm: scores["self-harm"] ?? 0 };
          }),
        ),
      inspect: (photo) =>
        Effect.gen(function* () {
          const body = yield* post("/responses", {
            model,
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: visionPrompt },
                  { type: "input_image", image_url: dataUrl(photo) },
                ],
              },
            ],
            text: { format: { type: "json_schema", name: "photo_report", strict: true, schema: visionSchema } },
          });
          const text = (body.output ?? [])
            .flatMap((item: any) => item.content ?? [])
            .find((part: any) => part.type === "output_text")?.text;
          const reply = yield* Effect.try({
            try: () => JSON.parse(String(text)),
            catch: () => new PhotoCheckFailed({ message: `unreadable reply: ${String(text).slice(0, 200)}` }),
          }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(VisionReply)),
            Effect.mapError((error) => new PhotoCheckFailed({ message: String(error) })),
          );
          const { width = 0 } = yield* Effect.promise(() => sharp(photo.body).metadata());
          const { mainFaceWidth, ...rest } = reply;
          return {
            ...rest,
            mainFaceWidthPx: Math.round(mainFaceWidth * width),
            ...(body.usage ? { usage: { model, ...body.usage } } : {}),
          };
        }),
    };
  }),
);
