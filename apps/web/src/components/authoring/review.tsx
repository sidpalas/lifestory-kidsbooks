import {
  type DraftView,
  type Look,
  type Part,
  type PartRequest,
  type StoryDraft,
  type StoryPart,
  exampleCast,
  lookVocabulary,
  resolvePageText,
  sameAppearance,
  unwrapResult,
} from "@lifestory/core/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { BookPage, ScaledPage } from "~/components/book/BookPage";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { NativeSelect } from "~/components/ui/native-select";
import {
  DraftPartPlanResult,
  DraftPartResult,
  DraftPartsRequestResult,
  PreviewDraftResult,
  UploadReviewResult,
  draftPartPlanFn,
  draftUploadReviewFn,
  previewDraftFn,
  requestDraftPartsFn,
  reviewDraftPartFn,
} from "~/server/authoring";

import { type DraftFiles, message } from "./fields";

type Request = Omit<PartRequest, "storyVersionId">;
type Candidate = {
  id: string;
  pageId: string;
  slotId: string;
  part: Part;
  generated?: StoryPart;
  uploaded: ReadonlyArray<Part>;
  previous?: StoryPart;
};
const appearanceKey = (
  pageId: string,
  slotId: string,
  part: Pick<Part, "age" | "face" | "features" | "axis" | "option">,
) => JSON.stringify([pageId, slotId, part.age, part.face, part.features ?? "features:defined", part.axis, part.option]);
const optionLabel = (option: string) =>
  Object.values(lookVocabulary)
    .flat()
    .find((o) => o.id === option)?.label ?? option;

export function ReviewTab({
  files,
  draft,
  parts,
  dirty,
  refresh,
  persist,
}: {
  files: DraftFiles;
  draft: StoryDraft;
  parts: ReadonlyArray<StoryPart>;
  dirty: boolean;
  refresh: () => Promise<DraftView>;
  persist: (draft: StoryDraft) => Promise<boolean>;
}) {
  const [sheet, setSheet] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const [plan, setPlan] = useState<{
    requests: ReadonlyArray<Request>;
    blocked: ReadonlyArray<string>;
    estimateUsd: number;
  } | null>(null);
  const [context, setContext] = useState<string | null>(null);
  // Parts queued from this tab since the last dismiss: the progress total, so it does not shrink as parts finish.
  const [round, setRound] = useState(0);
  const working = parts.filter((p) => p.status === "generating").length;
  const [contextReady, setContextReady] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (context && !dialog.current?.open) dialog.current?.showModal();
  }, [context]);
  const candidates: Candidate[] = [];
  const generatedAssets = new Set(parts.flatMap((p) => p.layers.map((l) => l.asset)));
  const latest = new Map<string, StoryPart>();
  for (const p of parts.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)))
    latest.set(appearanceKey(p.pageId, p.slotId, { ...p, features: p.features ?? undefined }), p);
  for (const page of draft.pages)
    for (const figure of page.illustration.layers) {
      if (figure.kind !== "figure") continue;
      const uploads = new Map<string, Part[]>();
      for (const p of figure.parts)
        if (!generatedAssets.has(p.asset)) {
          const key = appearanceKey(page.pageId, figure.slotId, p);
          uploads.set(key, [...(uploads.get(key) ?? []), p]);
        }
      for (const [key, uploaded] of uploads)
        if (!latest.has(key))
          candidates.push({
            id: `upload:${key}:${uploaded.map((p) => p.asset).join()}`,
            pageId: page.pageId,
            slotId: figure.slotId,
            part: uploaded[0]!,
            uploaded,
          });
      for (const p of latest.values())
        if (p.pageId === page.pageId && p.slotId === figure.slotId) {
          const previous = parts
            .filter(
              (older) =>
                older.id !== p.id &&
                appearanceKey(older.pageId, older.slotId, { ...older, features: older.features ?? undefined }) ===
                  appearanceKey(p.pageId, p.slotId, { ...p, features: p.features ?? undefined }),
            )
            .at(-1);
          candidates.push({
            id: p.id,
            pageId: p.pageId,
            slotId: p.slotId,
            part: {
              age: p.age,
              face: p.face,
              ...(p.features ? { features: p.features } : {}),
              axis: p.axis,
              option: p.option,
              asset: p.layers[0]?.asset ?? "",
              at: p.layers[0]?.at ?? [0, 0, 1000, 1000],
              palette: "none",
              approved: p.status === "approved",
            },
            generated: p,
            uploaded: [],
            ...(previous ? { previous } : {}),
          });
        }
    }
  const sheets = [...new Set(candidates.map((c) => c.part.option))];
  const option = sheets.includes(sheet) ? sheet : sheets[0];
  const visible = candidates.filter((c) => c.part.option === option);
  const reviewable = (c: Candidate) =>
    c.generated ? c.generated.status === "pending_review" : c.uploaded.some((p) => !p.approved);
  const approvable = visible.filter((c) => seen.has(c.id) && reviewable(c));
  const flagged = visible.filter((c) => c.generated?.status === "rejected");
  const markSeen = useCallback((id: string) => setSeen((old) => (old.has(id) ? old : new Set([...old, id]))), []);
  const action = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const approve = async (selected: ReadonlyArray<Candidate>) => {
    const uploaded = new Set(selected.flatMap((c) => c.uploaded.map((p) => p.asset)));
    if (
      uploaded.size &&
      !(await persist({
        ...draft,
        pages: draft.pages.map((p) => ({
          ...p,
          illustration: {
            layers: p.illustration.layers.map((f) =>
              f.kind === "figure"
                ? {
                    ...f,
                    parts: f.parts.map((part) => (uploaded.has(part.asset) ? { ...part, approved: true } : part)),
                  }
                : f,
            ),
          },
        })),
      }))
    )
      return;
    for (const c of selected)
      if (c.generated)
        unwrapResult(DraftPartResult)(
          await reviewDraftPartFn({ data: { storyId: files.storyId, partId: c.id, decision: "approve" } }),
        );
    await refresh();
  };
  const generate = async (requests: ReadonlyArray<Request>) => {
    // Small, explicit rounds: never queue a whole book's spend from one click.
    unwrapResult(DraftPartsRequestResult)(
      await requestDraftPartsFn({ data: { storyId: files.storyId, requests: requests.slice(0, 40) } }),
    );
    setPlan(null);
    await refresh();
    setRound((old) => old + Math.min(40, requests.length));
  };
  const flag = async (candidate: Candidate, reason: string) => {
    unwrapResult(DraftPartResult)(
      await reviewDraftPartFn({ data: { storyId: files.storyId, partId: candidate.id, decision: "reject", reason } }),
    );
    await refresh();
  };
  useEffect(() => {
    if (!parts.some((p) => p.status === "generating")) return;
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [parts, refresh]);
  const selected = candidates.find((c) => c.id === context);
  const redoRequests = flagged.map((c): Request => {
    const p = c.generated!;
    return {
      pageId: p.pageId,
      slotId: p.slotId,
      age: p.age,
      face: p.face,
      ...(p.features ? { features: p.features } : {}),
      axis: p.axis,
      option: p.option,
      zone: p.zone,
      seed: p.seed + 1,
      note: p.reviewReason ?? p.note ?? "Correct the flagged option, preserving the base.",
    };
  });
  return (
    <section aria-label="Option review" className="flex min-w-0 flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">Review one option across the book</h2>
        <p className="text-sm text-muted-foreground">
          Compare pages and bases on both skin extremes. Flag a bad take, then redo it with your reason. Only an
          explicit approval accepts artwork.
        </p>
      </div>
      {dirty && <p className="text-sm">Save your changes before generating or reviewing.</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || dirty}
          onClick={() =>
            void action(async () =>
              setPlan(unwrapResult(DraftPartPlanResult)(await draftPartPlanFn({ data: { storyId: files.storyId } }))),
            )
          }
        >
          Plan missing parts
        </Button>
        <label className="text-sm">
          Option
          <NativeSelect aria-label="Review option" value={option ?? ""} onChange={(e) => setSheet(e.target.value)}>
            {sheets.map((o) => (
              <option key={o} value={o}>
                {optionLabel(o)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <span className="text-sm text-muted-foreground">
          {visible.length} candidates · {flagged.length} flagged
        </span>
      </div>
      {(() => {
        const failed = parts.filter((p) => p.status === "failed").length;
        if (!working && !round) return null;
        const total = Math.max(round, working);
        const done = total - working;
        return (
          <div
            className="flex flex-col gap-2 rounded border p-3 text-sm"
            role="status"
            data-testid="generation-progress"
          >
            <p>
              {working
                ? `Drawing parts in the background: ${done} of ${total} done. New takes appear on their option's sheet as they finish.`
                : `Round finished: ${total} parts drawn${failed ? `, ${failed} failed in total` : ""}. Review them on their sheets.`}
            </p>
            <progress className="h-2 w-full" max={total} value={done} aria-label="Generation progress" />
            {!working && (
              <Button size="sm" variant="ghost" className="self-start" onClick={() => setRound(0)}>
                Dismiss
              </Button>
            )}
          </div>
        );
      })()}
      {plan && (
        <div className="rounded border p-3 text-sm" data-testid="part-plan">
          <p>
            {plan.requests.length} missing parts. Next round: {Math.min(40, plan.requests.length)} parts, at most ~US$
            {(Math.min(40, plan.requests.length) * 0.049).toFixed(2)} before tiling savings. No automatic paid retries.
          </p>
          {plan.blocked.map((b) => (
            <p key={b}>{b}</p>
          ))}
          <Button
            size="sm"
            disabled={busy || dirty || !plan.requests.length}
            onClick={() => void action(() => generate(plan.requests))}
          >
            Generate next round
          </Button>
        </div>
      )}
      <div className="sticky top-14 z-10 flex flex-wrap gap-2 border bg-background p-2">
        <Button
          size="sm"
          disabled={busy || dirty || !approvable.length}
          onClick={() => void action(() => approve(approvable))}
        >
          Approve {approvable.length} reviewed, unflagged candidates
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || dirty || !flagged.length}
          onClick={() => void action(() => generate(redoRequests))}
        >
          Redo {Math.min(40, flagged.length)} flagged · at most ~US${(Math.min(40, flagged.length) * 0.049).toFixed(2)}
        </Button>
      </div>
      {!candidates.length && (
        <p className="text-sm text-muted-foreground">
          Approve extracted bases in Casting, or import them in Pages, then plan missing parts.
        </p>
      )}
      <div className={`grid gap-4 ${visible.length === 1 ? "max-w-2xl" : "md:grid-cols-2 xl:grid-cols-3"}`}>
        {visible.map((c) => (
          <ReviewTile
            key={c.id}
            candidate={c}
            files={files}
            label={`${c.pageId} · ${draft.characterSlots.find((r) => r.slotId === c.slotId)?.label ?? c.slotId} · ${c.part.age} · ${c.part.face.replace("face:", "")} · ${c.part.features?.replace("features:", "") ?? "defined"}`}
            disabled={busy || dirty}
            onSeen={markSeen}
            onContext={() => setContext(c.id)}
            onApprove={() => void action(() => approve([c]))}
            onFlag={(reason) => void action(() => flag(c, reason))}
          />
        ))}
      </div>
      {selected && (
        <dialog
          ref={dialog}
          aria-label="Review on the page"
          onCancel={() => setContext(null)}
          className="fixed inset-0 z-50 m-0 h-dvh max-h-none w-screen max-w-none overflow-auto bg-background p-5"
        >
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  dialog.current?.close();
                  setContext(null);
                }}
              >
                Back to sheet
              </Button>
              <Button
                disabled={busy || dirty || contextReady !== selected.id || !reviewable(selected)}
                onClick={() => void action(() => approve([selected]))}
              >
                Approve this candidate
              </Button>
            </div>
            <label className="text-sm">
              Cycle alternatives
              <NativeSelect
                aria-label="Page review candidate"
                value={selected.id}
                onChange={(e) => setContext(e.target.value)}
              >
                {candidates
                  .filter(
                    (c) =>
                      c.pageId === selected.pageId &&
                      c.slotId === selected.slotId &&
                      sameAppearance(
                        c.part,
                        selected.part.age,
                        selected.part.face,
                        selected.part.features ?? "features:defined",
                      ),
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {optionLabel(c.part.option)} ·{" "}
                      {c.generated?.status ?? (c.part.approved ? "approved" : "uploaded")}
                    </option>
                  ))}
              </NativeSelect>
            </label>
            {selected.generated && (
              <form
                key={`flag:${selected.id}`}
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
                  if (reason) void action(() => flag(selected, reason));
                }}
              >
                <Input
                  name="reason"
                  aria-label="Page flag reason"
                  required
                  maxLength={500}
                  defaultValue={selected.generated.reviewReason ?? ""}
                  placeholder="What's wrong in this scene?"
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={
                    busy || dirty || !["pending_review", "approved", "rejected"].includes(selected.generated.status)
                  }
                >
                  Flag this candidate
                </Button>
              </form>
            )}
            <PageContext
              key={selected.id}
              files={files}
              draft={draft}
              candidate={selected}
              onReady={() => setContextReady(selected.id)}
            />
          </div>
        </dialog>
      )}
    </section>
  );
}

function ReviewTile({
  candidate: c,
  files,
  label,
  disabled,
  onSeen,
  onContext,
  onApprove,
  onFlag,
}: {
  candidate: Candidate;
  files: DraftFiles;
  label: string;
  disabled: boolean;
  onSeen: (id: string) => void;
  onContext: () => void;
  onApprove: () => void;
  onFlag: (reason: string) => void;
}) {
  const [uploadedImages, setUploadedImages] = useState<{ light: string | null; dark: string | null }>({
    light: null,
    dark: null,
  });
  const images = c.generated?.files ?? uploadedImages;
  const generatedId = c.generated?.id;
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState(c.generated?.reviewReason ?? "");
  const [enlarged, setEnlarged] = useState(false);
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (generatedId) return;
    let active = true;
    let started = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || started) return;
        started = true;
        void draftUploadReviewFn({
          data: { storyId: files.storyId, pageId: c.pageId, slotId: c.slotId, asset: c.part.asset },
        })
          .then((r) => {
            if (active) setUploadedImages(unwrapResult(UploadReviewResult)(r));
          })
          .catch((e) => {
            if (active) setError(message(e));
          });
      },
      { rootMargin: "300px" },
    );
    if (root.current) observer.observe(root.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [generatedId, c.pageId, c.slotId, c.part.asset, files.storyId]);
  useEffect(() => {
    if (loaded.size < 2 || error || !root.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onSeen(c.id);
      },
      { threshold: 0.6 },
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [loaded, error, c.id, onSeen]);
  const status = c.generated?.status ?? (c.part.approved ? "approved" : "pending_review");
  return (
    <article
      ref={root}
      className={`flex min-w-0 flex-col gap-3 rounded-lg border p-3 ${status === "rejected" ? "border-destructive" : ""}`}
      data-testid="review-candidate"
      data-status={status}
    >
      <h3 className="text-sm font-semibold">{label}</h3>
      <p className="text-xs text-muted-foreground">
        {status.replaceAll("_", " ")}
        {c.previous?.reviewReason ? ` · Previous flag: ${c.previous.reviewReason}` : ""}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {(["light", "dark"] as const).map((side) => (
          <figure key={side}>
            <div className="h-56 overflow-hidden rounded border bg-white">
              {images[side] ? (
                <img
                  src={`/api/files/${images[side]}`}
                  alt={`${label} on ${side} skin`}
                  className="h-56 w-full object-contain"
                  style={{ transform: enlarged ? "scale(1.8)" : "none", transformOrigin: "50% 0%" }}
                  loading="lazy"
                  onLoad={() => setLoaded((old) => new Set([...old, side]))}
                  onError={() => setError("A review image couldn't load; don't approve this candidate.")}
                />
              ) : (
                <div className="h-56 bg-muted" />
              )}
            </div>
            <figcaption className="text-xs">{side} skin</figcaption>
          </figure>
        ))}
      </div>
      <Button size="sm" variant="ghost" className="self-start" onClick={() => setEnlarged((value) => !value)}>
        {enlarged ? "Show whole figure" : "Zoom to head"}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {c.generated?.error && <p className="text-xs text-destructive">{c.generated.error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={!images.light || !images.dark || !!error} onClick={onContext}>
          On the page
        </Button>
        <Button
          size="sm"
          disabled={disabled || loaded.size < 2 || !!error || status !== "pending_review"}
          onClick={onApprove}
        >
          Approve candidate
        </Button>
      </div>
      {c.generated && (
        <div className="flex flex-col gap-2">
          <Input
            aria-label={`Flag reason for ${label}`}
            placeholder="What's wrong? Clipped, halo, wrong style…"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || !reason.trim() || !["pending_review", "approved", "rejected"].includes(status)}
            onClick={() => onFlag(reason.trim())}
          >
            Flag for redo
          </Button>
        </div>
      )}
      {!c.generated && (
        <p className="text-xs text-muted-foreground">To replace an uploaded drawing, use its controls in Pages.</p>
      )}
      {c.previous?.files.light && (
        <details>
          <summary className="text-xs">Previous take</summary>
          <img
            src={`/api/files/${c.previous.files.light}`}
            alt="Previous take on light skin"
            className="h-44 object-contain"
          />
        </details>
      )}
    </article>
  );
}

function PageContext({
  files,
  draft,
  candidate: c,
  onReady,
}: {
  files: DraftFiles;
  draft: StoryDraft;
  candidate: Candidate;
  onReady: () => void;
}) {
  const [layers, setLayers] = useState<DraftView["pages"][number]["layers"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element || !layers) return;
    const ready = () => {
      const images = [...element.querySelectorAll("img")];
      if (images.length && images.every((i) => i.complete && i.naturalWidth > 0)) onReady();
    };
    element.addEventListener("load", ready, true);
    ready();
    return () => element.removeEventListener("load", ready, true);
  }, [layers, onReady]);
  const page = draft.pages.find((p) => p.pageId === c.pageId)!;
  const cast = exampleCast(draft);
  const original = cast[c.slotId]!.look;
  const look: Look = {
    ...original,
    age: c.part.age,
    face: c.part.face,
    features: c.part.features ?? "features:defined",
    [c.part.axis]: c.part.option,
  };
  const lookKey = JSON.stringify(look);
  const candidateId = c.generated?.id;
  useEffect(() => {
    let active = true;
    void previewDraftFn({
      data: {
        storyId: files.storyId,
        draft,
        looks: { [c.slotId]: JSON.parse(lookKey) },
        ...(candidateId ? { candidateId } : {}),
      },
    })
      .then((r) => {
        if (active) setLayers(unwrapResult(PreviewDraftResult)(r).find((p) => p.pageId === c.pageId)?.layers ?? []);
      })
      .catch((e) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [candidateId, files.storyId, draft, lookKey, c.slotId, c.pageId]);
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {layers ? (
        <div ref={root} className="max-w-full overflow-auto">
          <ScaledPage trim={draft.trim} scale={0.7}>
            <BookPage
              manifest={draft}
              page={page}
              text={resolvePageText(page, cast)}
              cast={{ ...cast, [c.slotId]: { ...cast[c.slotId]!, look } }}
              illustration={layers.map((l) => ({ url: `/api/files/${l.key}`, rect: l.rect }))}
            />
          </ScaledPage>
        </div>
      ) : (
        <p role="status">Composing this candidate on the page…</p>
      )}
    </>
  );
}
