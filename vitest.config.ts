import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    // The default, set explicitly: a fresh module graph per test file. Setting it also stops Vitest's "isolate: false" tip.
    isolate: true,
  },
});
