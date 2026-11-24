// The policies (D58): terms, privacy and child safety, written for adults and versioned with POLICY_VERSION. Linked
// from the landing page's footer, the photo step and the order step. Public: no sign-in needed to read them.
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { marked } from "marked";

import { PolicyLinks } from "~/components/policy-links";
import childSafety from "~/policies/child-safety.md?raw";
import privacy from "~/policies/privacy.md?raw";
import terms from "~/policies/terms.md?raw";

const policies: Record<string, string> = { terms, privacy, "child-safety": childSafety };

export const Route = createFileRoute("/policies/$policy")({
  loader: ({ params }) => {
    const text = policies[params.policy];
    if (!text) throw notFound();
    // Our own files from the repository, never user input, so their HTML is safe to put on the page.
    return { html: marked.parse(text, { async: false }) };
  },
  component: function Policy() {
    const { html } = Route.useLoaderData();
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-3 p-8 text-sm leading-relaxed">
        <Link to="/" className="text-muted-foreground hover:underline">
          ← Lifestory
        </Link>
        <article
          className="flex flex-col gap-3 [&_a]:underline [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:mt-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_ul_ul]:list-[circle]"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <PolicyLinks />
      </main>
    );
  },
});
