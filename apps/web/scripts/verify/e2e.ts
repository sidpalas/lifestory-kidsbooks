// verify e2e: the Playwright suite (or the specs named after --) on one port the whole run agrees on, with peak
// memory sampled the way AGENTS.md ("Orb size") says: anon + shmem + kernel of amp-workload.slice, once a second,
// never memory.current or memory.peak (both include page cache).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Report } from "./report.ts";
import { liveWorkerBeats, readHealth, repoRoot } from "./stack.ts";

const CGROUP = "/sys/fs/cgroup/amp.slice/amp-workload.slice";
const GiB = 1024 ** 3;

const workloadBytes = () => {
  let total = 0;
  for (const line of readFileSync(`${CGROUP}/memory.stat`, "utf8").split("\n")) {
    const [key, value] = line.split(" ");
    if (key === "anon" || key === "shmem" || key === "kernel") total += Number(value);
  }
  return total;
};

const running = (pattern: string) => {
  try {
    return execFileSync("pgrep", ["-f", pattern], { encoding: "utf8" }).trim() !== "";
  } catch {
    return false;
  }
};

export const e2e = async (report: Report, options: { port: number; ci: boolean; args: string[] }) => {
  const { port } = options;
  const origin = `http://localhost:${port}`;
  if (process.env.E2E_PORT && Number(process.env.E2E_PORT) !== port)
    report.check("port", false, `E2E_PORT=${process.env.E2E_PORT} but --port ${port}; pass one of them`, { fatal: true });
  const webUp = (await readHealth(origin)) !== null;
  if (options.ci && webUp) report.check("port", false, `CI=1 starts a fresh web app, but :${port} is taken (the web service?): add --port 3100`, { fatal: true });
  report.check("port", true, `${webUp ? "reusing the web app on" : "Playwright starts a web app on"} ${origin}; its worker prints from there (PRINT_APP_URL)`);
  // Our own worker doesn't exist yet: every live worker is someone else's, and would take the tests' tasks with its
  // own IMAGE_PROVIDER and print origin (Playwright's global setup refuses too; this says so before anything starts).
  // A worker that just stopped may not have deleted its heartbeat (`node --watch` under systemd dies mid-shutdown):
  // wait until its beat goes stale, but fail as soon as another beat shows it is alive.
  let others = liveWorkerBeats();
  const seen = new Map(others.map((worker) => [worker.id, worker.beatAt]));
  for (const deadline = Date.now() + 40_000; others.length > 0 && Date.now() < deadline; others = liveWorkerBeats()) {
    if (others.some((worker) => seen.has(worker.id) && seen.get(worker.id) !== worker.beatAt)) break;
    for (const worker of others) if (!seen.has(worker.id)) seen.set(worker.id, worker.beatAt);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  report.check(
    "other workers",
    others.length === 0,
    others.length === 0 ? "none share the database" : `${others.length} (${others.map((worker) => worker.version).join(", ")}) share the database and would take the tests' tasks: amp orb service stop worker`,
    { fatal: others.length > 0 },
  );
  report.check("agent-browser", !running("agent-browser"), running("agent-browser") ? "agent-browser is running; agent-browser close first (AGENTS.md, \"Orb size\": not measured alongside)" : "closed", { fatal: running("agent-browser") });

  const measure = existsSync(`${CGROUP}/memory.stat`);
  const capBytes = measure ? Number(readFileSync(`${CGROUP}/memory.max`, "utf8").trim()) || 3 * GiB : 3 * GiB;
  let peak = measure ? workloadBytes() : 0;
  const baseline = peak;
  const sampler = measure ? setInterval(() => (peak = Math.max(peak, workloadBytes())), 1000) : undefined;
  const started = Date.now();
  const env = { ...process.env, E2E_PORT: String(port), ...(options.ci ? { CI: "1" } : {}) };
  const log: string[] = [];
  const onData = (chunk: Buffer) => {
    process.stdout.write(chunk);
    log.push(chunk.toString());
  };
  const code = await new Promise<number>((resolve) => {
    const child = spawn("playwright", ["test", ...options.args], { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (exit, signal) => resolve(exit ?? (signal ? 137 : 1)));
  });
  clearInterval(sampler);
  const output = log.join("");
  writeFileSync(report.file("playwright.log"), output);
  const summary = output.match(/\d+ (passed|failed|flaky|skipped)[^\n]*/g)?.join(", ") ?? "no summary";
  report.check("suite", code === 0, `exit ${code} in ${((Date.now() - started) / 60000).toFixed(1)} min: ${summary}`);
  if (measure) {
    report.facts.peakGiB = Number((peak / GiB).toFixed(2));
    report.facts.capGiB = Number((capBytes / GiB).toFixed(2));
    report.check("memory", peak < capBytes * 0.95 && code !== 137, `peak ${(peak / GiB).toFixed(2)} GiB of the ${(capBytes / GiB).toFixed(2)} GiB cap (anon+shmem+kernel; ${(baseline / GiB).toFixed(2)} GiB before the run)${code === 137 ? "; killed, likely by the OOM killer" : ""}`);
  } else report.check("memory", true, `${CGROUP} not found (not an orb): not measured`);
};
