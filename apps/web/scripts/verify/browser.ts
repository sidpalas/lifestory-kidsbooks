// The browser drives use: full Chromium, not Playwright's headless shell. The editor runs in full Chrome, which
// lays words out at fractional positions; the headless shell rounds them to whole pixels (commit c9a06f1), so a
// comparison made inside the shell can't see screen-versus-print drift.
import { type Browser, type BrowserContext, chromium, type Page } from "@playwright/test";
import type { Stack } from "./stack.ts";

export interface Session {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly close: () => Promise<void>;
}

/** A signed-in page as the stack's account, through Better Auth's sign-in endpoint (the path /sign-in posts to). */
export const signedIn = async (stack: Stack, options: { deviceScaleFactor?: number } = {}): Promise<Session> => {
  const browser = await chromium.launch({ channel: "chromium" });
  const context = await browser.newContext({ baseURL: stack.origin, viewport: { width: 1280, height: 1000 }, deviceScaleFactor: options.deviceScaleFactor ?? 1 });
  const close = async () => {
    await context.close();
    await browser.close();
  };
  try {
    const response = await context.request.post("/api/auth/sign-in/email", {
      data: stack.account,
      headers: { origin: stack.origin },
    });
    if (!response.ok()) throw new Error(`sign-in as ${stack.who} failed: HTTP ${response.status()} ${(await response.text()).slice(0, 200)}`);
    return { browser, context, page: await context.newPage(), close };
  } catch (error) {
    await close();
    throw error;
  }
};

/** Waits until every image on the page has loaded; returns the URLs of any that failed. */
export const imagesSettled = async (page: Page, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await page.evaluate(() => ({
      pending: [...document.images].filter((img) => !img.complete).length,
      broken: [...document.images].filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.src),
    }));
    if (state.pending === 0 || Date.now() > deadline) return state.broken;
    await page.waitForTimeout(250);
  }
};
