// Production HTTP server. `vite build` emits the app as a fetch handler
// (dist/server/server.js) plus static assets (dist/client); srvx serves both.
// Used by apps/web/Dockerfile: `pnpm build`, then `pnpm start`.
import { serve } from "srvx";
import { staticMiddleware } from "srvx/static";

// @ts-expect-error: built output, no type declarations
import app from "./dist/server/server.js";

serve({
  port: Number(process.env.PORT ?? 3000),
  middleware: [staticMiddleware({ dir: new URL("./dist/client", import.meta.url).pathname })],
  fetch: app.fetch,
});
