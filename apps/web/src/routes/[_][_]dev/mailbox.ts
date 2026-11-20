// Development-only mailbox: GET /__dev/mailbox lists the emails this web server sent
// (invitations, set-password links), newest first. Returns 404 unless DEV_LOGIN_ENABLED=true
// and NODE_ENV isn't production.
import { Mailer } from "@lifestory/core";
import { createFileRoute } from "@tanstack/react-router";

import { devRouteNotFound, devRoutesEnabled, escapeHtml } from "~/lib/dev-routes";
import { serverRuntime } from "~/server/runtime";

export const Route = createFileRoute("/__dev/mailbox")({
  server: {
    handlers: {
      GET: async () => {
        if (!devRoutesEnabled()) return devRouteNotFound();
        const emails = await serverRuntime().runPromise(Mailer.use((mailer) => mailer.outbox));
        const rows = emails
          .map(
            (email) => `<article data-to="${escapeHtml(email.to)}">
<p><strong>To:</strong> ${escapeHtml(email.to)} <small>${email.sentAt.toISOString()}</small><br><strong>${escapeHtml(email.subject)}</strong></p>
<p>${escapeHtml(email.text)}<br><a href="${escapeHtml(email.link)}">${escapeHtml(email.link)}</a></p>
</article>`,
          )
          .join("\n");
        const html = `<!doctype html>
<meta charset="utf-8">
<title>Lifestory dev mailbox</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:48rem;margin:2rem auto;padding:0 1rem}article{border-top:1px solid #ddd;padding:.5rem 0}</style>
<h1>Dev mailbox</h1>
<p>Emails this web server sent since it started, newest first. <a href="/__dev">Dev endpoints</a></p>
${rows || "<p>No emails yet.</p>"}
`;
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
      },
    },
  },
});
