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
  plugins: [tailwindcss(), tanstackStart({ srcDirectory: "src" }), viteReact()],
});
