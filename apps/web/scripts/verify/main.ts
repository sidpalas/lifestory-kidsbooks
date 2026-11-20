// The verify CLI: drives the real app in a named configuration and keeps the evidence. docs/features/README.md is the
// feature map that says which command proves which feature.
//
//   mise run verify -- <command> [--config dev|image|live] [--port <n>] [--story <slug>] [--as <email>] [--url <origin>]
//   mise run verify -- help
//
// Exit 0 when every check passed, 1 when one failed, 2 on a usage error.
import { parseArgs } from "node:util";
import { commands, type ConfigName } from "./commands.ts";
import { e2e } from "./e2e.ts";
import { layout } from "./layout.ts";
import { looks } from "./looks.ts";
import { picker } from "./picker.ts";
import { proof } from "./proof.ts";
import { FatalCheck, Report } from "./report.ts";
import { DEFAULT_PORT, repoRoot, type Stack, startStack } from "./stack.ts";

const usage = () => {
  console.log(`verify <command> [options]   (feature map: docs/features/README.md)

Commands:
${commands.map((c) => `  ${c.name.padEnd(8)} ${c.summary}\n           configs: ${c.configs.join(", ")}${c.writes ? "; writes app data" : ""}`).join("\n")}

Options:
  --config dev|image|live  dev (default): the dev web app on --port (reused if up) and a worker of this run's
                           image: production images built from this checkout, against local Postgres and SeaweedFS
                           live: ${"https://lifestory.devopsdirective.com"} as the agent family (D38)
  --port <n>               dev: 3000 (default); image: 3200. Every process in the run uses this one origin.
  --story <slug>           proof, looks, layout: the story (default the-moon-picnic)
  --as <email>             dev, image: sign in as another seeded account (default parent@lifestory.dev)
  --url <origin>           live: another origin
  --no-build               image: reuse the last built images
  --ci                     e2e: CI=1 (fresh web app, retries)
  -- <args>                e2e: passed to playwright test, e.g. -- milestone1

Evidence goes to .amp/in/artifacts/verify/<time>-<command>-<config>/ with report.json.`);
};

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
const { values, positionals } = parseArgs({
  args: split === -1 ? argv : argv.slice(0, split),
  allowPositionals: true,
  options: {
    config: { type: "string", default: "dev" },
    port: { type: "string" },
    story: { type: "string", default: "the-moon-picnic" },
    as: { type: "string" },
    url: { type: "string" },
    "no-build": { type: "boolean", default: false },
    ci: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});
const name = positionals[0];
const command = commands.find((c) => c.name === name);
const config = values.config as ConfigName;
const fail = (message: string) => {
  console.error(`verify: ${message}\nRun mise run verify -- help.`);
  process.exit(2);
};
if (!name || name === "help" || values.help) {
  usage();
  process.exit(0);
}
if (!command) fail(`no command "${name}"; commands: ${commands.map((c) => c.name).join(", ")}`);
if (!["dev", "image", "live"].includes(config)) fail(`--config is dev, image, or live, not "${config}"`);
if (!command!.configs.includes(config)) fail(`${name} runs in ${command!.configs.join(", ")}, not ${config}`);
if (config === "live" && values.port) fail("--port doesn't apply to live; use --url");
if (config !== "live" && values.url) fail("--url applies only to live");
// One port per run: a PORT in the environment that disagrees would start the web app on one origin and print from another.
const port = Number(values.port ?? process.env.E2E_PORT ?? DEFAULT_PORT[config]);
if (process.env.PORT && Number(process.env.PORT) !== port) fail(`PORT=${process.env.PORT} is set but this run uses :${port}; unset PORT or pass --port ${process.env.PORT}`);

const report = new Report(name!, config, repoRoot);
let stack: Stack | undefined;
let error: unknown;
try {
  if (name === "e2e") await e2e(report, { port, ci: values.ci, args: split === -1 ? [] : argv.slice(split + 1) });
  else {
    stack = await startStack({ config, port, url: values.url, as: values.as, inspectOnly: name === "doctor", build: !values["no-build"] }, report);
    report.facts.origin = stack.origin;
    if (name === "picker") await picker(stack, report);
    if (name === "proof") await proof(stack, report, { story: values.story });
    if (name === "looks") await looks(stack, report, { story: values.story });
    if (name === "layout") await layout(stack, report, { story: values.story });
    if (name === "up") {
      console.log(`\nUp: ${stack.origin}, signed-in account ${stack.who}. Ctrl-C stops what this run started.`);
      await new Promise((resolve) => process.once("SIGINT", resolve));
    }
  }
} catch (caught) {
  error = caught;
  if (caught instanceof FatalCheck === false) report.checks.push({ name: "error", ok: false, detail: String(caught instanceof Error ? caught.message : caught) });
} finally {
  await stack?.teardown();
}
process.exit(report.finish(stack?.origin, error) ? 0 : 1);
