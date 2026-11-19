// Client-safe schemas shared by the web app's server functions and its UI.
// Nothing here may import Node-only modules: the browser bundle imports this file.
import { Schema } from "effect";
import { CastMember, Look, LookOverride, PronounSet, StoryManifest, TextStyleName } from "./book-format/index.ts";

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

/** Roles a family member can invite someone with: "parent" edits books, "viewer" only reads them. */
export const InviteRole = Schema.Literals(["parent", "viewer"]);
export type InviteRole = typeof InviteRole.Type;

export const FamilyOverview = Schema.Struct({
  ...FamilyMembership.fields,
  canInvite: Schema.Boolean,
  canEditBooks: Schema.Boolean,
  members: Schema.Array(Schema.Struct({ userId: Schema.String, name: Schema.String, email: Schema.String, role: Schema.String })),
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

/** A family member as drawn in books (D26): name and pronouns for the text, a look for the pictures. */
export const Character = Schema.Struct({
  id: Schema.String,
  familyId: Schema.String,
  name: Schema.String,
  pronouns: PronounSet,
  look: Look,
});
export type Character = typeof Character.Type;

export const CharacterInput = Schema.Struct({
  name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(60)),
  pronouns: PronounSet,
  look: Look,
});
export type CharacterInput = typeof CharacterInput.Type;

/** A family's book, as listed. */
export const BookSummary = Schema.Struct({ id: Schema.String, title: Schema.String, storyTitle: Schema.String, cast: Schema.String });
export type BookSummary = typeof BookSummary.Type;

/** How one character fills one role of a book (castLook in the book format). */
export const BookRole = Schema.Struct({
  slotId: Schema.String,
  characterId: Schema.String,
  /** The character, with the look the pages draw. */
  member: CastMember,
  override: LookOverride,
  wrongAge: Schema.Boolean,
  unsupported: Schema.Array(Schema.String),
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
  /** Each page's illustration as storage keys (a role that can't be drawn is left out) and its text. */
  pages: Schema.Array(
    Schema.Struct({
      pageId: Schema.String,
      layers: Schema.Array(Schema.Struct({ key: Schema.String, rect: Rect })),
      text: Schema.Array(BookTextBlock),
    }),
  ),
});
export type BookView = typeof BookView.Type;

export const SampleFileResult = Schema.Struct({
  key: Schema.String,
  contentType: Schema.String,
  bytes: Schema.Number,
});
export type SampleFileResult = typeof SampleFileResult.Type;

export const TaskState = Schema.Literals(["pending", "running", "sleeping", "completed", "failed", "cancelled"]);
export type TaskState = typeof TaskState.Type;

/**
 * What a proof shows besides the story version: who fills each slot and the family's text edits, fixed when the
 * proof is requested (D27). A story preview has no edits; a personalized book supplies its own.
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
  /** Who fills each slot, by name, in slot order, so proofs of different looks can be told apart. */
  castNames: Schema.Array(Schema.String),
});
export type ProofSummary = typeof ProofSummary.Type;
