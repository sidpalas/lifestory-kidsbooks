// The post-deploy check (scripts/check-deploy.ts) passes a commit that a newer push superseded before it went live:
// the push cancels its CI run, so Railway reports its deploy as failed while an older commit is still live.
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../scripts/check-deploy.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "check-deploy-"));
const repo = join(dir, "repo");
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const commits: string[] = [];

const server = createServer((request, response) => {
  if (request.url !== "/api/health") return void response.writeHead(404).end();
  const live = commits[0];
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ status: "ok", version: live, workers: [{ version: live, lastBeatSecondsAgo: 5 }] }));
});

const check = (sha: string) =>
  new Promise<{ code: number; stdout: string }>((resolve) => {
    const { port } = server.address() as AddressInfo;
    execFile(
      process.execPath,
      [script, "--url", `http://127.0.0.1:${port}`, "--sha", sha, "--wait-minutes", "0"],
      { cwd: repo },
      (error, stdout) => resolve({ code: (error?.code as number | undefined) ?? 0, stdout }),
    );
  });

beforeAll(async () => {
  execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", join(dir, "origin.git")]);
  execFileSync("git", ["clone", "--quiet", join(dir, "origin.git"), repo], { stdio: "ignore" });
  for (const message of ["live", "superseded", "head"]) {
    git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "--quiet", "--allow-empty", "-m", message);
    commits.push(git("rev-parse", "HEAD"));
  }
  git("push", "--quiet", "origin", "main");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});
afterAll(() => server.close());

describe("check-deploy", () => {
  it("passes a commit that never went live once a newer commit is on main", async () => {
    const { code, stdout } = await check(commits[1]!);
    expect(stdout).toContain(`Superseded: ${commits[2]!.slice(0, 7)}`);
    expect(code).toBe(0);
  });

  it("fails the head of main when the live site doesn't run it", async () => {
    const { code, stdout } = await check(commits[2]!);
    expect(stdout).toContain(`FAIL web runs ${commits[2]!.slice(0, 7)}`);
    expect(code).toBe(1);
  });
});
