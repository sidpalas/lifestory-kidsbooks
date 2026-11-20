// The three configurations the verify CLI drives (docs/features/README.md, "Configurations"):
//   dev    the dev web server (`mise run dev:web`, reused if one answers on --port) and a worker of its own
//   image  the production web and worker images, built from this checkout, against the local Postgres and SeaweedFS
//   live   the production site, signed in as the agent family (D38); nothing is started
// Every configuration has one origin, and the worker that renders proofs prints from that same origin: the CLI
// starts its worker with PRINT_APP_URL set to it, and doctor fails when another live worker could take a proof
// task and print from an origin where nothing answers.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import type { ConfigName } from "./commands.ts";
import type { Report } from "./report.ts";

export const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const LIVE_ORIGIN = "https://lifestory.devopsdirective.com";
const DEV_PASSWORD = "lifestory-dev-password"; // packages/core/src/dev-users.ts; seeded accounts only
export const DEFAULT_PORT: Record<ConfigName, number> = { dev: 3000, image: 3200, live: 443 };
const tag = (app: string) => `lifestory-${app}:verify`;
const WEB_CONTAINER = "lifestory-verify-web";
const WORKER_CONTAINER = "lifestory-verify-worker";

export interface Health {
  status?: string;
  migrations?: number;
  version?: string | null;
  workers?: { version: string | null; startedAt: string; lastBeatSecondsAgo: number }[];
}

export interface Stack {
  readonly config: ConfigName;
  readonly origin: string;
  /** The account drives sign in as. */
  readonly account: { email: string; password: string };
  /** Who that is, for logs: the email for seeded accounts, never the agent's (a project secret). */
  readonly who: string;
  /** APP_VERSION of the worker this run started (dev, image), to tell it from other workers in the same database. */
  readonly workerVersion: string | null;
  /** Stops what this run started, never anything else. */
  readonly teardown: () => Promise<void>;
}

export const sh = (command: string, args: string[], options: { input?: string } = {}) =>
  execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 << 20,
    ...options,
  });

const gitHead = () => sh("git", ["rev-parse", "HEAD"]).trim();
const migrationCount = () =>
  (JSON.parse(readFileSync(`${repoRoot}packages/db/migrations/meta/_journal.json`, "utf8")) as { entries: unknown[] })
    .entries.length;

export const readHealth = async (origin: string): Promise<Health | null> => {
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5_000) });
    return response.ok ? ((await response.json()) as Health) : null;
  } catch {
    return null;
  }
};

const portOpen = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });

const waitFor = async (what: string, ready: () => Promise<boolean>, seconds: number) => {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${what} wasn't ready after ${seconds} s`);
};

/** A child process in its own process group, so teardown stops it and everything it started. */
const startProcess = (name: string, command: string, args: string[], env: Record<string, string>, readyLine?: RegExp) =>
  new Promise<ChildProcess>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    const onData = (chunk: Buffer) => {
      log = (log + chunk.toString()).slice(-4000);
      if (readyLine?.test(log)) resolve(child);
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.once("exit", (code) => reject(new Error(`${name} exited (${code}) before it was ready:\n${log}`)));
    if (!readyLine) resolve(child);
  });

const stopProcess = async (child: ChildProcess) => {
  if (child.exitCode !== null || !child.pid) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    return;
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // already gone
  }
};

let dockerCommand: string[] | undefined;
export const docker = (args: string[]) => {
  dockerCommand ??= (() => {
    try {
      execFileSync("docker", ["info"], { stdio: "ignore" });
      return ["docker"];
    } catch {
      return ["sudo", "docker"];
    }
  })();
  return sh(dockerCommand[0]!, [...dockerCommand.slice(1), ...args]);
};

/**
 * Settings in .env that would make a run disagree with itself: mise loads .env over the process environment, so a
 * PORT, PRINT_APP_URL, or BETTER_AUTH_URL there would override what this CLI passes to the processes it starts.
 */
const envFileOverrides = () => {
  const path = `${repoRoot}.env`;
  if (!existsSync(path)) return ["no .env (cp .env.example .env)"];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.match(/^\s*(PORT|PRINT_APP_URL|BETTER_AUTH_URL)\s*=/)?.[1])
    .filter((key): key is string => !!key)
    .map((key) => `.env sets ${key}, which overrides the origin this run uses; remove it (AGENTS.md, "Environment")`);
};

/** A query against the local Postgres (compose.yaml). Worker heartbeats only: the CLI never touches app data this way. */
const psql = (query: string) =>
  docker(["compose", "exec", "-T", "postgres", "psql", "-U", "lifestory", "-At", "-c", query]);

/**
 * Versions of the workers that beat in the last 35 s (one 30 s interval plus slack; health counts 90 s), read from
 * the local Postgres, so the check works before any web app answers. Any of them can claim a proof task and print it
 * from its own PRINT_APP_URL; the orb's `worker` service, and any worker started without PRINT_APP_URL, prints from
 * http://localhost:3000.
 */
export const liveWorkerVersions = () =>
  psql("select coalesce(version, 'none') from worker_heartbeat where beat_at > now() - interval '35 seconds'")
    .split("\n")
    .filter(Boolean);

/** The same workers with their IDs and last beats, to tell a live worker (its beat advances) from a stopped one. */
export const liveWorkerBeats = () =>
  psql(
    "select id, coalesce(version, 'none'), beat_at from worker_heartbeat where beat_at > now() - interval '35 seconds'",
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, version, beatAt] = line.split("|") as [string, string, string];
      return { id, version, beatAt };
    });

/** After stopping a worker this run started, drop its heartbeat so the next run doesn't count it. */
const forgetWorker = (version: string) =>
  void psql(`delete from worker_heartbeat where version = '${version.replace(/'/g, "")}'`);

/**
 * The port trap (favicon thread): a run on another port than 3000 while a worker that prints from :3000 shares the
 * database. That worker takes some proof tasks and its Chromium gets connection refused, or prints another app.
 */
export const checkPrintOrigin = async (
  config: ConfigName,
  origin: string,
  ours: ReadonlyArray<string>,
  report: Report,
) => {
  const others = liveWorkerVersions().filter((version) => !ours.includes(version));
  if (others.length === 0)
    return report.check("print origin", true, `no other worker shares the database; proofs print from ${origin}`);
  const list = `${others.length} other worker(s) (${others.join(", ")}) share the database and can take proof tasks`;
  if (config === "image")
    return report.check(
      "print origin",
      false,
      `${list}, so the dev code, not the image, would render some proofs: amp orb service stop worker (a stopped worker clears 35 s later)`,
      { fatal: true },
    );
  if (origin === "http://localhost:3000")
    return report.check("print origin", true, `${list}; they print from http://localhost:3000, this run's origin`);
  const defaultUp = (await readHealth("http://localhost:3000")) !== null;
  report.check(
    "print origin",
    defaultUp,
    defaultUp
      ? `${list}; they print from http://localhost:3000, which answers with the same database`
      : `${list}; they print from http://localhost:3000, where nothing answers, so their proofs fail: amp orb service stop worker, or use --port 3000 (a stopped worker clears 35 s later)`,
    { fatal: !defaultUp },
  );
};

export interface StartOptions {
  readonly config: ConfigName;
  readonly port: number;
  readonly url?: string;
  readonly as?: string;
  /** Start nothing: report what doctor sees. */
  readonly inspectOnly?: boolean;
  readonly build?: boolean;
}

/** Brings the configuration up (reusing what is already running and consistent) and records doctor's checks. */
export const startStack = async (options: StartOptions, report: Report): Promise<Stack> => {
  const { config } = options;
  const stops: Array<() => Promise<void>> = [];
  const teardown = async () => {
    for (const stop of stops.toReversed()) await stop();
  };
  try {
    if (config === "live") return await startLive(options, report, teardown);
    for (const issue of envFileOverrides()) report.check("env", false, issue);
    if (!(await portOpen(5432)) || !(await portOpen(8333)))
      report.check(
        "infra",
        false,
        "Postgres (:5432) or SeaweedFS (:8333) isn't up: run .agents/resume (orbs) or mise run infra:up",
        { fatal: true },
      );
    else report.check("infra", true, "Postgres :5432 and SeaweedFS :8333 answer");
    const origin = `http://localhost:${options.port}`;
    const before = await readHealth(origin);
    const stack =
      config === "dev"
        ? await startDev(options, origin, before, report, stops)
        : await startImage(options, origin, report, stops);
    await doctorStack(stack, report);
    return { ...stack, teardown };
  } catch (error) {
    await teardown();
    throw error;
  }
};

const startLive = async (options: StartOptions, report: Report, teardown: () => Promise<void>): Promise<Stack> => {
  const origin = new URL(options.url ?? LIVE_ORIGIN).origin;
  const email = process.env.LIFESTORY_AGENT_EMAIL;
  const password = process.env.LIFESTORY_AGENT_PASSWORD;
  if (options.as && options.as !== email)
    report.check("account", false, "live runs sign in only as the agent family (D38); drop --as", { fatal: true });
  if (!email || !password)
    report.check(
      "account",
      false,
      'LIFESTORY_AGENT_EMAIL and LIFESTORY_AGENT_PASSWORD aren\'t set (Amp project secrets, README "Agent account"); in an orb, run amp orb restart-processes after adding them',
      { fatal: true },
    );
  report.check("account", true, "the agent family's account from LIFESTORY_AGENT_EMAIL (D38)");
  const stack: Stack = {
    config: "live",
    origin,
    account: { email: email!, password: password! },
    who: "the agent family",
    workerVersion: null,
    teardown,
  };
  await doctorStack(stack, report);
  return stack;
};

const startDev = async (
  options: StartOptions,
  origin: string,
  before: Health | null,
  report: Report,
  stops: Array<() => Promise<void>>,
) => {
  const { port } = options;
  if (before) report.check("web", true, `reusing the web app already answering on ${origin}`);
  else if (await portOpen(port))
    report.check("web", false, `something on :${port} isn't this app (no /api/health); pick another --port`, {
      fatal: true,
    });
  else if (options.inspectOnly)
    report.check("web", false, `nothing answers on ${origin}; verify up --config dev starts it`, { fatal: true });
  else {
    const web = await startProcess("dev web", "mise", ["run", "dev:web"], {
      PORT: String(port),
      BETTER_AUTH_URL: origin,
    });
    stops.push(() => stopProcess(web));
    await waitFor(`the dev web app on ${origin}`, async () => (await readHealth(origin)) !== null, 120);
    report.check("web", true, `started mise run dev:web on ${origin}`);
  }
  const workerVersion = `verify-dev-${process.pid}`;
  if (!options.inspectOnly) {
    // node directly, not `mise exec`: mise would reload .env over PRINT_APP_URL.
    const worker = await startProcess(
      "worker",
      "node",
      ["apps/worker/src/main.ts"],
      { PRINT_APP_URL: origin, APP_VERSION: workerVersion },
      /worker started/,
    );
    stops.push(async () => {
      await stopProcess(worker);
      forgetWorker(workerVersion);
    });
    await waitFor(
      "the worker's first heartbeat",
      async () => !!(await readHealth(origin))?.workers?.some((w) => w.version === workerVersion),
      45,
    );
    report.check("worker", true, `started a worker that prints from ${origin}`);
  }
  return {
    config: "dev" as const,
    origin,
    account: { email: options.as ?? "parent@lifestory.dev", password: DEV_PASSWORD },
    who: options.as ?? "parent@lifestory.dev",
    workerVersion: options.inspectOnly ? null : workerVersion,
  };
};

const containerImage = (name: string) => {
  try {
    return docker(["inspect", "--format", "{{.Image}} {{.State.Running}}", name]).trim();
  } catch {
    return null;
  }
};

const imageId = (app: string) => {
  try {
    return docker(["image", "inspect", "--format", "{{.Id}}", tag(app)]).trim();
  } catch {
    return null;
  }
};

const startImage = async (options: StartOptions, origin: string, report: Report, stops: Array<() => Promise<void>>) => {
  const head = gitHead();
  const dirty = sh("git", ["status", "--porcelain"]).trim() !== "";
  if (options.build !== false && !options.inspectOnly) {
    for (const app of ["web", "worker"]) {
      const started = Date.now();
      docker([
        "build",
        "-q",
        "-f",
        `apps/${app}/Dockerfile`,
        "--label",
        `lifestory.sha=${head}${dirty ? "+dirty" : ""}`,
        "-t",
        tag(app),
        ".",
      ]);
      report.check(
        `build ${app}`,
        true,
        `${tag(app)} from ${head.slice(0, 7)}${dirty ? " plus uncommitted changes" : ""} in ${Math.round((Date.now() - started) / 1000)} s`,
      );
    }
  }
  if (!imageId("web") || !imageId("worker"))
    report.check("images", false, "images not built; run without --no-build", { fatal: true });
  const workerVersion = `verify-image-${head.slice(0, 12)}${dirty ? "-dirty" : ""}`;
  const env = (extra: Record<string, string>) =>
    [
      ["--env-file", ".env"],
      ...Object.entries({ DEV_LOGIN_ENABLED: "false", APP_VERSION: workerVersion, ...extra }).map(([k, v]) => [
        "-e",
        `${k}=${v}`,
      ]),
    ].flat();
  const running = (name: string, app: string) => containerImage(name) === `${imageId(app)} true`;
  const reuse =
    running(WEB_CONTAINER, "web") && running(WORKER_CONTAINER, "worker") && (await readHealth(origin)) !== null;
  if (reuse)
    report.check("containers", true, `reusing ${WEB_CONTAINER} and ${WORKER_CONTAINER} (same images) on ${origin}`);
  else if (options.inspectOnly)
    report.check(
      "containers",
      false,
      `the image containers aren't running on ${origin}; verify up --config image starts them`,
      { fatal: true },
    );
  else {
    if (await portOpen(options.port))
      report.check("port", false, `:${options.port} is taken; pick another --port`, { fatal: true });
    docker(["run", "--rm", "--network", "host", ...env({}), tag("web"), "node", "packages/db/src/migrate.ts"]);
    for (const name of [WEB_CONTAINER, WORKER_CONTAINER]) {
      try {
        docker(["rm", "-f", name]);
      } catch {
        // not there
      }
    }
    docker([
      "run",
      "-d",
      "--name",
      WEB_CONTAINER,
      "--network",
      "host",
      ...env({ PORT: String(options.port), BETTER_AUTH_URL: origin }),
      tag("web"),
    ]);
    docker([
      "run",
      "-d",
      "--name",
      WORKER_CONTAINER,
      "--network",
      "host",
      ...env({ PRINT_APP_URL: origin }),
      tag("worker"),
    ]);
    stops.push(async () => {
      docker(["rm", "-f", WEB_CONTAINER, WORKER_CONTAINER]);
      forgetWorker(workerVersion);
    });
    await waitFor(`the web image on ${origin}`, async () => (await readHealth(origin)) !== null, 60);
    await waitFor(
      "the worker image's heartbeat",
      async () => !!(await readHealth(origin))?.workers?.some((w) => w.version === workerVersion),
      60,
    );
    report.check(
      "containers",
      true,
      `migrated, then started ${WEB_CONTAINER} on ${origin} and ${WORKER_CONTAINER} printing from it`,
    );
  }
  return {
    config: "image" as const,
    origin,
    account: { email: options.as ?? "parent@lifestory.dev", password: DEV_PASSWORD },
    who: options.as ?? "parent@lifestory.dev",
    workerVersion,
  };
};

/** Doctor: is this configuration worth driving? Every finding is a check; fatal ones stop the command. */
const doctorStack = async (stack: Omit<Stack, "teardown">, report: Report) => {
  const health = await readHealth(stack.origin);
  if (!health) return report.check("health", false, `${stack.origin}/api/health doesn't answer`, { fatal: true });
  const expected = migrationCount();
  report.check(
    "migrations",
    health.migrations === expected,
    `${health.migrations} applied, this checkout has ${expected}${health.migrations === expected ? "" : stack.config === "live" ? " (live runs another commit)" : ": run mise run db:migrate"}`,
  );

  if (stack.config === "live") {
    const head = sh("git", ["rev-parse", "origin/main"]).trim();
    report.check(
      "version",
      true,
      `live web runs ${health.version?.slice(0, 7) ?? "unknown"}; origin/main is ${head.slice(0, 7)}${health.version === head ? "" : " (not deployed yet, or superseded)"}`,
    );
    const live = health.workers?.filter((w) => w.version === health.version) ?? [];
    report.check(
      "worker",
      live.length > 0,
      `${live.length} worker(s) on the web's commit (${(health.workers ?? []).length} in all)`,
    );
    return;
  }
  const ours = health.workers?.some((w) => w.version === stack.workerVersion);
  report.check(
    "worker",
    !stack.workerVersion || !!ours,
    stack.workerVersion ? `our worker (${stack.workerVersion}) beats` : "no worker started (doctor only)",
  );
  await checkPrintOrigin(stack.config, stack.origin, stack.workerVersion ? [stack.workerVersion] : [], report);
};
