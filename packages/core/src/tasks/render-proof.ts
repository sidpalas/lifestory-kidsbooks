import { schema } from "@lifestory/db";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { Auth } from "../auth.ts";
import { decodeStoryManifest } from "../book-format/index.ts";
import { AppConfig } from "../config.ts";
import { Database } from "../database.ts";
import { defineTask, step } from "../jobs.ts";
import { checkPrintReady, setPrintBoxes } from "../print-ready.ts";
import { countPdfPages, printPdf } from "../print.ts";
import { ObjectStorage } from "../storage.ts";

/** Where a proof's PDF lives: under its family, like everything a family owns. */
export const proofObjectKey = (familyId: string, proofId: string) => `families/${familyId}/proofs/${proofId}.pdf`;

/**
 * Renders a proof to PDF on the worker (D12, D27): headless Chromium prints the app's print page for the proof,
 * which draws every page with BookPage from what the proof row recorded, flattened and with its page boxes set, so the
 * proof the parent approves is the print-ready file an order sends to the printer (D35). Both steps are idempotent: the render
 * writes to a key derived from the proof ID, so a rerun after a crash overwrites the same object with a PDF of the
 * same content, and recording it is an update by ID.
 */
export const renderProof = defineTask({
  name: "proof.render",
  params: Schema.Struct({ proofId: Schema.String }),
  run: ({ proofId }, ctx) =>
    Effect.gen(function* () {
      const rendered = yield* step(
        ctx,
        "render",
        Effect.gen(function* () {
          const [row] = yield* Database.query((db) =>
            db
              .select({ familyId: schema.proof.familyId, manifest: schema.storyVersion.manifest })
              .from(schema.proof)
              .innerJoin(schema.storyVersion, eq(schema.storyVersion.id, schema.proof.storyVersionId))
              .where(eq(schema.proof.id, proofId)),
          );
          if (!row) return yield* Effect.die(new Error(`proof ${proofId} doesn't exist`));
          const { trim } = yield* decodeStoryManifest(row.manifest).pipe(Effect.orDie);
          const { printAppUrl } = yield* AppConfig;
          const auth = yield* Auth;
          const storage = yield* ObjectStorage;
          const url = new URL(`/print/proofs/${proofId}`, printAppUrl);
          url.searchParams.set("token", auth.printToken.sign(proofId));
          const printed = yield* printPdf(url.href, storage.get);
          const pdf = yield* Effect.promise(() => setPrintBoxes(printed.pdf, trim));
          const { bookPages } = printed;
          const pageCount = countPdfPages(pdf);
          // More PDF pages than book pages means something overflowed its page: never hand that to a printer.
          if (pageCount !== bookPages) {
            return yield* Effect.die(
              new Error(`proof ${proofId}: ${bookPages} book pages printed as ${pageCount} PDF pages`),
            );
          }
          // A PDF a printer would reject is a bug in rendering, not something a parent can fix: fail rather than store it.
          const { issues } = yield* Effect.promise(() => checkPrintReady(pdf, trim));
          if (issues.length > 0) {
            return yield* Effect.die(new Error(`proof ${proofId} isn't print-ready:\n${issues.join("\n")}`));
          }
          const objectKey = proofObjectKey(row.familyId, proofId);
          yield* storage.put(objectKey, pdf, "application/pdf");
          return { objectKey, pageCount, bytes: pdf.byteLength };
        }),
      );
      yield* step(
        ctx,
        "record",
        Database.query((db) =>
          db
            .update(schema.proof)
            .set({
              status: "ready",
              objectKey: rendered.objectKey,
              pageCount: rendered.pageCount,
              bytes: rendered.bytes,
            })
            .where(eq(schema.proof.id, proofId)),
        ).pipe(Effect.as(null)),
      );
      return rendered;
    }),
});
