// Headless Chromium (Playwright) turning the app's print page into a PDF (D12). Only the worker calls this, and
// only its image ships a browser; playwright-core loads on first use, so the web app never starts it.
import { Effect, Exit } from "effect";
import type { StorageError } from "./errors.ts";
import type { StoredObject } from "./storage.ts";

export interface PrintedPdf {
  readonly pdf: Uint8Array;
  /** BookPage elements the print page rendered; the PDF must have exactly this many pages. */
  readonly bookPages: number;
}

/**
 * Opens `url` and prints it with the page's own CSS page size and backgrounds. The page loads story assets and
 * recoloured layers from `/api/files/<key>` exactly as the editor does; here they are answered with `readFile`
 * straight from object storage, so Chromium needs no session and gets the same bytes. Fails if an image or a
 * story font didn't load, because print must never silently fall back.
 */
export const printPdf = (url: string, readFile: (key: string) => Effect.Effect<StoredObject, StorageError>) =>
  Effect.acquireUseRelease(
    Effect.promise(async () => {
      const { chromium } = await import("playwright-core");
      return chromium.launch();
    }),
    (browser) =>
      Effect.promise(async (): Promise<PrintedPdf> => {
        const page = await browser.newPage();
        const files = new URL("/api/files/", url);
        await page.route(`${files.href}**`, async (route) => {
          const key = decodeURIComponent(new URL(route.request().url()).pathname.slice(files.pathname.length));
          const exit = await Effect.runPromiseExit(readFile(key));
          await (Exit.isSuccess(exit)
            ? route.fulfill({ status: 200, contentType: exit.value.contentType, body: Buffer.from(exit.value.body) })
            : route.fulfill({ status: 404, body: "Not found" }));
        });
        const response = await page.goto(url, { waitUntil: "load" });
        if (!response?.ok()) throw new Error(`print page answered ${response?.status() ?? "nothing"}`);
        const loaded = await page.evaluate(async () => {
          await document.fonts.ready;
          // Runs in the page, so it can't use helpers from this module.
          // oxlint-disable-next-line unicorn/consistent-function-scoping
          const unquote = (family: string) => family.trim().replace(/^["']|["']$/g, "");
          const paragraphs = [...document.querySelectorAll("[data-testid=book-page] p")];
          const families = new Set(paragraphs.map((p) => unquote(getComputedStyle(p).fontFamily.split(",")[0] ?? "")));
          const faces = [...document.fonts];
          return {
            bookPages: document.querySelectorAll("[data-testid=book-page]").length,
            brokenImages: [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.src),
            failedFonts: faces.filter((face) => face.status === "error").map((face) => face.family),
            missingFonts: [...families].filter(
              (family) => !faces.some((face) => unquote(face.family) === family && face.status === "loaded"),
            ),
          };
        });
        const problems = [
          ...loaded.brokenImages.map((src) => `image didn't load: ${src}`),
          ...loaded.failedFonts.map((family) => `font failed: ${family}`),
          ...loaded.missingFonts.map((family) => `font not loaded: ${family}`),
          ...(loaded.bookPages === 0 ? ["no book pages on the print page"] : []),
        ];
        if (problems.length > 0) throw new Error(`print page isn't ready:\n${problems.join("\n")}`);
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        return { pdf: new Uint8Array(pdf), bookPages: loaded.bookPages };
      }),
    (browser) => Effect.promise(() => browser.close()),
  );

/** Page objects in a PDF. Chromium writes page dictionaries uncompressed, so counting `/Type /Page` is exact. */
export const countPdfPages = (pdf: Uint8Array) =>
  Buffer.from(pdf).toString("latin1").match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
