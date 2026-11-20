// verify layout: docs/features/page-previews.md. Opens a family's book of --story (making one if the family has none),
// the story's own page, and, when the account authors a story with a draft open, its draft preview, at 320 and 390
// CSS px (phones) and 1280 (desktop). On each it checks every page preview keeps the page's shape, fits the screen,
// overlaps no other preview, and that the page doesn't scroll sideways; it screenshots each view.
// It writes a book only when the family has none of the story.
import { signedIn } from "./browser.ts";
import type { Report } from "./report.ts";
import type { Stack } from "./stack.ts";

const WIDTHS = [320, 390, 1280];

interface Measured {
  readonly scrollWidth: number;
  readonly previews: ReadonlyArray<{ readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; readonly ratio: number; readonly visibleRight: number; readonly cropped: boolean }>;
}

/** Every page preview's box on screen, the part of it that shows (previews clip the page), and its width/height. */
const measure = (page: import("@playwright/test").Page): Promise<Measured> =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    previews: [...document.querySelectorAll<HTMLElement>("[data-testid=book-page]")].map((sheet) => {
      const box = sheet.getBoundingClientRect();
      // The nearest ancestor that clips: what the reader sees of the page.
      let clip: HTMLElement | null = sheet.parentElement;
      while (clip && getComputedStyle(clip).overflow === "visible") clip = clip.parentElement;
      const shown = (clip ?? sheet).getBoundingClientRect();
      return {
        left: box.left,
        top: box.top + window.scrollY,
        right: box.right,
        bottom: box.bottom + window.scrollY,
        ratio: shown.width / shown.height,
        visibleRight: Math.min(box.right, shown.right),
        // The page as drawn must be no bigger than what shows of it, or the clip crops its edge.
        cropped: box.width - shown.width > 1 || box.height - shown.height > 1,
      };
    }),
  }));

export const layout = async (stack: Stack, report: Report, options: { story: string }) => {
  const session = await signedIn(stack, { deviceScaleFactor: 2 });
  const { page } = session;
  try {
    await page.goto(`/stories/${options.story}`);
    await page.getByTestId("book-page").first().waitFor({ timeout: 30_000 });
    const ratio = await page.getByTestId("book-page").first().evaluate((sheet) => (sheet as HTMLElement).offsetWidth / (sheet as HTMLElement).offsetHeight);
    const storyUrl = page.url();
    const existing = page.getByTestId("story-books").getByRole("link").first();
    if (await existing.count()) await existing.click();
    else {
      // Cast each role with the first family member it accepts, adding a child and a grown-up if nobody fits.
      const roles = page.getByRole("list", { name: "Roles" }).locator("select");
      const family = () => roles.evaluateAll((selects) => selects.map((select) => select.querySelector<HTMLOptionElement>('optgroup[label="Your family"] option')?.value ?? null));
      if ((await family()).includes(null)) {
        for (const age of ["Young child", "Adult"]) {
          await page.goto("/characters/new");
          await page.getByLabel("Name").fill(`Layout ${age}`);
          await page.getByRole("button", { name: age, exact: true }).click();
          await page.getByRole("button", { name: "Add to the family" }).click();
          await page.getByTestId("characters").waitFor();
        }
        await page.goto(storyUrl);
      }
      for (const [i, value] of (await family()).entries()) if (value) await roles.nth(i).selectOption(value);
      await page.getByRole("button", { name: "Make the book", exact: true }).click();
    }
    await page.waitForURL(/\/books\/book_/);
    const views: Array<[string, string]> = [
      ["book", page.url()],
      ["story", storyUrl],
    ];
    await page.goto("/author");
    const authored = page.getByTestId("authored-stories").getByRole("link");
    for (let i = 0; i < (await authored.count()); i++) {
      const href = (await authored.nth(i).getAttribute("href"))!;
      await page.goto(href);
      // The author page renders only in the browser (ssr: false): wait for it before looking for a preview.
      await page.getByTestId("authoring-meta").waitFor({ timeout: 30_000 });
      if (await page.getByTestId("draft-preview").count()) {
        views.push(["author", page.url()]);
        break;
      }
      await page.goto("/author");
    }
    report.check("views", true, `${views.map(([name, url]) => `${name} ${new URL(url).pathname}`).join(", ")}${views.length < 3 ? " (no draft to preview as this account)" : ""}; page ratio ${ratio.toFixed(3)}`);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const [name, url] of views) {
        await page.goto(url);
        await page.getByTestId("book-page").first().waitFor({ timeout: 30_000 });
        await page.waitForLoadState("networkidle");
        const { scrollWidth, previews } = await measure(page);
        const problems: string[] = [];
        if (scrollWidth > width) problems.push(`scrolls sideways (${scrollWidth} px wide)`);
        previews.forEach((p, i) => {
          if (Math.abs(p.ratio - ratio) > 0.02) problems.push(`preview ${i + 1} shows ${p.ratio.toFixed(3)} of the page's ${ratio.toFixed(3)} shape`);
          if (p.cropped) problems.push(`preview ${i + 1} is cropped`);
          if (p.visibleRight > width + 0.5) problems.push(`preview ${i + 1} runs ${Math.round(p.visibleRight - width)} px off screen`);
          previews.slice(i + 1).forEach((q, j) => {
            const overlap = Math.min(p.right, q.right) - Math.max(p.left, q.left) > 1 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 1;
            if (overlap) problems.push(`previews ${i + 1} and ${i + j + 2} overlap`);
          });
        });
        const widths = [...new Set(previews.map((p) => Math.round(p.right - p.left)))].join("/");
        report.check(`${name} ${width}px`, problems.length === 0, problems.length ? problems.slice(0, 4).join("; ") : `${previews.length} previews ${widths} px wide, none overlap or crop, no sideways scroll`);
        await page.screenshot({ path: report.file(`${name}-${width}.png`), fullPage: true });
      }
    }
  } finally {
    await session.close();
  }
};
