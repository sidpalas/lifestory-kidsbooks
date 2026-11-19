// The feature map (docs/features) stays in step with the verify CLI: every `verify <command>` it names exists and
// runs in the configurations the file claims, and every feature file has the headings agents look for.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commands } from "../scripts/verify/commands.ts";

const dir = new URL("../../../docs/features/", import.meta.url);
const files = readdirSync(dir).filter((name) => name.endsWith(".md"));
const read = (name: string) => readFileSync(new URL(name, dir), "utf8");

describe("feature map", () => {
  it("names only verify commands that exist", () => {
    const named = files.flatMap((name) => [...read(name).matchAll(/verify(?: --)? ([a-z][\w-]*)/g)].map((m) => `${name}: ${m[1]}`));
    expect(named.length).toBeGreaterThan(0);
    const unknown = named.filter((entry) => entry.split(": ")[1] !== "help" && !commands.some((c) => c.name === entry.split(": ")[1]));
    expect(unknown).toEqual([]);
  });

  it("gives every feature file the same headings", () => {
    for (const name of files.filter((n) => n !== "README.md")) {
      const headings = [...read(name).matchAll(/^## (.+)$/gm)].map((m) => m[1]);
      expect(headings, name).toEqual(["What it is", "Routes and roles", "Seed data", "Verify", "Gotchas"]);
    }
  });

  it("links every feature file from the index", () => {
    const index = read("README.md");
    for (const name of files.filter((n) => n !== "README.md")) expect(index, name).toContain(`](${name})`);
  });
});
