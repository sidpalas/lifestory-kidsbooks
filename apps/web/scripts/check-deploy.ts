// Post-deploy check of the live site, without signing in (.github/workflows/deploy-check.yml runs it when
// Railway reports a deploy). Waits until the web app and a worker both report the expected commit, then checks:
// /api/health is ok with this commit's migration count, the sign-in page and every stylesheet, font, and script
// it links load (a missing stylesheet once shipped unstyled pages, commit fbd8a10), the landing
// page at / and its social preview image load, and the /__dev routes are 404.
// Exits 1 listing every failure. If a newer commit is already live, this one was superseded and it exits 0.
//
//   node apps/web/scripts/check-deploy.ts --url https://lifestory.devopsdirective.com --sha <commit> [--wait-minutes 20]
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "https://lifestory.devopsdirective.com" },
    sha: { type: "string" },
    "wait-minutes": { type: "string", default: "0" },
  },
});
const origin = new URL(values.url).origin;
const sha = values.sha ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const deadline = Date.now() + Number(values["wait-minutes"]) * 60_000;
const journal = JSON.parse(
  readFileSync(new URL("../../../packages/db/migrations/meta/_journal.json", import.meta.url), "utf8"),
) as { entries: unknown[] };
const expectedMigrations = journal.entries.length;

interface Health {
  status?: string;
  migrations?: number;
  version?: string | null;
  workers?: { version: string | null; lastBeatSecondsAgo: number }[];
}

const get = (path: string, init?: RequestInit) =>
  fetch(new URL(path, origin), { redirect: "manual", signal: AbortSignal.timeout(15_000), ...init });
const readHealth = async (): Promise<Health | string> => {
  try {
    const response = await get("/api/health");
    return response.ok ? ((await response.json()) as Health) : `HTTP ${response.status}`;
  } catch (error) {
    return String(error);
  }
};
const short = (version: string | null | undefined) => version?.slice(0, 7) ?? "none";

/** Whether `commit` is an ancestor of `newer`, fetching origin once if git doesn't know `newer` yet. */
const isAncestor = (commit: string, newer: string): boolean => {
  const run = () => execFileSync("git", ["merge-base", "--is-ancestor", commit, newer], { stdio: "ignore" });
  for (const fetchFirst of [false, true]) {
    try {
      if (fetchFirst) execFileSync("git", ["fetch", "--quiet", "origin"], { stdio: "ignore" });
      run();
      return true;
    } catch (error) {
      if ((error as { status?: number }).status === 1) return false;
    }
  }
  return false;
};

// ---- Wait for the deploy: both services release independently (D22), each in a few minutes. ----
console.log(`Checking ${origin} for commit ${short(sha)} (${expectedMigrations} migrations)`);
for (;;) {
  const health = await readHealth();
  const web = typeof health === "string" ? health : `web ${short(health.version)}`;
  const workers =
    typeof health === "string" ? "" : `workers ${health.workers?.map((w) => short(w.version)).join(",") || "none"}`;
  if (typeof health !== "string" && health.version && health.version !== sha && isAncestor(sha, health.version)) {
    console.log(`Superseded: ${short(health.version)}, a newer commit, is live. Nothing to check for ${short(sha)}.`);
    process.exit(0);
  }
  const live = typeof health !== "string" && health.version === sha && health.workers?.some((w) => w.version === sha);
  if (live || Date.now() >= deadline) break;
  console.log(`  waiting: ${web} ${workers}`);
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}

// ---- Checks ----
const failures: string[] = [];
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

const health = await readHealth();
if (typeof health === "string") {
  check(false, `/api/health answers: ${health}`);
} else {
  check(health.status === "ok", `/api/health status is ok (got ${health.status})`);
  check(
    health.migrations === expectedMigrations,
    `/api/health reports ${expectedMigrations} migrations (got ${health.migrations})`,
  );
  check(health.version === sha, `web runs ${short(sha)} (got ${short(health.version)})`);
  const workers = health.workers ?? [];
  check(
    workers.some((w) => w.version === sha),
    `a worker running ${short(sha)} beat in the last 90 s (live: ${workers.map((w) => `${short(w.version)} ${w.lastBeatSecondsAgo}s ago`).join(", ") || "none"})`,
  );
}

/** Fetches an asset; fine when it's 200 and not an HTML page (a fallback page would hide a missing file). */
const checkAsset = async (path: string, kind: string): Promise<Response | undefined> => {
  try {
    const response = await get(path);
    const type = response.headers.get("content-type") ?? "";
    const expected = kind === "stylesheet" ? type.includes("text/css") : !type.includes("text/html");
    check(response.status === 200 && expected, `${kind} ${path} loads (HTTP ${response.status}, ${type || "no type"})`);
    return response;
  } catch (error) {
    check(false, `${kind} ${path} loads (${String(error)})`);
  }
};

try {
  const page = await get("/sign-in");
  const html = await page.text();
  check(page.status === 200 && html.includes("Lifestory is invite-only."), `/sign-in loads (HTTP ${page.status})`);
  const links = [...html.matchAll(/<link\b[^>]*>/g)].map(([tag]) => ({
    rel: /\brel="([^"]*)"/.exec(tag)?.[1] ?? "",
    as: /\bas="([^"]*)"/.exec(tag)?.[1],
    href: /\bhref="([^"]*)"/.exec(tag)?.[1] ?? "",
  }));
  const stylesheets = links.filter((l) => l.rel === "stylesheet").map((l) => l.href);
  const fonts = new Set(links.filter((l) => l.rel === "preload" && l.as === "font").map((l) => l.href));
  const scripts = [
    ...links.filter((l) => l.rel === "modulepreload").map((l) => l.href),
    ...[...html.matchAll(/<script\b[^>]*\bsrc="([^"]*)"/g)].map(([, src]) => src!),
  ];
  check(stylesheets.length > 0, `/sign-in links a stylesheet (${stylesheets.length})`);
  for (const href of stylesheets) {
    const response = await checkAsset(href, "stylesheet");
    const css = response?.ok ? await response.text() : "";
    for (const [, url] of css.matchAll(/url\(\s*["']?([^"')]+\.(?:woff2?|ttf|otf))["']?\s*\)/g)) {
      fonts.add(new URL(url!, new URL(href, origin)).pathname);
    }
  }
  check(fonts.size > 0, `the sign-in page's stylesheets and preloads name fonts (${fonts.size})`);
  for (const href of fonts) await checkAsset(href, "font");
  for (const src of new Set(scripts)) await checkAsset(src, "script");
} catch (error) {
  check(false, `/sign-in loads (${String(error)})`);
}

// Signed-out visitors get the landing page at / (not a redirect), and its link preview image loads.
try {
  const page = await get("/");
  const html = await page.text();
  check(
    page.status === 200 && html.includes("Picture books starring your family"),
    `/ shows the landing page (HTTP ${page.status})`,
  );
  const preview = /<meta[^>]*property="og:image"[^>]*content="([^"]*)"/.exec(html)?.[1];
  check(preview?.startsWith(`${origin}/`) ?? false, `/ names a same-origin og:image (${preview ?? "none"})`);
  if (preview) await checkAsset(new URL(preview).pathname, "social preview image");
} catch (error) {
  check(false, `/ shows the landing page (${String(error)})`);
}

// D17: production images compile the dev routes out. A redirect or 200 here would mean dev sign-in is live.
for (const path of ["/__dev", "/__dev/mailbox", "/__dev/log-me-out", "/__dev/log-me-in/deploy-check@example.invalid"]) {
  try {
    const response = await get(path);
    check(response.status === 404, `${path} is 404 (got ${response.status})`);
  } catch (error) {
    check(false, `${path} is 404 (${String(error)})`);
  }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    failures.length
      ? `### Deploy check failed for ${short(sha)} on ${origin}\n\n${failures.map((f) => `- ${f}`).join("\n")}\n`
      : `### Deploy check passed for ${short(sha)} on ${origin}\n`,
  );
}
console.log(failures.length ? `\n${failures.length} check(s) failed.` : "\nAll checks passed.");
process.exit(failures.length ? 1 : 0);
