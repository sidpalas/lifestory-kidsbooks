// Development-only index: GET /__dev lists the dev endpoints and every local user with a sign-in link.
// Returns 404 unless DEV_LOGIN_ENABLED=true and NODE_ENV isn't production.
import { Database, DEV_PASSWORD, listDevUsers } from "@lifestory/core";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { devRouteNotFound, devRoutesEnabled, escapeHtml as escape } from "~/lib/dev-routes";
import { serverRuntime } from "~/server/runtime";

export const Route = createFileRoute("/__dev/")({
  server: {
    handlers: {
      GET: async () => {
        if (!devRoutesEnabled()) return devRouteNotFound();
        const users = await serverRuntime().runPromise(
          Database.use(({ db }) => Effect.promise(() => listDevUsers(db))),
        );
        const rows = users
          .map(
            (u) =>
              `<li><a href="/__dev/log-me-in/${encodeURIComponent(u.email)}?returnTo=/">${escape(u.email)}</a> ${escape(u.name)} (${escape(u.role ?? "user")})</li>`,
          )
          .join("\n");
        const html = `<!doctype html>
<meta charset="utf-8">
<title>Lifestory dev endpoints</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:48rem;margin:2rem auto;padding:0 1rem}code{background:#f3f3f3;padding:0 .25rem}</style>
<h1>Dev endpoints</h1>
<ul>
<li><code>GET /__dev</code>: this page.</li>
<li><code>GET /__dev/log-me-in/&lt;email&gt;?returnTo=/path</code>: signs the browser in as that user, creating a non-admin user with a one-person family if the email is new.</li>
<li><code>GET /__dev/mailbox</code>: <a href="/__dev/mailbox">emails the app sent</a> (invitations, set-password links) since the web server started.</li>
<li><code>GET /__dev/log-me-out?returnTo=/path</code>: <a href="/__dev/log-me-out?returnTo=/__dev">signs the browser out</a>.</li>
</ul>
<h2>Sign in as</h2>
<ul>
${rows}
</ul>
<p>Any other email works too and creates the user. Password for every dev user: <code>${DEV_PASSWORD}</code>.</p>
`;
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
      },
    },
  },
});
