// Client-safe schemas shared by the web app's server functions and its UI.
// Nothing here may import Node-only modules: the browser bundle imports this file.
import { Schema } from "effect";

import { Age, CastMember, PronounSet, StoryDraft, StoryManifest, TextStyleName } from "./book-format/index.ts";

export * from "./book-format/index.ts";
export * from "./errors.ts";
export * from "./rpc.ts";

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
 * Who plays a role in one book (D56; no separate family members since Sid, 2026-11-24): a name, what the children
 * call them, pronouns for the text, and an age the role accepts, which the character sheet draws them at.
 */
export const CastPerson = Schema.Struct({
  name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(60)),
  title: Schema.NullOr(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(30))),
  pronouns: PronounSet,
  age: Age,
});
export type CastPerson = typeof CastPerson.Type;

/** A family's book, as listed. */
export const BookSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  storySlug: Schema.String,
  storyTitle: Schema.String,
  /** The story version the book pins. */
  version: Schema.Number,
  cast: Schema.String,
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

const Rect = Schema.Tuple([Schema.Number, Schema.Number, Schema.Number, Schema.Number]);

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
});
export type ProofSummary = typeof ProofSummary.Type;

/** A story as its author lists it (D37): the version being drafted, if any, and the newest published one. */
export const AuthoredStory = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  title: Schema.String,
  summary: Schema.String,
  status: Schema.String,
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

/**
 * Hair chips (D56): what the parent says about each person's hair, which the sheet prompt puts in words. Colours sit
 * on a grid of lightness and redness, so the photo check can tell how many steps the photo's hair is from the chips.
 */
export const hairColours = [
  { id: "black", label: "Black", at: [0, 0] },
  { id: "dark-brown", label: "Dark brown", at: [1, 0] },
  { id: "brown", label: "Brown", at: [2, 0] },
  { id: "light-brown", label: "Light brown", at: [3, 0] },
  { id: "dark-blond", label: "Dark blond", at: [4, 0] },
  { id: "blond", label: "Blond", at: [5, 0] },
  { id: "platinum", label: "Platinum blond", at: [6, 0] },
  { id: "auburn", label: "Auburn", at: [2, 1] },
  { id: "red", label: "Red", at: [3, 2] },
  { id: "strawberry-blond", label: "Strawberry blond", at: [4, 1] },
  { id: "grey", label: "Grey", at: [5, -1] },
  { id: "white", label: "White", at: [6, -1] },
] as const;
export const HairColour = Schema.Literals(hairColours.map((colour) => colour.id));
export type HairColour = typeof HairColour.Type;

export const hairLengths = [
  { id: "none", label: "No hair" },
  { id: "very-short", label: "Very short" },
  { id: "short", label: "Short" },
  { id: "medium", label: "Chin to shoulder" },
  { id: "long", label: "Long" },
] as const;
export const HairLength = Schema.Literals(hairLengths.map((length) => length.id));

export const hairTextures = [
  { id: "straight", label: "Straight" },
  { id: "wavy", label: "Wavy" },
  { id: "curly", label: "Curly" },
  { id: "coily", label: "Coily" },
] as const;
export const HairTexture = Schema.Literals(hairTextures.map((texture) => texture.id));

export const Hair = Schema.Struct({ colour: HairColour, length: HairLength, texture: HairTexture });
export type Hair = typeof Hair.Type;

/** Steps between two hair colours: lighting moves a photo's hair about one (D56, spike). */
export const hairSteps = (a: HairColour, b: HairColour) => {
  const [ax, ay] = hairColours.find((colour) => colour.id === a)!.at;
  const [bx, by] = hairColours.find((colour) => colour.id === b)!.at;
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
};

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
  facialHair: Schema.Literals(["none", "stubble", "moustache", "beard"]),
  tip: Schema.String,
});
export type PhotoReport = typeof PhotoReport.Type;

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
