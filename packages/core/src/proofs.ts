// PDF proofs (D27): a family asks for a proof of a story with a cast and text edits; the worker renders it with
// headless Chromium from the app's print page and stores the PDF under the family. A proof records what it shows,
// so later look or text changes never alter it, and a print order can later reference it by ID.
//
// Proofs belong to a family's book (books.ts), which passes its cast and text edits as `ProofContent`. A parent
// approves a book's proof for print; unapproved proofs expire (D31).
import { randomUUID } from "node:crypto";

import { schema } from "@lifestory/db";
import { and, desc, eq, isNull, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Schema } from "effect";

import { Auth } from "./auth.ts";
import { type Page, resolvePageText, type StoryManifest } from "./book-format/index.ts";
import { ProofContent, type ProofSummary } from "./contracts.ts";
import { Database } from "./database.ts";
import { InvalidInput, NotFound } from "./errors.ts";
import { requireFamilyAccess, roleCan } from "./families.ts";
import { Jobs } from "./jobs.ts";
import { composeIllustration } from "./looks/compose.ts";
import { resolveIllustration } from "./pages.ts";
import { ObjectStorage } from "./storage.ts";
import { withStoredAdditions } from "./stories.ts";
import { proofObjectKey, renderProof } from "./tasks/render-proof.ts";
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

/**
 * Records a proof of `storyVersionId` showing `content` for `familyId` and starts rendering it. The caller has
 * checked that the user may edit the family's books and that the story can draw the cast.
 */
export const createProof = Effect.fn("proofs.create")(function* (input: {
  readonly familyId: string;
  /** The book it shows. Older proofs of a story preview have none. */
  readonly bookId: string;
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
      bookId: input.bookId,
      storyVersionId: input.storyVersionId,
      additionRevision: input.additionRevision,
      content,
      requestedBy: input.requestedBy,
    }),
  );
  const { taskId } = yield* Jobs.use((jobs) =>
    jobs.spawn(renderProof, { proofId: id }, { idempotencyKey: `proof:${id}` }),
  );
  yield* Database.query((db) => db.update(schema.proof).set({ taskId }).where(eq(schema.proof.id, id)));
  return { id };
});

/** The proofs matching `where`, newest first, as the family sees them. */
export const proofSummaries = Effect.fn("proofs.summaries")(function* (
  where: SQL | undefined,
  manifest: StoryManifest,
) {
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
  if (row.status !== "ready")
    return yield* new InvalidInput({
      message: "The proof is still rendering. Approve it once you've checked the PDF.",
    });
  yield* Database.query((db) =>
    db
      .update(schema.proof)
      .set({ approvedAt: new Date(), approvedBy: userId })
      .where(and(eq(schema.proof.id, proofId), isNull(schema.proof.approvedAt))),
  );
});

/**
 * A parent deletes a proof, rendering, failed, ready, or approved (D32): its row with its approval, its render task if
 * it hasn't finished, and its PDF. Needs a role that edits books. No print order references a proof yet; once one
 * does, an ordered proof must be refused here. If the render was mid-step, the PDF it writes has no row, and
 * `storage.sweep` deletes it.
 */
export const deleteProof = Effect.fn("proofs.delete")(function* (userId: string, proofId: string) {
  const [row] = yield* Database.query((db) =>
    db.select({ familyId: schema.proof.familyId }).from(schema.proof).where(eq(schema.proof.id, proofId)),
  );
  if (!row) return yield* new NotFound({ entity: "proof", id: proofId });
  yield* requireFamilyAccess(userId, row.familyId, "edit");
  const [deleted] = yield* Database.query((db) =>
    db.delete(schema.proof).where(eq(schema.proof.id, proofId)).returning({ taskId: schema.proof.taskId }),
  );
  if (!deleted) return; // Deleted by someone else meanwhile.
  // The row is gone, so the proof is deleted for the family; what follows only frees resources sooner.
  yield* releaseDeletedProof({ id: proofId, familyId: row.familyId, taskId: deleted.taskId });
});

/** A page's text with the proof's edits applied, tokens resolved: what BookPage prints. */
export const proofPageText = (page: Page, content: ProofContent) =>
  resolvePageText(
    {
      text: page.text.map((block, blockIndex) => ({
        style: block.style,
        content:
          content.textEdits.find((edit) => edit.pageId === page.pageId && edit.blockIndex === blockIndex)?.content ??
          block.content,
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

/**
 * Whether `userId` may download the object at `key` under `families/`: a proof's PDF, while its proof exists, for any
 * member of that family. A PDF whose proof was deleted is gone for the family even before the sweep removes it (D32).
 */
export const canReadFamilyFile = Effect.fn("proofs.canReadFamilyFile")(function* (userId: string, key: string) {
  const match = PROOF_KEY.exec(key);
  if (!match || key.includes("..")) return false;
  const [familyId, proofId] = [match[1]!, match[2]!];
  const [proof] = yield* Database.query((db) =>
    db
      .select({ id: schema.proof.id })
      .from(schema.proof)
      .where(and(eq(schema.proof.id, proofId), eq(schema.proof.familyId, familyId))),
  );
  if (!proof) return false;
  const role = yield* memberRole(userId, familyId);
  return role !== null && roleCan(role, { book: ["read"] });
});

/** Frees what a deleted proof held: cancels its render and deletes its PDF. Best-effort; the sweep catches the rest. */
export const releaseDeletedProof = (proof: {
  readonly id: string;
  readonly familyId: string;
  readonly taskId: string | null;
}) =>
  Effect.gen(function* () {
    if (proof.taskId) yield* Jobs.use((jobs) => jobs.cancel(proof.taskId!)).pipe(Effect.ignore);
    yield* ObjectStorage.use((storage) => storage.delete(proofObjectKey(proof.familyId, proof.id))).pipe(Effect.ignore);
  });
