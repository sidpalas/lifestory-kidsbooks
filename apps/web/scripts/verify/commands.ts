// The verify CLI's commands, as data: main.ts dispatches on them, `verify help` prints them, and
// apps/web/test/feature-map.test.ts checks that every `verify <command>` the feature map (docs/features) names exists.
export type ConfigName = "dev" | "image" | "live";

export interface CommandInfo {
  readonly name: string;
  readonly summary: string;
  /** Configurations the command runs in. */
  readonly configs: ReadonlyArray<ConfigName>;
  /** Whether it writes app data (a proof, a character). Live runs write only to the agent's own family (D38). */
  readonly writes: boolean;
}

export const commands: ReadonlyArray<CommandInfo> = [
  {
    name: "doctor",
    summary: "Check the configuration is worth driving: infra, migrations, web, workers, and the print origin they use",
    configs: ["dev", "image", "live"],
    writes: false,
  },
  {
    name: "up",
    summary:
      "Start the configuration (web and worker on one origin) and keep it running until Ctrl-C, for driving by hand",
    configs: ["dev", "image"],
    writes: false,
  },
  {
    name: "proof",
    summary:
      "PDF proof of a family book: the worker renders it, it is print-ready, and every page matches the editor by pixels and line positions",
    configs: ["dev", "image", "live"],
    writes: true,
  },
  {
    name: "layout",
    summary:
      "Page previews in the book editor, story page, and draft preview at 320, 390, and 1280 px: page shape kept, no overlap, cropping, or sideways scroll",
    configs: ["dev", "image", "live"],
    writes: true,
  },
  {
    name: "e2e",
    summary: "Playwright e2e on one consistent port, sampling peak memory against the orb's 3 GiB cap",
    configs: ["dev"],
    writes: true,
  },
];
