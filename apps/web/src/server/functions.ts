import {
  activeFamily,
  Auth,
  canAuthor,
  getStoryPreview,
  listBooks,
  listCharacters,
  printableProof,
} from "@lifestory/core";
import {
  NotAuthenticated,
  CastMember,
  Forbidden,
  NotFound,
  ResultSchema,
  StoryManifest,
  StorySummary,
  FamilyMembership,
  BookSummary,
  Character,
  TextStyleName,
} from "@lifestory/core/contracts";
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
    /** The stock characters' names and pronouns, for the text. */
    cast: Schema.Record(Schema.String, CastMember),
    /** Each page's composed illustration, as storage keys placed in the illustration area. */
    pages: Schema.Array(
      Schema.Struct({ pageId: Schema.String, layers: Schema.Array(Schema.Struct({ key: Schema.String, rect: Rect })) }),
    ),
    /** The active family's members, who can fill the roles, and whether the user may make books in it. */
    characters: Schema.Array(Character),
    canEdit: Schema.Boolean,
    /** The family's books of this story, newest first. */
    books: Schema.Array(BookSummary),
  }),
  // Forbidden: the family checks it shares with book pages; reading the active family's books never fails with it.
  Schema.Union([NotAuthenticated, NotFound, Forbidden]),
);

/** A story's pages with its stock characters (D56), and the active family's members and books of it. */
export const getStoryPreviewFn = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ slug: Schema.String })))
  .handler(async ({ data }) =>
    runEffect(
      StoryPreviewResult,
      Effect.gen(function* () {
        const user = yield* currentUser;
        const { active } = yield* activeFamily(user);
        const { characters, canEdit } = active
          ? yield* listCharacters(user.id, active.id)
          : { characters: [], canEdit: false };
        const { books } = active ? yield* listBooks(user.id, active.id) : { books: [] };
        const preview = yield* getStoryPreview(user.id, data.slug);
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
