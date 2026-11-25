// Client-safe schemas shared by the web app's server functions and its UI.
// Nothing here may import Node-only modules: the browser bundle imports this file.
import { Schema } from "effect";

import { Age, CastMember, PronounSet, StoryDraft, StoryManifest, TextStyleName } from "./book-format/index.ts";

export * from "./book-format/index.ts";
export * from "./errors.ts";
export * from "./rpc.ts";

/**
 * Widths in pixels of the WebP screen copies `/api/files/<key>?w=<width>` serves of PNG, JPEG, and WebP art, never
 * upscaled: 512 for thumbnails, 1536 for a page on a 2x screen. On-screen pages pick one by their size; print always
 * loads the original.
 */
export const SCREEN_WIDTHS: ReadonlyArray<number> = [512, 1536];

/** Better Auth's minimum, and what every password form checks before submitting. */
export const MIN_PASSWORD_LENGTH = 12;

export const StorySummary = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  title: Schema.String,
  summary: Schema.String,
  authorName: Schema.String,
});
export type StorySummary = typeof StorySummary.Type;

export const FamilyMembership = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Schema.String,
});
export type FamilyMembership = typeof FamilyMembership.Type;

/** Roles a family member can invite someone with: "parent" (shown as Editor) edits books, "viewer" only reads them. */
export const InviteRole = Schema.Literals(["parent", "viewer"]);
export type InviteRole = typeof InviteRole.Type;

/** The longest family name: room for "The Okonkwo-Fitzgerald family" and then some, short enough for the switcher. */
export const FAMILY_NAME_MAX_LENGTH = 60;
/** A family name as typed: trimmed, not empty. Better Auth's update hook checks the same rule (auth.ts). */
export const FamilyName = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(FAMILY_NAME_MAX_LENGTH));

export const FamilyOverview = Schema.Struct({
  ...FamilyMembership.fields,
  /** Only owners may rename (`organization: update`, D3). */
  canRename: Schema.Boolean,
  canInvite: Schema.Boolean,
  canEditBooks: Schema.Boolean,
  members: Schema.Array(
    Schema.Struct({ userId: Schema.String, name: Schema.String, email: Schema.String, role: Schema.String }),
  ),
  invitations: Schema.Array(Schema.Struct({ id: Schema.String, email: Schema.String, role: Schema.String })),
});
export type FamilyOverview = typeof FamilyOverview.Type;

export const InvitationDetails = Schema.Struct({
  email: Schema.String,
  role: Schema.String,
  familyName: Schema.String,
  inviterName: Schema.String,
  /** Whether the invited email already has an account (then they sign in and accept). */
  hasAccount: Schema.Boolean,
});
export type InvitationDetails = typeof InvitationDetails.Type;

/**
 * How a person looks (D56): what the photo check reads from the photo, which the parent confirms or corrects before
 * the sheet is drawn, and the sheet prompt puts in words. Each option has a swatch for the confirmation chips.
 */
export const hairColours = [
  { id: "black", label: "Black", swatch: "#1d1a19" },
  { id: "dark-brown", label: "Dark brown", swatch: "#3b2618" },
  { id: "brown", label: "Brown", swatch: "#5e3b22" },
  { id: "light-brown", label: "Light brown", swatch: "#8a5d3b" },
  { id: "dark-blond", label: "Dark blond", swatch: "#a7814f" },
  { id: "blond", label: "Blond", swatch: "#d6b26e" },
  { id: "platinum", label: "Platinum blond", swatch: "#eadcb4" },
  { id: "auburn", label: "Auburn", swatch: "#7c3a1d" },
  { id: "red", label: "Red", swatch: "#b04a22" },
  { id: "strawberry-blond", label: "Strawberry blond", swatch: "#d39a66" },
  { id: "grey", label: "Grey", swatch: "#9a9895" },
  { id: "white", label: "White", swatch: "#e9e7e2" },
] as const;
export const HairColour = Schema.Literals(hairColours.map((colour) => colour.id));
export type HairColour = typeof HairColour.Type;

/**
 * Hair lengths and textures, each with what it means for the parent choosing it (Sid, 2026-11-25). The sheet prompt
 * says the label ("chin to shoulder, wavy, brown hair"), so a description only spells out what that label means.
 */
export const hairLengths = [
  { id: "none", label: "No hair", description: "Bald, or shaved to the skin." },
  { id: "very-short", label: "Very short", description: "Cropped close to the head, like a buzz cut." },
  { id: "short", label: "Short", description: "Above the ears and collar." },
  { id: "medium", label: "Chin to shoulder", description: "Covers the ears and ends between chin and shoulders." },
  { id: "long", label: "Long", description: "Reaches past the shoulders." },
] as const;
export const HairLength = Schema.Literals(hairLengths.map((length) => length.id));

export const hairTextures = [
  { id: "straight", label: "Straight", description: "Falls flat, with no bend." },
  { id: "wavy", label: "Wavy", description: "Loose S-shaped bends, not full loops." },
  { id: "curly", label: "Curly", description: "Springy loops or ringlets you could fit a finger in." },
  { id: "coily", label: "Coily", description: "Tight coils or zigzags, often dense and springy." },
] as const;
export const HairTexture = Schema.Literals(hairTextures.map((texture) => texture.id));

export const eyeColours = [
  { id: "dark-brown", label: "Dark brown", swatch: "#3a2414" },
  { id: "brown", label: "Brown", swatch: "#6b4423" },
  { id: "hazel", label: "Hazel", swatch: "#8e7240" },
  { id: "green", label: "Green", swatch: "#5f7d4a" },
  { id: "blue", label: "Blue", swatch: "#4f7fb0" },
  { id: "grey", label: "Grey", swatch: "#8b959c" },
] as const;
export const EyeColour = Schema.Literals(eyeColours.map((colour) => colour.id));

/** Six tones, lightest to deepest. */
export const skinTones = [
  { id: "very-light", label: "Very light", swatch: "#f6e0d0" },
  { id: "light", label: "Light", swatch: "#eac3a6" },
  { id: "light-medium", label: "Light medium", swatch: "#d4a07a" },
  { id: "medium", label: "Medium", swatch: "#b37a52" },
  { id: "medium-deep", label: "Medium deep", swatch: "#8a5537" },
  { id: "deep", label: "Deep", swatch: "#5a3423" },
] as const;
export const SkinTone = Schema.Literals(skinTones.map((tone) => tone.id));

/**
 * A look: each attribute, or null where the photo didn't show it and nobody set it. The photo check reads one; the
 * parent's corrections (`LookChoices`) go over it, and the sheet is drawn from the result (`lookOf`).
 */
export const Look = Schema.Struct({
  hairColour: Schema.NullOr(HairColour),
  hairLength: Schema.NullOr(HairLength),
  hairTexture: Schema.NullOr(HairTexture),
  eyeColour: Schema.NullOr(EyeColour),
  skinTone: Schema.NullOr(SkinTone),
  glasses: Schema.NullOr(Schema.Boolean),
  freckles: Schema.NullOr(Schema.Boolean),
});
export type Look = typeof Look.Type;
export type LookKey = keyof Look;
export const lookKeys = Object.keys(Look.fields) as ReadonlyArray<LookKey>;

/** What the parent set for a person, attribute by attribute; anything absent comes from the photo. */
export const LookChoices = Schema.Struct({
  hairColour: Schema.optionalKey(HairColour),
  hairLength: Schema.optionalKey(HairLength),
  hairTexture: Schema.optionalKey(HairTexture),
  eyeColour: Schema.optionalKey(EyeColour),
  skinTone: Schema.optionalKey(SkinTone),
  glasses: Schema.optionalKey(Schema.Boolean),
  freckles: Schema.optionalKey(Schema.Boolean),
});
export type LookChoices = typeof LookChoices.Type;

/** The look a sheet draws: the parent's choice for each attribute, else what the photo showed, else null. */
export const lookOf = (photo: Partial<Look> | null | undefined, choices: LookChoices): Look =>
  Object.fromEntries(lookKeys.map((key) => [key, choices[key] ?? photo?.[key] ?? null])) as unknown as Look;

/**
 * Who plays a role in one book (D56): a name, what the children call them, pronouns for the text, and an age the role
 * accepts, which the character sheet draws them at. Each book keeps its own copy; `personId` links it to the family's
 * person it was picked as (D61).
 */
export const CastPerson = Schema.Struct({
  name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(60)),
  title: Schema.NullOr(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(30))),
  pronouns: PronounSet,
  age: Age,
  /** What the parent set of their look (D56); carried to the next book that picks them, photos never are. */
  look: Schema.optionalKey(LookChoices),
  /** The family's person (D61) this is, when picked from People or linked at the order. */
  personId: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type CastPerson = typeof CastPerson.Type;

/** A person on the People page (D61): who they are now, the ordered books they're in, and whether they're archived. */
export const FamilyPerson = Schema.Struct({
  id: Schema.String,
  person: CastPerson,
  books: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
  archived: Schema.Boolean,
});
export type FamilyPerson = typeof FamilyPerson.Type;

const Rect = Schema.Tuple([Schema.Number, Schema.Number, Schema.Number, Schema.Number]);

/** A cover page's illustration as a list shows it, without its text; nothing is drawn for a thumbnail. */
export const CoverThumbnail = Schema.Struct({
  /** The illustration area's size, for its shape. */
  widthIn: Schema.Number,
  heightIn: Schema.Number,
  layers: Schema.Array(Schema.Struct({ key: Schema.String, rect: Rect })),
});
export type CoverThumbnail = typeof CoverThumbnail.Type;

/** A family's book, as listed. */
export const BookSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  storySlug: Schema.String,
  storyTitle: Schema.String,
  /** The story version the book pins. */
  version: Schema.Number,
  cast: Schema.String,
  status: Schema.String,
  /**
   * The book's cover: the cover page as drawn for the book, else the cover drawn from its character sheets, else the
   * story version's stock figures (D56).
   */
  cover: Schema.NullOr(CoverThumbnail),
});
export type BookSummary = typeof BookSummary.Type;

/** Who fills one role of a book: the person as entered, and as the text names them. */
export const BookRole = Schema.Struct({
  slotId: Schema.String,
  person: CastPerson,
  member: CastMember,
});
export type BookRole = typeof BookRole.Type;

/** A text block of a book page: the story's content, the family's edit if any, and the text as printed. */
export const BookTextBlock = Schema.Struct({
  style: TextStyleName,
  original: Schema.String,
  edited: Schema.NullOr(Schema.String),
  text: Schema.String,
});
export type BookTextBlock = typeof BookTextBlock.Type;

/** A published story in the catalogue, with its cover: the cover page's illustration with the stock figures (D56). */
export const StoryListing = Schema.Struct({
  ...StorySummary.fields,
  /** Listed only for operators (D60): a story for testing the pipeline that families never see. */
  operatorOnly: Schema.Boolean,
  cover: Schema.NullOr(CoverThumbnail),
});
export type StoryListing = typeof StoryListing.Type;

/** Everything BookPage needs to draw a family's book, editor and print alike. */
export const BookView = Schema.Struct({
  book: Schema.Struct({ id: Schema.String, familyId: Schema.String, title: Schema.String }),
  story: Schema.Struct({ id: Schema.String, slug: Schema.String, title: Schema.String, authorName: Schema.String }),
  version: Schema.Number,
  manifest: StoryManifest,
  roles: Schema.Array(BookRole),
  /** Who fills each slot, for the text tokens and BookPage's guides. */
  cast: Schema.Record(Schema.String, CastMember),
  /** Each page's illustration as storage keys and its text. */
  pages: Schema.Array(
    Schema.Struct({
      pageId: Schema.String,
      layers: Schema.Array(Schema.Struct({ key: Schema.String, rect: Rect })),
      text: Schema.Array(BookTextBlock),
    }),
  ),
  /** Where the photo book is (D56, D57). */
  flow: Schema.suspend((): Schema.Codec<BookFlow> => BookFlow),
});
export type BookView = typeof BookView.Type;

export const TaskState = Schema.Literals(["pending", "running", "sleeping", "completed", "failed", "cancelled"]);
export type TaskState = typeof TaskState.Type;

/**
 * What a proof shows besides the story version: who fills each slot and the family's text edits, fixed when the
 * proof is requested (D27).
 */
export const ProofContent = Schema.Struct({
  cast: Schema.Record(Schema.String, CastMember),
  /** Replaces block `blockIndex` of page `pageId`; tokens stay unresolved, like the story's own text. */
  textEdits: Schema.Array(Schema.Struct({ pageId: Schema.String, blockIndex: Schema.Number, content: Schema.String })),
  /** Each drawn page's layers in the chosen version (D57), so a later change doesn't alter the proof. */
  art: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Array(Schema.Struct({ key: Schema.String, rect: Rect }))),
  ),
});
export type ProofContent = typeof ProofContent.Type;

/** A proof as the family sees it. "failed" means the render task gave up after its retries. */
export const ProofSummary = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["rendering", "ready", "failed"]),
  /** The PDF's key under /api/files, once ready. */
  objectKey: Schema.NullOr(Schema.String),
  pageCount: Schema.NullOr(Schema.Number),
  bytes: Schema.NullOr(Schema.Number),
  /** ISO 8601. */
  createdAt: Schema.String,
  requestedBy: Schema.NullOr(Schema.String),
  /** When a parent approved it for print (ISO 8601), and their name; null until then. */
  approvedAt: Schema.NullOr(Schema.String),
  approvedBy: Schema.NullOr(Schema.String),
  /** When an unapproved proof is deleted (ISO 8601, D31); null once approved. */
  expiresAt: Schema.NullOr(Schema.String),
  /** Who fills each slot, by name, in slot order, so proofs of different casts can be told apart. */
  castNames: Schema.Array(Schema.String),
  /** Whether it shows the book as it is now: the same cast, text and chosen page drawings. */
  current: Schema.Boolean,
});
export type ProofSummary = typeof ProofSummary.Type;

/** A story as its author lists it (D37): the version being drafted, if any, and the newest published one. */
export const AuthoredStory = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  title: Schema.String,
  summary: Schema.String,
  status: Schema.String,
  operatorOnly: Schema.Boolean,
  draftVersion: Schema.NullOr(Schema.Number),
  publishedVersion: Schema.NullOr(Schema.Number),
});
export type AuthoredStory = typeof AuthoredStory.Type;

/** A story draft in the authoring editor (D37): its manifest as saved, and every page composed with the stock figures. */
export const DraftView = Schema.Struct({
  story: Schema.Struct({
    id: Schema.String,
    slug: Schema.String,
    title: Schema.String,
    summary: Schema.String,
    status: Schema.String,
  }),
  storyVersionId: Schema.String,
  version: Schema.Number,
  revision: Schema.Number,
  draft: StoryDraft,
  pages: Schema.Array(
    Schema.Struct({ pageId: Schema.String, layers: Schema.Array(Schema.Struct({ key: Schema.String, rect: Rect })) }),
  ),
});
export type DraftView = typeof DraftView.Type;

/** What the photo check saw (D56): moderation scores and the vision model's report, never who the person is. */
export const PhotoReport = Schema.Struct({
  moderation: Schema.Struct({ sexual: Schema.Number, violence: Schema.Number, selfHarm: Schema.Number }),
  /** Faces in focus and near the camera, the main one included. */
  prominentFaces: Schema.Number,
  /** Bystanders: small or out of focus; they never refuse a photo. */
  backgroundFaces: Schema.Number,
  mainFaceVisible: Schema.Boolean,
  /** The main face's width in pixels of the uploaded image. */
  mainFaceWidthPx: Schema.Number,
  sharpness: Schema.Literals(["sharp", "soft", "blurred"]),
  lighting: Schema.Literals(["good", "dim", "harsh"]),
  occlusions: Schema.Array(Schema.Literals(["hat", "helmet", "sunglasses", "goggles", "mask", "hand", "other"])),
  apparentAge: Age,
  hairColour: Schema.NullOr(HairColour),
  /** The rest of the look (D56, 2026-11-25); absent from reports stored before. Null where the photo hides it. */
  hairLength: Schema.optionalKey(Schema.NullOr(HairLength)),
  hairTexture: Schema.optionalKey(Schema.NullOr(HairTexture)),
  eyeColour: Schema.optionalKey(Schema.NullOr(EyeColour)),
  skinTone: Schema.optionalKey(Schema.NullOr(SkinTone)),
  glasses: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  freckles: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  facialHair: Schema.Literals(["none", "stubble", "moustache", "beard"]),
  tip: Schema.String,
  /** An extra photo only: whether it shows the same person as the main photo; absent when there was none to compare. */
  samePerson: Schema.optionalKey(Schema.Boolean),
});
export type PhotoReport = typeof PhotoReport.Type;

/**
 * The extra photos a person may have (D56, Sid 2026-11-25), one slot each, all optional: what one photo can't show.
 * One slot per pose, not one multi-file input, because a phone camera returns one photo per launch.
 */
export const photoPoses = [
  { id: "expression", label: "A different expression", hint: "Laughing, or a face they often make." },
  { id: "hair", label: "The side or back of their hair", hint: "So we see its length and shape from behind." },
  { id: "angle", label: "From another angle", hint: "Turned partly away, or in profile." },
] as const;
export const PhotoPose = Schema.Literals(photoPoses.map((pose) => pose.id));
export type PhotoPose = typeof PhotoPose.Type;

/** A refusal or warning, for the parent. */
export const PhotoIssue = Schema.Struct({ code: Schema.String, message: Schema.String });
export type PhotoIssue = typeof PhotoIssue.Type;

/** The check's verdict on one photo, stored on the book's likeness. */
export const PhotoCheckResult = Schema.Struct({
  status: Schema.Literals(["passed", "refused"]),
  refusals: Schema.Array(PhotoIssue),
  warnings: Schema.Array(PhotoIssue),
  /** Absent when moderation refused it before the vision check. */
  report: Schema.NullOr(PhotoReport),
});
export type PhotoCheckResult = typeof PhotoCheckResult.Type;

/** The policies' version (D58), recorded with each consent; change it whenever a policy's text changes. */
export const POLICY_VERSION = "2026-11-25.2";

/**
 * What OpenAI keeps of what we send (D56), as OPENAI_DATA_RETENTION states it for the OpenAI project: "standard"
 * (OpenAI's API terms: no training, kept up to 30 days for abuse monitoring) or "zero" (zero data retention). The
 * policies, the consent statement and the landing page say the same; each consent records which one the parent read.
 */
export const DataRetention = Schema.Literals(["standard", "zero"]);
export type DataRetention = typeof DataRetention.Type;

/** The retention sentences, for each state; `{{openai-retention}}` in the policies' Markdown is `policy`. */
export const retentionCopy = {
  zero: {
    consent: "OpenAI checks each photo and draws a character sheet from it under zero data retention",
    landing:
      "Your photos are sent to OpenAI only to check them and draw the character sheets, under zero data retention: OpenAI doesn't keep them or use them to train its models.",
    policy:
      "We use OpenAI under zero data retention: they don't keep or train on what we send, except that OpenAI keeps an image its safety classifier flags as possible child sexual abuse material, for manual review.",
  },
  standard: {
    consent:
      "OpenAI checks each photo and draws a character sheet from it (OpenAI doesn't train on it, but may keep it for up to 30 days to monitor for abuse)",
    landing:
      "Your photos are sent to OpenAI only to check them and draw the character sheets. OpenAI doesn't use them to train its models, but may keep them for up to 30 days to monitor for abuse.",
    policy:
      "OpenAI doesn't train on what we send through its API, but may keep it for up to 30 days to monitor for abuse, under OpenAI's standard API terms. We plan to move to zero data retention, where OpenAI keeps nothing (except an image its safety classifier flags as possible child sexual abuse material, for manual review), and will update this policy then.",
  },
} as const satisfies Record<DataRetention, unknown>;

/** The policy version a consent records: the text's date and the retention it described. */
export const policyVersion = (retention: DataRetention) => `${POLICY_VERSION}/${retention}`;

/** What the parent agrees to at the photo step (D58); the last is optional. */
export const consentStatements = (retention: DataRetention) =>
  [
    { id: "adult", required: true, text: "I'm 18 or older." },
    {
      id: "rights",
      required: true,
      text: "I have the right to use each photo: I'm the parent or guardian of any child in it, and any adult in it agreed.",
    },
    {
      id: "processing",
      required: true,
      text: `I understand how photos are used: ${retentionCopy[retention].consent}, and the photos are deleted once I order the book, or after 24 hours if I don't.`,
    },
    {
      id: "photo-review",
      required: false,
      text: "Optional: Lifestory's team may see the photos while reviewing my book, to judge the likeness. They're deleted when the book is approved, or 30 days after the order at most.",
    },
  ] as const;

/**
 * How many sheets a parent may have drawn of each person, the first included: each note or new photo after the first
 * sheet uses one (D56, Sid 2026-11-25). And how many pages they may change (D57).
 */
export const MAX_SHEET_DRAWS = 3;
export const MAX_PAGE_CHANGES = 3;

export const BookStatus = Schema.Literals([
  "draft",
  "ordered",
  "making",
  "changes",
  "in_review",
  "approved",
  "refused",
]);
export type BookStatus = typeof BookStatus.Type;

const Layer = Schema.Struct({ key: Schema.String, rect: Rect });

/** A photo book's progress (D56, D57): what each step of the book page shows. */
export const BookFlow = Schema.Struct({
  status: BookStatus,
  /** What OpenAI keeps of the photos, for the consent statement. */
  retention: DataRetention,
  photoReview: Schema.Boolean,
  consented: Schema.Boolean,
  likenessStatus: Schema.Literals(["waiting", "drawing", "ready", "failed"]),
  /** The cover page with the drawn figures, once the sheets are drawn. */
  cover: Schema.NullOr(Schema.Struct({ pageId: Schema.String, layers: Schema.Array(Layer) })),
  likenesses: Schema.Array(
    Schema.Struct({
      slotId: Schema.String,
      checkStatus: Schema.NullOr(Schema.Literals(["checking", "passed", "refused"])),
      check: Schema.NullOr(PhotoCheckResult),
      /** Whether the photo is still kept, and its key for the family (and the operator on an opted-in book). */
      photoKey: Schema.NullOr(Schema.String),
      sheetKey: Schema.NullOr(Schema.String),
      /** The person's head in several expressions, drawn from the sheet; null on sheets drawn before them. */
      expressionsKey: Schema.NullOr(Schema.String),
      /** Sheets started for this person, the first included, out of MAX_SHEET_DRAWS; and whether one is drawing. */
      draws: Schema.Number,
      drawing: Schema.Boolean,
      notes: Schema.Array(Schema.Struct({ round: Schema.Number, note: Schema.String })),
      /** The person's extra photos, one per pose they filled. */
      poses: Schema.Array(
        Schema.Struct({
          pose: PhotoPose,
          checkStatus: Schema.Literals(["checking", "passed", "refused"]),
          check: Schema.NullOr(PhotoCheckResult),
          photoKey: Schema.NullOr(Schema.String),
        }),
      ),
    }),
  ),
  /** Pages with figures, once the book is ordered: each drawn version's layers, and the chosen one. */
  pages: Schema.Array(
    Schema.Struct({
      pageId: Schema.String,
      latestVersion: Schema.Number,
      chosenVersion: Schema.Number,
      ready: Schema.Boolean,
      changeNote: Schema.NullOr(Schema.String),
      /** The operator's note on this page, from a refusal (D57). */
      reviewNote: Schema.NullOr(Schema.String),
      versions: Schema.Array(
        Schema.Struct({ version: Schema.Number, layers: Schema.Array(Layer), clippedShare: Schema.Number }),
      ),
    }),
  ),
  reviewNote: Schema.NullOr(Schema.String),
});
export type BookFlow = typeof BookFlow.Type;
