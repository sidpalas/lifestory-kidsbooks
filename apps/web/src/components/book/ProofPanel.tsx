// A book's PDF proofs: make one from the cast and text as they are now, watch it render, download it (D27), and
// approve one for print. The page passes how to list, request, and approve them.
import type { ProofSummary } from "@lifestory/core/contracts";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";

const formatBytes = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export interface ProofList {
  readonly canRequest: boolean;
  readonly proofs: ReadonlyArray<ProofSummary>;
}

export function ProofPanel({
  load,
  request: requestProof,
  approve,
  hydrated,
}: {
  /** Lists the proofs. Must be stable for the same subject (the panel reloads when it changes). */
  load: () => Promise<ProofList>;
  /** Starts one; rejects with a message for the parent. */
  request: () => Promise<void>;
  /** Approves a ready proof for print. */
  approve: (proofId: string) => Promise<void>;
  hydrated: boolean;
}) {
  const [state, setState] = useState<{ canRequest: boolean; proofs: ReadonlyArray<ProofSummary> } | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rendering = state?.proofs.some((proof) => proof.status === "rendering") ?? false;

  // Loads the list, and polls it while a proof renders (a book takes a few seconds).
  useEffect(() => {
    let cancelled = false;
    const fetchProofs = async () => {
      const next = await load();
      if (!cancelled) setState(next);
    };
    void fetchProofs();
    const timer = rendering ? setInterval(() => void fetchProofs(), 1000) : undefined;
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [load, rendering]);

  const approveProof = async (proofId: string) => {
    setApproving(proofId);
    setError(null);
    try {
      await approve(proofId);
      setState(await load());
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "The proof couldn't be approved.");
    } finally {
      setApproving(null);
    }
  };

  const request = async () => {
    setRequesting(true);
    setError(null);
    try {
      await requestProof();
      setState(await load());
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "The proof couldn't be started.");
    } finally {
      setRequesting(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-md border p-4" aria-label="PDF proofs" data-testid="proofs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium">Print proof</h2>
          <p className="text-muted-foreground text-sm">
            A print-ready PDF of the whole book with the characters as shown, with bleed. Download it and check every page, then
            approve it for print.
          </p>
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
            <li
              key={proof.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
              data-testid="proof"
              data-status={proof.status}
              data-approved={proof.approvedAt ? "true" : "false"}
            >
              <span className="flex flex-col">
                <span>
                  {proof.castNames.join(" & ")} · {new Date(proof.createdAt).toLocaleString()}
                  {proof.requestedBy && <span className="text-muted-foreground"> · by {proof.requestedBy}</span>}
                </span>
                {proof.approvedAt ? (
                  <span className="font-medium text-emerald-700" data-testid="proof-approval">
                    ✓ Approved for print by {proof.approvedBy ?? "a former member"} on {new Date(proof.approvedAt).toLocaleString()}
                  </span>
                ) : (
                  proof.expiresAt && (
                    <span className="text-muted-foreground text-xs">
                      Deleted on {new Date(proof.expiresAt).toLocaleDateString()} unless approved
                    </span>
                  )
                )}
              </span>
              {proof.status === "ready" ? (
                <span className="flex flex-wrap items-center gap-3">
                  <a className="font-medium underline" href={`/api/files/${proof.objectKey}`} download>
                    Download PDF ({proof.pageCount} pages, {formatBytes(proof.bytes ?? 0)})
                  </a>
                  {state.canRequest && !proof.approvedAt && (
                    <Button size="sm" variant="outline" onClick={() => void approveProof(proof.id)} disabled={!hydrated || approving !== null}>
                      {approving === proof.id ? "Approving…" : "Approve for print"}
                    </Button>
                  )}
                </span>
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
