import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" },
  resolve: { tsconfigPaths: true },
  // sharp (the recolour in @lifestory/core) loads a native binary from its own package. Bundled into dist/server,
  // it can't find it, so it stays an import resolved from apps/web/node_modules at runtime (a direct dependency).
  ssr: { external: ["sharp"] },
  // The browser imports only @lifestory/core/contracts (effect), but Vite's dependency scan follows the server
  // functions into @lifestory/core and pre-bundled its server packages (playwright-core, sharp, pg, the S3 SDK, ...)
  // for the browser: on a cold cache that added ~0.5 GB to the dev server for the rest of its life, enough to run a
  // 4 GB orb out of memory during the e2e tests.
  optimizeDeps: { exclude: ["@lifestory/core"] },
  plugins: [tailwindcss(), tanstackStart({ srcDirectory: "src" }), viteReact()],
});
