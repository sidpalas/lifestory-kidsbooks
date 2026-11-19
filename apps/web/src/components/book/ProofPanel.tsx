// The family's PDF proofs of a story: make one from the cast shown, watch it render, download it (D27).
import { type Look, type ProofSummary, UnsupportedLook, unwrapResult } from "@lifestory/core/contracts";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { listStoryProofsFn, RequestProofResult, requestStoryProofFn, StoryProofsResult } from "~/server/functions";

const formatBytes = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

const fetchProofsOf = async (slug: string) => unwrapResult(StoryProofsResult)(await listStoryProofsFn({ data: { slug } }));

export function ProofPanel({ slug, looks, hydrated }: { slug: string; looks: Readonly<Record<string, Look>>; hydrated: boolean }) {
  const [state, setState] = useState<{ canRequest: boolean; proofs: ReadonlyArray<ProofSummary> } | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rendering = state?.proofs.some((proof) => proof.status === "rendering") ?? false;

  // Loads the list, and polls it while a proof renders (a book takes a few seconds).
  useEffect(() => {
    let cancelled = false;
    const fetchProofs = async () => {
      const next = await fetchProofsOf(slug);
      if (!cancelled) setState(next);
    };
    void fetchProofs();
    const timer = rendering ? setInterval(() => void fetchProofs(), 1000) : undefined;
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [slug, rendering]);

  const request = async () => {
    setRequesting(true);
    setError(null);
    try {
      unwrapResult(RequestProofResult)(await requestStoryProofFn({ data: { slug, looks: { ...looks } } }));
      setState(await fetchProofsOf(slug));
    } catch (cause) {
      setError(cause instanceof UnsupportedLook ? "This story can't draw one of the chosen looks." : "The proof couldn't be started.");
    } finally {
      setRequesting(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-md border p-4" aria-label="PDF proofs" data-testid="proofs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium">Print proof</h2>
          <p className="text-muted-foreground text-sm">A print-ready PDF of the whole book with the characters as shown, with bleed.</p>
        </div>
        {state?.canRequest && (
          <Button onClick={() => void request()} disabled={!hydrated || requesting}>
            {requesting ? "Starting…" : "Make a PDF proof"}
          </Button>
        )}
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      {state && state.proofs.length === 0 && <p className="text-muted-foreground text-sm">No proofs yet.</p>}
      {state && state.proofs.length > 0 && (
        <ul className="flex flex-col divide-y text-sm">
          {state.proofs.map((proof) => (
            <li key={proof.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="proof" data-status={proof.status}>
              <span>
                {proof.castNames.join(" & ")} · {new Date(proof.createdAt).toLocaleString()}
                {proof.requestedBy && <span className="text-muted-foreground"> · by {proof.requestedBy}</span>}
              </span>
              {proof.status === "ready" ? (
                <a className="font-medium underline" href={`/api/files/${proof.objectKey}`} download>
                  Download PDF ({proof.pageCount} pages, {formatBytes(proof.bytes ?? 0)})
                </a>
              ) : proof.status === "rendering" ? (
                <span className="text-muted-foreground">Rendering…</span>
              ) : (
                <span className="text-destructive">Failed</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
