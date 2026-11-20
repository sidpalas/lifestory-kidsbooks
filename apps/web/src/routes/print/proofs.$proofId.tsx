// The print page for one proof, opened only by the worker's headless Chromium with a print token (D27). It draws
// every page with the same BookPage as the editor, one page per sheet, at trim plus bleed, and Chromium prints it
// with the page's own CSS page size.
import { NotFound, storyAssetKey, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Schema } from "effect";

import { BookPage, pageSizeIn, StoryFonts } from "~/components/book/BookPage";
import { getPrintableProofFn, PrintableProofResult } from "~/server/functions";

export const Route = createFileRoute("/print/proofs/$proofId")({
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ token: Schema.optional(Schema.String) })),
  loaderDeps: ({ search }) => ({ token: search.token ?? "" }),
  loader: async ({ params, deps }) => {
    try {
      return unwrapResult(PrintableProofResult)(
        await getPrintableProofFn({ data: { proofId: params.proofId, token: deps.token } }),
      );
    } catch (error) {
      if (error instanceof NotFound) throw notFound();
      throw error;
    }
  },
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: PrintProof,
});

function PrintProof() {
  const { storyId, version, manifest, cast, pages } = Route.useLoaderData();
  const { widthIn, heightIn } = pageSizeIn(manifest.trim);
  return (
    <>
      <style>{`@page { size: ${widthIn}in ${heightIn}in; margin: 0; } html, body { margin: 0; padding: 0; }`}</style>
      <StoryFonts fonts={manifest.fonts} assetUrl={(asset) => `/api/files/${storyAssetKey(storyId, version, asset)}`} />
      {manifest.pages.map((page, i) => (
        <div key={page.pageId} style={{ breakAfter: "page" }}>
          <BookPage
            manifest={manifest}
            page={page}
            text={pages[i]!.text}
            illustration={pages[i]!.layers.map((layer) => ({ url: `/api/files/${layer.key}`, rect: layer.rect }))}
            cast={cast}
          />
        </div>
      ))}
    </>
  );
}
