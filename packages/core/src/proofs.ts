// PDF proofs (D27): a family asks for a proof of a story with a cast and text edits; the worker renders it with
// headless Chromium from the app's print page and stores the PDF under the family. A proof records what it shows,
// so later look or text changes never alter it, and a print order can later reference it by ID.
//
// The input is `ProofContent`, not a book: a book (books.ts) passes its cast and text edits, and a story preview its
// example cast with chosen looks. A parent approves a book's proof for print; unapproved proofs expire (D31).
import { randomUUID } from "node:crypto";
import { schema } from "@lifestory/db";
import { and, desc, eq, isNull, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Schema } from "effect";
import { type Page, resolvePageText, type StoryManifest } from "./book-format/index.ts";
import { Auth, type SessionUser } from "./auth.ts";
import { ProofContent, type ProofSummary } from "./contracts.ts";
import { Database } from "./database.ts";
import { Forbidden, InvalidInput, NotFound } from "./errors.ts";
import { requireFamilyAccess, roleCan } from "./families.ts";
import { Jobs } from "./jobs.ts";
import { composeIllustration } from "./looks/compose.ts";
import type { Look } from "./looks/vocabulary.ts";
import { resolveIllustration } from "./pages.ts";
import { checkCastSupported, previewCast, readableStoryVersion, withStoredAdditions } from "./stories.ts";
import { renderProof } from "./tasks/render-proof.ts";
import { PROOF_TTL_MS } from "./tasks/sweep-storage.ts";

const approver = alias(schema.user, "approver");

/** The caller's role in `familyId`, or null when they aren't a member. */
const memberRole = (userId: string, familyId: string) =>
  Database.query((db) =>
    db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(and(eq(schema.member.userId, userId), eq(schema.member.organizationId, familyId))),
  ).pipe(Effect.map(([row]) => row?.role ?? null));

/** The family a new proof belongs to: the session's active family, else the user's first. */
const familyForNewProof = Effect.fn("proofs.familyForNew")(function* (user: SessionUser) {
  const rows = yield* Database.query((db) =>
    db
      .select({ familyId: schema.member.organizationId, role: schema.member.role })
      .from(schema.member)
      .where(eq(schema.member.userId, user.id))
      .orderBy(schema.member.createdAt),
  );
  const row = rows.find((candidate) => candidate.familyId === user.activeFamilyId) ?? rows[0];
  if (!row) return yield* new Forbidden({ message: "You aren't in a family." });
  return row;
});

/**
 * Records a proof of `storyVersionId` showing `content` for `familyId` and starts rendering it. The caller has
 * checked that the user may edit the family's books and that the story can draw the cast.
 */
export const createProof = Effect.fn("proofs.create")(function* (input: {
  readonly familyId: string;
  /** The book it shows, when made from one. */
  readonly bookId?: string;
  readonly storyVersionId: string;
  /** The version's additions the cast was checked against (D41); the proof always draws exactly these. */
  readonly additionRevision: number;
  readonly content: ProofContent;
  readonly requestedBy: string;
}) {
  const id = `proof_${randomUUID()}`;
  const content = yield* Schema.encodeEffect(ProofContent)(input.content).pipe(Effect.orDie);
  yield* Database.query((db) =>
    db.insert(schema.proof).values({
      id,
      familyId: input.familyId,
      bookId: input.bookId ?? null,
      storyVersionId: input.storyVersionId,
      additionRevision: input.additionRevision,
      content,
      requestedBy: input.requestedBy,
    }),
  );
  const { taskId } = yield* Jobs.use((jobs) => jobs.spawn(renderProof, { proofId: id }, { idempotencyKey: `proof:${id}` }));
  yield* Database.query((db) => db.update(schema.proof).set({ taskId }).where(eq(schema.proof.id, id)));
  return { id };
});

/**
 * A proof of a story preview: the story's example characters with `looks`, for the user's family. Needs a role
 * that edits books (a viewer can only read proofs).
 */
export const requestStoryProof = Effect.fn("proofs.requestForStory")(function* (
  user: SessionUser,
  slug: string,
  looks: Readonly<Record<string, Look>> = {},
) {
  const family = yield* familyForNewProof(user);
  if (!roleCan(family.role, { book: ["edit"] })) {
    return yield* new Forbidden({ message: "Your role in this family can read books but not make proofs." });
  }
  const { storyVersionId, manifest, additionRevision } = yield* readableStoryVersion(user.id, slug);
  const cast = previewCast(manifest, looks);
  yield* checkCastSupported(manifest, cast);
  return yield* createProof({ familyId: family.familyId, storyVersionId, additionRevision, content: { cast, textEdits: [] }, requestedBy: user.id });
});

/** The proofs matching `where`, newest first, as the family sees them. */
export const proofSummaries = Effect.fn("proofs.summaries")(function* (where: SQL | undefined, manifest: StoryManifest) {
  const rows = yield* Database.query((db) =>
    db
      .select({
        id: schema.proof.id,
        status: schema.proof.status,
        taskId: schema.proof.taskId,
        objectKey: schema.proof.objectKey,
        pageCount: schema.proof.pageCount,
        bytes: schema.proof.bytes,
        content: schema.proof.content,
        createdAt: schema.proof.createdAt,
        requestedBy: schema.user.name,
        approvedAt: schema.proof.approvedAt,
        approvedBy: approver.name,
      })
      .from(schema.proof)
      .leftJoin(schema.user, eq(schema.user.id, schema.proof.requestedBy))
      .leftJoin(approver, eq(approver.id, schema.proof.approvedBy))
      .where(where)
      .orderBy(desc(schema.proof.createdAt))
      .limit(20),
  );
  const jobs = yield* Jobs;
  const proofs = yield* Effect.forEach(rows, (row) =>
    Effect.gen(function* () {
      let status: ProofSummary["status"] = row.status;
      if (status === "rendering" && row.taskId) {
        const task = yield* jobs.status(row.taskId).pipe(Effect.orElseSucceed(() => null));
        if (task && (task.state === "failed" || task.state === "cancelled")) status = "failed";
      }
      const content = yield* Schema.decodeUnknownEffect(ProofContent)(row.content).pipe(Effect.orDie);
      return {
        id: row.id,
        status,
        objectKey: row.objectKey,
        pageCount: row.pageCount,
        bytes: row.bytes,
        createdAt: row.createdAt.toISOString(),
        requestedBy: row.requestedBy,
        approvedAt: row.approvedAt?.toISOString() ?? null,
        approvedBy: row.approvedAt ? row.approvedBy : null,
        expiresAt: row.approvedAt ? null : new Date(row.createdAt.getTime() + PROOF_TTL_MS).toISOString(),
        castNames: manifest.characterSlots.map((slot) => content.cast[slot.slotId]?.name ?? slot.label),
      } satisfies ProofSummary;
    }),
  );
  return proofs;
});

/** The user's family's proofs of a story's newest readable version, newest first, and whether they may make one. */
export const listStoryProofs = Effect.fn("proofs.listForStory")(function* (user: SessionUser, slug: string) {
  const family = yield* familyForNewProof(user);
  const { storyVersionId, manifest } = yield* readableStoryVersion(user.id, slug);
  // Proofs of the story preview only; a book lists its own.
  const proofs = yield* proofSummaries(
    and(eq(schema.proof.familyId, family.familyId), eq(schema.proof.storyVersionId, storyVersionId), isNull(schema.proof.bookId)),
    manifest,
  );
  return { canRequest: roleCan(family.role, { book: ["edit"] }), proofs };
});

/**
 * A parent approves a book's proof for print (brief, "Recommended design"): the PDF they downloaded and checked is the
 * one a print order will use. Needs a role that edits books; only a ready proof of a book can be approved, and only
 * once, so approving it again keeps the first approval. An approved proof is kept as long as its family (D31).
 */
export const approveProof = Effect.fn("proofs.approve")(function* (userId: string, proofId: string) {
  const [row] = yield* Database.query((db) =>
    db
      .select({ familyId: schema.proof.familyId, bookId: schema.proof.bookId, status: schema.proof.status })
      .from(schema.proof)
      .where(eq(schema.proof.id, proofId)),
  );
  if (!row) return yield* new NotFound({ entity: "proof", id: proofId });
  yield* requireFamilyAccess(userId, row.familyId, "edit");
  if (!row.bookId) return yield* new InvalidInput({ message: "Only a proof of a book can be approved for print." });
  if (row.status !== "ready") return yield* new InvalidInput({ message: "The proof is still rendering. Approve it once you've checked the PDF." });
  yield* Database.query((db) =>
    db
      .update(schema.proof)
      .set({ approvedAt: new Date(), approvedBy: userId })
      .where(and(eq(schema.proof.id, proofId), isNull(schema.proof.approvedAt))),
  );
});

/** A page's text with the proof's edits applied, tokens resolved: what BookPage prints. */
export const proofPageText = (page: Page, content: ProofContent) =>
  resolvePageText(
    {
      text: page.text.map((block, blockIndex) => ({
        style: block.style,
        content: content.textEdits.find((edit) => edit.pageId === page.pageId && edit.blockIndex === blockIndex)?.content ?? block.content,
      })),
    },
    content.cast,
  );

/**
 * Everything the print page draws for a proof, for the worker's Chromium holding a print token (no session).
 * Fails with NotFound for an unknown proof or a bad or expired token, so the page reveals nothing.
 */
export const printableProof = Effect.fn("proofs.printable")(function* (proofId: string, token: string) {
  const auth = yield* Auth;
  if (!auth.printToken.verify(proofId, token)) return yield* new NotFound({ entity: "proof", id: proofId });
  const [row] = yield* Database.query((db) =>
    db
      .select({
        storyVersionId: schema.proof.storyVersionId,
        additionRevision: schema.proof.additionRevision,
        storyId: schema.storyVersion.storyId,
        version: schema.storyVersion.version,
        manifest: schema.storyVersion.manifest,
        content: schema.proof.content,
      })
      .from(schema.proof)
      .innerJoin(schema.storyVersion, eq(schema.storyVersion.id, schema.proof.storyVersionId))
      .where(eq(schema.proof.id, proofId)),
  );
  if (!row) return yield* new NotFound({ entity: "proof", id: proofId });
  // Exactly the additions the proof was requested with (D41): a later one could change how its cast draws (a softer
  // base, D40; a stand-in giving way, D28), and a rerendered or approved proof never changes.
  const { manifest } = yield* withStoredAdditions(row.storyVersionId, row.manifest, row.additionRevision);
  const content = yield* Schema.decodeUnknownEffect(ProofContent)(row.content).pipe(Effect.orDie);
  const pages = yield* Effect.forEach(manifest.pages, (page) =>
    resolveIllustration(row.storyId, row.version, composeIllustration(manifest, page, content.cast)).pipe(
      Effect.map((layers) => ({ pageId: page.pageId, layers, text: proofPageText(page, content) })),
    ),
  );
  return { storyId: row.storyId, version: row.version, manifest, cast: content.cast, pages };
});

// families/<familyId>/proofs/<proofId>.pdf, as written by the render task.
const PROOF_KEY = /^families\/([^/]+)\/proofs\/([^/]+)\.pdf$/;

/** Whether `userId` may download the object at `key` under `families/`: any member of that family may read it. */
export const canReadFamilyFile = Effect.fn("proofs.canReadFamilyFile")(function* (userId: string, key: string) {
  const match = PROOF_KEY.exec(key);
  if (!match || key.includes("..")) return false;
  const role = yield* memberRole(userId, match[1]!);
  return role !== null && roleCan(role, { book: ["read"] });
});
