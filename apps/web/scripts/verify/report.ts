// A run's checks and evidence. Every run writes .amp/in/artifacts/verify/<time>-<command>-<config>/ with the
// evidence files and report.json, and prints one PASS or FAIL line per check, then a verdict line.
import { mkdirSync, writeFileSync } from "node:fs";
import { relative } from "node:path";

export class FatalCheck extends Error {}

export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export class Report {
  readonly checks: Check[] = [];
  readonly facts: Record<string, unknown> = {};
  readonly dir: string;
  readonly command: string;
  readonly config: string;

  constructor(command: string, config: string, root: string) {
    this.command = command;
    this.config = config;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    this.dir = `${root}.amp/in/artifacts/verify/${stamp}-${command}-${config}`;
    mkdirSync(this.dir, { recursive: true });
  }

  /** Records a check and prints it. A fatal failure stops the command: nothing after it would be evidence. */
  check(name: string, ok: boolean, detail: string, options: { fatal?: boolean } = {}) {
    this.checks.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(16)} ${detail}`);
    if (!ok && options.fatal) throw new FatalCheck(`${name}: ${detail}`);
  }

  /** A path for an evidence file in this run's directory. */
  file(name: string) {
    return `${this.dir}/${name}`;
  }

  get ok() {
    return this.checks.length > 0 && this.checks.every((check) => check.ok);
  }

  finish(origin: string | undefined, error?: unknown) {
    const failed = this.checks.filter((check) => !check.ok).length;
    const summary = {
      command: this.command,
      config: this.config,
      origin,
      ok: this.ok && !error,
      error: error && !(error instanceof FatalCheck) ? String(error instanceof Error ? (error.stack ?? error.message) : error) : undefined,
      checks: this.checks,
      facts: this.facts,
    };
    writeFileSync(this.file("report.json"), `${JSON.stringify(summary, null, 2)}\n`);
    if (summary.error) console.log(`ERROR ${summary.error}`);
    const where = relative(process.cwd(), this.dir) || ".";
    console.log(
      `\nverify ${this.command} (${this.config}${origin ? `, ${origin}` : ""}): ${summary.ok ? "PASS" : "FAIL"} ${this.checks.length - failed}/${this.checks.length} checks. Evidence: ${where}/`,
    );
    return summary.ok;
  }
}
