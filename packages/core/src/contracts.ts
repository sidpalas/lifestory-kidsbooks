// Client-safe schemas shared by the web app's server functions and its UI.
// Nothing here may import Node-only modules: the browser bundle imports this file.
import { Schema } from "effect";
import { CastMember, Look, LookOverride, PronounSet, StoryDraft, StoryManifest, TextStyleName } from "./book-format/index.ts";
import { StoryPart } from "./parts/contract.ts";

export * from "./book-format/index.ts";
export * from "./errors.ts";
export * from "./rpc.ts";
export * from "./parts/contract.ts";
export * from "./imports/contract.ts";

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

/** A family member as drawn in books (D26): name, title, and pronouns for the text, a look for the pictures. */
export const Character = Schema.Struct({
  id: Schema.String,
  familyId: Schema.String,
  name: Schema.String,
  /** What the children call them, such as "Dad" or "Nana"; null when they go by their name. */
  title: Schema.NullOr(Schema.String),
  pronouns: PronounSet,
  look: Look,
});
export type Character = typeof Character.Type;

export const CharacterInput = Schema.Struct({
  name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(60)),
  title: Schema.NullOr(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(30))),
  pronouns: PronounSet,
  look: Look,
});
export type CharacterInput = typeof CharacterInput.Type;

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

/** How one character fills one role of a book (castLook in the book format). */
export const BookRole = Schema.Struct({
  slotId: Schema.String,
  characterId: Schema.String,
  /** The character, with the look the pages draw. */
  member: CastMember,
  override: LookOverride,
  /** How this book draws the character differently from their saved look (D46); already in `member.look`. */
  changes: LookOverride,
  wrongAge: Schema.Boolean,
  unsupported: Schema.Array(Schema.String),
});
export type BookRole = typeof BookRole.Type;

/**
 * Who fills one role of a story preview: a family member (`characterId`), or the role's example character with a
 * look being tried (`characterId` null). Like a book's role, one the story can't draw is left out of the pictures.
 */
export const PreviewRole = Schema.Struct({
  slotId: Schema.String,
  characterId: Schema.NullOr(Schema.String),
  /** The member's look, as `member.look` draws it, with these axes changed for this book (D46). */
  member: CastMember,
  changes: LookOverride,
  wrongAge: Schema.Boolean,
  unsupported: Schema.Array(Schema.String),
});
export type PreviewRole = typeof PreviewRole.Type;

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
  /** Who fills each slot, by name, in slot order, so proofs of different looks can be told apart. */
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
  /** How many additions the newest published version has (D41). */
  additions: Schema.Number,
  /** Look options the newest published version can't draw yet, with its additions: what the author still has to add. */
  missingOptions: Schema.Array(Schema.String),
});
export type AuthoredStory = typeof AuthoredStory.Type;

/** A story draft in the authoring editor (D37): its manifest as saved, its generated parts, and every page composed for the slots' examples. */
export const DraftView = Schema.Struct({
  story: Schema.Struct({ id: Schema.String, slug: Schema.String, title: Schema.String, summary: Schema.String, status: Schema.String }),
  storyVersionId: Schema.String,
  version: Schema.Number,
  revision: Schema.Number,
  /** As saved, without generated parts; the pictures in `pages` include them. */
  draft: StoryDraft,
  parts: Schema.Array(StoryPart),
  pages: Schema.Array(Schema.Struct({ pageId: Schema.String, layers: Schema.Array(Schema.Struct({ key: Schema.String, rect: Rect })) })),
});
export type DraftView = typeof DraftView.Type;
