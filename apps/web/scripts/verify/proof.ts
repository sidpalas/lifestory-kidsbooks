// verify proof: docs/features/pdf-proof.md. Opens or makes a family's book, presses "Make a PDF proof", waits for the
// worker to render it, downloads it, and checks it three ways:
//   print-ready   checkPrintReady against Lulu's requirements (D35)
//   pixels        each editor page (full Chromium) against the same PDF page (pdftoppm), both at 96 dpi
//   words         each word's left edge, top and line in the editor against pdftotext's word boxes
// then deletes the proof from the book page and checks its PDF is gone. It leaves a book, if it made one, in the
// signed-in account's family (on live, the agent family's, D38); a failed run can leave its proof (it expires, D32).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import sharp from "sharp";

import { imagesSettled, signedIn } from "./browser.ts";
import type { Report } from "./report.ts";
import type { Stack } from "./stack.ts";

/** A pixel differs when any channel is off by more than 5%. */
const PIXEL_TOLERANCE = 13;
/** Anti-aliased and resampled edges differ by up to ~5% on painted art (Crosby's watercolour pages); a missing or wrongly drawn figure differs far more. Text drift is the word check's job. */
const MAX_DIFF_SHARE = 0.1;
/** A word's left edge may move this much between screen and print (pt); c9a06f1 measured 0.01. */
const MAX_WORD_SHIFT_PT = 0.5;
/**
 * A word's top may move this much relative to the book's other words of its size (pt). Screen and pdftotext measure a
 * word's top from different font metrics, an offset that grows with the font size, so the median offset of each size
 * across the book is taken out first. What's left is the screen placing lines on half CSS pixels at 192 dpi (0.375
 * pt): layouts that print identically to before frames (D54) measured 0.22–0.43 pt. A frame printed 2 pt off measured
 * 2.22 pt and fails.
 */
const MAX_WORD_DROP_PT = 1;
/** Captures are made at this resolution; pixels are compared at half of it. */
const DPI = 192;

interface Word {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  /** On screen only: the word's font size (CSS px), which sets how far apart the two tops are. */
  readonly size?: number;
}

/** Words of every page as the editor lays them out, in pt from the page's top-left, unscaled. */
const domWords = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('section[aria-label="All pages"] [data-testid=book-page]')].map((sheet) => {
      const box = sheet.getBoundingClientRect();
      const scale = box.width / (sheet as HTMLElement).offsetWidth;
      const words: Array<{ text: string; x: number; y: number; size: number }> = [];
      for (const area of sheet.querySelectorAll("[data-testid=text-frame]")) {
        const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          for (const match of node.textContent!.matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            const rect = range.getBoundingClientRect();
            words.push({
              text: match[0],
              x: ((rect.left - box.left) / scale) * 0.75,
              y: ((rect.top - box.top) / scale) * 0.75,
              size: parseFloat(getComputedStyle(node.parentElement!).fontSize),
            });
          }
        }
      }
      return words;
    }),
  );

const entities: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};
/** Words of one PDF page from pdftotext -bbox, in pt from the page's top-left. */
const pdfWords = (pdfPath: string, pageNumber: number): Word[] =>
  [
    ...execFileSync("pdftotext", ["-bbox", "-f", String(pageNumber), "-l", String(pageNumber), pdfPath, "-"], {
      encoding: "utf8",
    }).matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]*)<\/word>/g),
  ].map((m) => ({ text: m[3]!.replace(/&[#\w]+;/g, (e) => entities[e] ?? e), x: Number(m[1]), y: Number(m[2]) }));

/**
 * Words top to bottom, then left to right within a row (tops within 3 pt): the same order on screen and in print
 * however a page's text boxes sit side by side, which pdftotext's own reading order doesn't promise.
 */
const readingOrder = (words: ReadonlyArray<Word>): Word[] => {
  const rows: Word[][] = [];
  for (const word of words.toSorted((a, b) => a.y - b.y)) {
    const row = rows.at(-1);
    if (row && word.y - row[0]!.y <= 3) row.push(word);
    else rows.push([word]);
  }
  return rows.flatMap((row) => row.toSorted((a, b) => a.x - b.x));
};

/** Line index of each word: a new line starts where a word's top moves down by more than a few points. */
const lineOf = (words: ReadonlyArray<Word>) => {
  let line = 0;
  return words.map((word, i) => (i > 0 && word.y - words[i - 1]!.y > 3 ? ++line : line));
};

export const proof = async (stack: Stack, report: Report, options: { story: string }) => {
  try {
    execFileSync("pdftoppm", ["-v"], { stdio: "ignore" });
  } catch {
    report.check(
      "tools",
      false,
      "pdftoppm and pdftotext are missing: sudo apt-get install -y poppler-utils (.agents/setup installs them)",
      { fatal: true },
    );
  }
  const session = await signedIn(stack, { deviceScaleFactor: DPI / 96 });
  const { page } = session;
  await page.setViewportSize({ width: 1800, height: 1000 });
  try {
    await page.goto(`/stories/${options.story}`);
    await page.getByTestId("book-page").first().waitFor({ timeout: 30_000 });
    const trim = await page.getByTestId("story-meta").evaluate((meta) => {
      const [, w, h] = meta.textContent!.match(/([\d.]+) × ([\d.]+) in/) ?? [];
      return { widthIn: Number(w), heightIn: Number(h) };
    });
    const existing = page.getByTestId("story-books").getByRole("link").first();
    if (await existing.count()) await existing.click();
    else await page.getByRole("button", { name: "Make the book", exact: true }).click();
    await page.waitForURL(/\/books\/book_/);
    const sheets = page.getByRole("region", { name: "All pages" }).getByTestId("book-page");
    await sheets.first().waitFor();
    const pageCount = await sheets.count();
    const bookPath = new URL(page.url()).pathname;
    report.check(
      "route",
      true,
      `${new URL(page.url()).pathname} of ${options.story} as ${stack.who}: ${pageCount} pages`,
    );

    // Request a proof the way a parent does, then wait for the worker.
    const proofs = page.getByTestId("proof");
    const before = await proofs.count();
    const started = Date.now();
    await page.getByRole("button", { name: "Make a PDF proof" }).click();
    await page.waitForFunction((n) => document.querySelectorAll("[data-testid=proof]").length > n, before, {
      timeout: 15_000,
    });
    const newest = proofs.first();
    await page
      .waitForFunction(
        () =>
          ["ready", "failed"].includes(
            document.querySelector("[data-testid=proof]")?.getAttribute("data-status") ?? "",
          ),
        undefined,
        { timeout: 90_000 },
      )
      .catch(() => undefined);
    const status = await newest.getAttribute("data-status");
    report.check(
      "render",
      status === "ready",
      `the worker rendered it in ${((Date.now() - started) / 1000).toFixed(1)} s (status ${status})`,
      { fatal: true },
    );
    const href = (await newest.getByRole("link", { name: /Download PDF/ }).getAttribute("href"))!;
    const download = await page.request.get(href);
    const pdf = await download.body();
    const pdfPath = report.file("proof.pdf");
    writeFileSync(pdfPath, pdf);
    report.check(
      "download",
      download.ok() && download.headers()["content-type"] === "application/pdf",
      `${href} → ${download.status()}, ${(pdf.length / 1e6).toFixed(2)} MB`,
    );

    // Imported on use: @lifestory/core is big, and the other commands don't need it.
    const { checkPrintReady } = await import("@lifestory/core");
    const ready = await checkPrintReady(pdf, trim);
    writeFileSync(report.file("print-ready.json"), `${JSON.stringify(ready, null, 2)}\n`);
    report.check(
      "print-ready",
      ready.issues.length === 0 && ready.pages === pageCount,
      ready.issues.length
        ? ready.issues.join("; ")
        : `${ready.pages} pages, fonts ${ready.fonts.join(", ")}, art at ${[...new Set(ready.images.map((i) => i.ppi))].join("/")} ppi`,
    );

    // The editor's pages at full size: undo thumbnail scaling so each page is 8.75 in = 840 CSS px.
    await page.evaluate(() => {
      for (const sheet of document.querySelectorAll<HTMLElement>("[data-testid=book-page]")) {
        // ScaledPage: a box sized by an svg, and the page scaled inside it, positioned over the svg.
        const inner = sheet.parentElement!;
        inner.style.transform = "none";
        inner.style.position = "static";
        inner.parentElement!.querySelector("svg")!.style.display = "none";
        // At full size a page overflows its two-column cell and the next page covers it: one column instead.
        const list = sheet.closest("ol");
        if (list) list.style.display = "block";
      }
    });
    const broken = await imagesSettled(page);
    report.check(
      "editor images",
      broken.length === 0,
      broken.length ? `${broken.length} failed: ${broken[0]}` : "every layer loaded",
    );
    const screenWords = await domWords(page);
    execFileSync("pdftoppm", ["-r", String(DPI), "-png", pdfPath, report.file("pdf")]);

    const pixelRows: string[] = [];
    let worstShare = 0;
    let worstShift = 0;
    let worstDrop = 0;
    const drops = new Map<number | undefined, Array<{ drop: number; where: string }>>();
    const lineMismatches: string[] = [];
    const digits = String(pageCount).length;
    for (let i = 0; i < pageCount; i++) {
      const screenPath = report.file(`screen-${i + 1}.png`);
      await sheets.nth(i).screenshot({ path: screenPath });
      const pdfPng = report.file(`pdf-${String(i + 1).padStart(digits, "0")}.png`);
      // Compared at 96 dpi after downscaling both, as D27 measured: at 192 dpi the art's resampling (a 300 ppi JPEG
      // in the PDF, layers drawn at 2x on screen) outlines every painted edge without anything having moved.
      const size = Math.round((await sharp(screenPath).metadata()).width! / 2);
      const screen = await sharp(screenPath)
        .removeAlpha()
        .resize(size, size, { fit: "fill" })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const printed = await sharp(pdfPng)
        .removeAlpha()
        .resize(screen.info.width, screen.info.height, { fit: "fill" })
        .raw()
        .toBuffer();
      const diff = Buffer.alloc(screen.data.length);
      let differing = 0;
      for (let p = 0; p < screen.data.length; p += 3) {
        const off = Math.max(...[0, 1, 2].map((c) => Math.abs(screen.data[p + c]! - printed[p + c]!)));
        if (off > PIXEL_TOLERANCE) {
          differing++;
          diff[p] = 255;
        } else diff.fill(Math.round(screen.data[p]! * 0.3 + 160), p, p + 3);
      }
      const share = differing / (screen.data.length / 3);
      worstShare = Math.max(worstShare, share);
      await sharp(diff, { raw: screen.info })
        .png()
        .toFile(report.file(`diff-${i + 1}.png`));
      pixelRows.push(`page ${i + 1}: ${(share * 100).toFixed(2)}%`);

      const dom = readingOrder(screenWords[i]!);
      const printedWords = readingOrder(
        pdfWords(pdfPath, i + 1).filter((word) => dom.some((d) => d.text === word.text)),
      );
      const domLines = lineOf(dom);
      const pdfLines = lineOf(printedWords);
      dom.forEach((word, w) => {
        const other = printedWords[w];
        if (!other || other.text !== word.text)
          return void lineMismatches.push(`page ${i + 1} word ${w + 1} "${word.text}" vs "${other?.text}"`);
        worstShift = Math.max(worstShift, Math.abs(other.x - word.x));
        drops.set(word.size, [
          ...(drops.get(word.size) ?? []),
          { drop: other.y - word.y, where: `page ${i + 1} "${word.text}"` },
        ]);
        if (pdfLines[w] !== domLines[w])
          lineMismatches.push(
            `page ${i + 1}: "${word.text}" on line ${domLines[w]! + 1} on screen, ${pdfLines[w]! + 1} in print`,
          );
      });
    }
    let worstDropAt = "";
    for (const sized of drops.values()) {
      const median = sized.map((d) => d.drop).toSorted((a, b) => a - b)[Math.floor(sized.length / 2)]!;
      for (const { drop, where } of sized) {
        if (Math.abs(drop - median) <= worstDrop) continue;
        worstDrop = Math.abs(drop - median);
        worstDropAt = where;
      }
    }
    report.facts.pixelDiff = pixelRows;
    report.facts.maxWordDropPt = Number(worstDrop.toFixed(2));
    report.facts.maxWordShiftPt = Number(worstShift.toFixed(2));
    report.check(
      "pixels",
      worstShare <= MAX_DIFF_SHARE,
      `worst page ${(worstShare * 100).toFixed(2)}% of pixels off by >5% (limit ${MAX_DIFF_SHARE * 100}%); ${pixelRows.join(", ")}`,
    );
    report.check(
      "line breaks",
      lineMismatches.length === 0,
      lineMismatches.length
        ? lineMismatches.slice(0, 3).join("; ")
        : `${screenWords.flat().length} words on the same lines on screen and in print`,
    );
    report.check(
      "word positions",
      worstShift <= MAX_WORD_SHIFT_PT && worstDrop <= MAX_WORD_DROP_PT,
      `max |Δx| ${worstShift.toFixed(2)} pt (limit ${MAX_WORD_SHIFT_PT} pt), max |Δy| ${worstDrop.toFixed(2)} pt from its size's median at ${worstDropAt} (limit ${MAX_WORD_DROP_PT} pt)`,
    );

    // Delete the proof the way a parent does, so a run leaves no draft behind: it leaves the list and its PDF.
    await page.goto(bookPath);
    const made = page.getByTestId("proof").filter({ has: page.locator(`a[href="${href}"]`) });
    page.once("dialog", (dialog) => void dialog.accept());
    await made.getByRole("button", { name: /^Delete proof of/ }).click();
    await made.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
    const gone = (await made.count()) === 0;
    const after = (await page.request.get(href)).status();
    report.check("delete", gone && after === 404, `listed after delete: ${!gone}; ${href} → ${after}`);
  } finally {
    await session.close();
  }
};
