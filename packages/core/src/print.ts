// Headless Chromium (Playwright) turning the app's print page into a PDF (D12). Only the worker calls this, and
// only its image ships a browser; playwright-core loads on first use, so the web app never starts it.
import { Effect, Exit } from "effect";

import type { StorageError } from "./errors.ts";
import type { StoredObject } from "./storage.ts";

/**
 * Resolution of the flattened art: Lulu's 300 ppi (D35). CSS has 96 px per inch, so screenshots at this device scale
 * have exactly 300 pixels per printed inch.
 */
export const ART_PPI = 300;

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
        const page = await browser.newPage({ deviceScaleFactor: ART_PPI / 96 });
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
            brokenImages: [...document.images]
              .filter((img) => !img.complete || img.naturalWidth === 0)
              .map((img) => img.src),
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
        await flattenArt(page);
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        return { pdf: new Uint8Array(pdf), bookPages: loaded.bookPages };
      }),
    (browser) => Effect.promise(() => browser.close()),
  );

/**
 * Flattens every page's transparency for print (D35): with the words hidden, each page is captured at ART_PPI as one
 * opaque JPEG (the paper colour, every illustration layer, and the text panel, composited by Chromium exactly as on
 * screen), which then replaces those layers under the words. The PDF gets one opaque image per page and live text in
 * the story's embedded fonts, with nothing transparent left to flatten.
 */
const flattenArt = async (page: import("playwright-core").Page) => {
  const hideWords = await page.addStyleTag({ content: "[data-testid=page-text] p { visibility: hidden !important; }" });
  const sheets = await page.locator("[data-testid=book-page]").all();
  const rules: string[] = [];
  for (const sheet of sheets) {
    // Quality 95 keeps JPEG artefacts invisible in print; Lulu's own job options also store images as JPEG.
    const art = await sheet.screenshot({ type: "jpeg", quality: 95, scale: "device", animations: "disabled" });
    // Page IDs are lowercase letters, digits, and dashes (the book format), so they are safe in a selector.
    const pageId = await sheet.getAttribute("data-page-id");
    const src = `data:image/jpeg;base64,${Buffer.from(art).toString("base64")}`;
    rules.push(`[data-page-id="${pageId}"] { background: url(${src}) 0 0 / 100% 100% no-repeat !important; }`);
  }
  // React owns the page's DOM, so the flattened art goes in with style rules, not new elements.
  await hideWords.evaluate((style) => style.parentNode?.removeChild(style));
  await page.addStyleTag({
    content: [
      ...rules,
      "[data-testid=illustration] { visibility: hidden !important; }",
      "[data-testid=text-panel] { background: none !important; }",
    ].join("\n"),
  });
  await page.evaluate(async () => {
    // Wait until every flattened image has decoded, so the PDF never prints a page without its art.
    await Promise.all(
      [...document.querySelectorAll<HTMLElement>("[data-testid=book-page]")].map((sheet) => {
        const url = /url\("?(.*?)"?\)/.exec(getComputedStyle(sheet).backgroundImage)?.[1];
        if (!url) throw new Error("a page has no flattened art");
        const img = new Image();
        img.src = url;
        return img.decode();
      }),
    );
  });
};

/** Page objects in a PDF. Chromium writes page dictionaries uncompressed, so counting `/Type /Page` is exact. */
export const countPdfPages = (pdf: Uint8Array) =>
  Buffer.from(pdf)
    .toString("latin1")
    .match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
