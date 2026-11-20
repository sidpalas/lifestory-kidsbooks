import {
  NotAuthenticated,
  CastMember,
  Look,
  LookOverride,
  NotFound,
  ResultSchema,
  StoryManifest,
  StorySummary,
  FamilyMembership,
  BookSummary,
  Character,
  PreviewRole,
  TextStyleName,
} from "@lifestory/core/contracts";
import {
  activeFamily,
  Auth,
  canAuthor,
  getStoryPreview,
  listBooks,
  listCharacters,
  printableProof,
} from "@lifestory/core";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Effect, Schema } from "effect";
import { runEffect } from "./runtime.ts";

// Result schemas are shared with the client, which decodes with unwrapResult.
/** What the app shell around every family page shows: who's signed in, their families, and whether they author. */
export const HomeResult = ResultSchema(
  Schema.Struct({
    user: Schema.Struct({ name: Schema.String, email: Schema.String }),
    families: Schema.Array(FamilyMembership),
    active: Schema.NullOr(FamilyMembership),
    canAuthor: Schema.Boolean,
    isOperator: Schema.Boolean,
  }),
  NotAuthenticated,
);

const currentUser = Auth.use((auth) => auth.requireUser(getRequest().headers));

/** What the signed-out landing page needs from the server: its absolute URL, for its link preview tags. */
export const LandingResult = ResultSchema(Schema.Struct({ url: Schema.String }), Schema.Never);

export const getLanding = createServerFn({ method: "GET" }).handler(() =>
  runEffect(
    LandingResult,
    Auth.use((auth) => Effect.succeed({ url: auth.appUrl("/") })),
  ),
);

export const getHome = createServerFn({ method: "GET" }).handler(() =>
  runEffect(
    HomeResult,
    Effect.gen(function* () {
      const user = yield* currentUser;
      const { families, active } = yield* activeFamily(user);
      return {
        user: { name: user.name, email: user.email },
        families,
        active: active && { id: active.id, name: active.name, role: active.role },
        canAuthor: yield* canAuthor(user),
        isOperator: user.role === "admin",
      };
    }),
  ),
);

const Rect = Schema.Tuple([Schema.Number, Schema.Number, Schema.Number, Schema.Number]);

export const StoryPreviewResult = ResultSchema(
  Schema.Struct({
    story: StorySummary,
    /** Archived by its author (D49): only the author sees it, and no book can be made of it. */
    archived: Schema.Boolean,
    version: Schema.Number,
    manifest: StoryManifest,
    /** Who fills each role in this preview, and whether the story can draw them. */
    roles: Schema.Array(PreviewRole),
    cast: Schema.Record(Schema.String, CastMember),
    /** Each page's composed illustration, as storage keys placed in the illustration area. */
    pages: Schema.Array(Schema.Struct({ pageId: Schema.String, layers: Schema.Array(Schema.Struct({ key: Schema.String, rect: Rect })) })),
    /** The active family's members, who can fill the roles, and whether the user may make books in it. */
    characters: Schema.Array(Character),
    canEdit: Schema.Boolean,
    /** The family's books of this story, newest first. */
    books: Schema.Array(BookSummary),
  }),
  Schema.Union([NotAuthenticated, NotFound]),
);

export const PreviewChoice = Schema.Struct({
  /** A family member per role, by character ID. */
  cast: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /** A look tried on a role's example character; wins over `cast`. */
  looks: Schema.optional(Schema.Record(Schema.String, Look)),
  /** How the book would draw a role's family member differently from their saved look (D46); not saved. */
  changes: Schema.optional(Schema.Record(Schema.String, LookOverride)),
});

/** A story's pages with the family's members in its roles, or the examples with looks being tried. */
export const getStoryPreviewFn = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ slug: Schema.String, ...PreviewChoice.fields })))
  .handler(async ({ data }) =>
    runEffect(
      StoryPreviewResult,
      Effect.gen(function* () {
        const user = yield* currentUser;
        const { active } = yield* activeFamily(user);
        const { characters, canEdit } = active ? yield* listCharacters(user.id, active.id) : { characters: [], canEdit: false };
        const { books } = active ? yield* listBooks(user.id, active.id) : { books: [] };
        const preview = yield* getStoryPreview(user.id, data.slug, characters, { cast: data.cast, looks: data.looks, changes: data.changes });
        return { ...preview, characters, canEdit, books: books.filter((book) => book.storySlug === data.slug) };
      }),
    ),
  );

export const PrintableProofResult = ResultSchema(
  Schema.Struct({
    storyId: Schema.String,
    version: Schema.Number,
    manifest: StoryManifest,
    cast: Schema.Record(Schema.String, CastMember),
    pages: Schema.Array(
      Schema.Struct({
        pageId: Schema.String,
        layers: Schema.Array(Schema.Struct({ key: Schema.String, rect: Rect })),
        text: Schema.Array(Schema.Struct({ style: TextStyleName, text: Schema.String })),
      }),
    ),
  }),
  NotFound,
);

/** The print page's data. No session: the worker's headless Chromium holds a print token for this one proof. */
export const getPrintableProofFn = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ proofId: Schema.String, token: Schema.String })))
  .handler(async ({ data }) => runEffect(PrintableProofResult, printableProof(data.proofId, data.token)));
