import {
  type Age,
  ageOptions,
  applyImport,
  type Casting,
  type CastingPage,
  type CastFigure,
  type CharacterSlot,
  faceOptions,
  hairOptions,
  type Rect,
  type StoryDraft,
  unwrapResult,
} from "@lifestory/core/contracts";
import { useEffect, useRef, useState, type PointerEvent } from "react";

import { Button } from "~/components/ui/button";
import { FileInput } from "~/components/ui/file-input";
import { Input } from "~/components/ui/input";
import { NativeSelect } from "~/components/ui/native-select";
import { ArtImportStartResult, castingStatusFn, CastingStatusResult, requestCastingFn } from "~/server/authoring";

import { type DraftFiles, draftFileUrl, message, RectFields, uploadDraftFile } from "./fields";

const without = <T,>(record: Readonly<Record<string, T>>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

/** A running suggestion or extraction; the elapsed time counts from `started`. */
const startJob = (mode: "detect" | "extract") => ({ mode, started: Date.now() });
type Job = ReturnType<typeof startJob>;
type Saved = { local: Casting; draft: StoryDraft };

/** Source art and casting are saved separately from the book format, with the draft's revision check. */
export function CastingTab({
  files,
  draft,
  casting: local,
  onChange: setLocal,
  persist,
}: {
  files: DraftFiles;
  draft: StoryDraft;
  casting: Casting;
  onChange: (casting: Casting) => void;
  persist: (draft: StoryDraft, casting: Casting) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Outcomes of each page's suggest/extract, shown beside that page's buttons rather than at the top of the tab.
  const [notes, setNotes] = useState<Readonly<Record<string, { text: string; error: boolean }>>>({});
  const setNote = (pageId: string, note: { text: string; error: boolean } | null) =>
    setNotes((old) => (note ? { ...without(old, pageId), [pageId]: note } : without(old, pageId)));
  // Running suggestions and extractions, one per page at most. Only those pages lock; the rest stays editable.
  const [jobs, setJobs] = useState<Readonly<Record<string, Job>>>({});
  const running = Object.keys(jobs).length > 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  // Edits made elsewhere while a job runs must survive its result, so the result merges into the latest state.
  const latest = useRef({ local, draft });
  useEffect(() => {
    latest.current = { local, draft };
  }, [local, draft]);
  // Every save from this tab goes through one queue and applies its change to the latest state, so several jobs
  // finishing together (and edits made meanwhile) save one after another instead of failing the revision check.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const save = (change: (saved: Saved) => Saved) => {
    const done = queue.current.then(() => {
      const next = change(latest.current);
      latest.current = next;
      setLocal(next.local);
      return persist(next.draft, next.local);
    });
    queue.current = done.catch(() => false);
    return done;
  };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const edit = (pageId: string, update: (p: CastingPage) => CastingPage) =>
    setLocal(local.map((p) => (p.pageId === pageId ? update(p) : p)));
  // Moves a source picture one place earlier or later, and its book page with it. Book pages without a source
  // picture keep their positions; the cast pages swap among the slots they already occupy.
  const reorder = (index: number, by: -1 | 1) => {
    const next = [...local];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved!);
    const cast = new Set(next.map((p) => p.pageId));
    const order = next.map((c) => draft.pages.find((p) => p.pageId === c.pageId)).filter((p) => p !== undefined);
    let i = 0;
    const pages = draft.pages.map((p) => (cast.has(p.pageId) ? (order[i++] ?? p) : p));
    void save(() => ({ local: next, draft: { ...draft, pages } }));
  };
  const run = async (pageId: string, mode: "detect" | "extract") => {
    setError(null);
    setNote(pageId, null);
    setJobs((old) => ({ ...old, [pageId]: startJob(mode) }));
    try {
      if (!(await save((saved) => saved))) return;
      const { taskId } = unwrapResult(ArtImportStartResult)(
        await requestCastingFn({ data: { storyId: files.storyId, pageId, mode, requestId: crypto.randomUUID() } }),
      );
      const field = mode === "detect" ? "detectionTaskId" : "extractionTaskId";
      const started = await save((saved) => ({
        ...saved,
        local: saved.local.map((p) => (p.pageId === pageId ? { ...p, [field]: taskId } : p)),
      }));
      if (!started) return;
      await follow(pageId, taskId, mode);
    } catch (cause) {
      setNote(pageId, { text: message(cause), error: true });
    } finally {
      setJobs((old) => without(old, pageId));
    }
  };
  const follow = async (pageId: string, taskId: string, mode: "detect" | "extract") => {
    for (let i = 0; i < 600; i++) {
      if (!mounted.current) return;
      const result = unwrapResult(CastingStatusResult)(
        await castingStatusFn({ data: { storyId: files.storyId, taskId } }),
      );
      if (!mounted.current) return;
      if (result.state === "failed") throw new Error(result.error ?? "Couldn't finish. Correct the casting or retry.");
      if (result.state === "done" && result.outcome) {
        const outcome = result.outcome;
        await save((saved) => ({
          ...saved,
          local: saved.local.map((p) =>
            p.pageId !== pageId
              ? p
              : {
                  ...p,
                  detectionTaskId: null,
                  extractionTaskId: null,
                  ...(mode === "detect"
                    ? { figures: outcome.figures, approved: false, applied: false, results: [] }
                    : { results: outcome.results }),
                },
          ),
        }));
        setNote(pageId, {
          error: false,
          text:
            mode === "detect"
              ? `Suggested by ${outcome.provider}. Check every figure and head box before approving.`
              : "Extraction finished: review it below before accepting the bases.",
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("Still running. Use Resume after returning to this draft.");
  };
  const upload = async (input: HTMLInputElement) => {
    const chosen = [...(input.files ?? [])];
    input.value = "";
    if (!chosen.length) return;
    setBusy(true);
    setError(null);
    try {
      let pages = [...draft.pages];
      const next = [...local];
      for (const file of chosen) {
        let index = pages.findIndex((p) => !next.some((c) => c.pageId === p.pageId));
        if (index === -1) {
          let n = pages.length + 1;
          while (pages.some((p) => p.pageId === `p${n}`)) n++;
          pages.push({ pageId: `p${n}`, layout: "full-bleed-art/text-bottom", text: [], illustration: { layers: [] } });
          index = pages.length - 1;
        }
        const pageId = pages[index]!.pageId;
        const asset = await uploadDraftFile(files.storyId, `pages/${pageId}/casting`, file);
        next.push({
          pageId,
          asset,
          name: file.name,
          figures: [],
          approved: false,
          applied: false,
          results: [],
          detectionTaskId: null,
          extractionTaskId: null,
        });
      }
      await save(() => ({ local: next, draft: { ...draft, pages } }));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="flex flex-col gap-5" aria-label="Casting">
      <div>
        <h2 className="text-xl font-semibold">Cast the book first</h2>
        <p className="text-sm text-muted-foreground">
          Upload page pictures in reading order. Review who appears and where, then approve casting before extraction.
          Layered PSDs still use the manual import in Pages.
        </p>
      </div>
      <FileInput
        label="Book page pictures"
        multiple
        accept="image/png,image/jpeg,image/webp"
        disabled={busy}
        onChange={(e) => void upload(e.currentTarget)}
      />
      {draft.characterSlots.length === 0 && (
        <p className="text-sm">Add the story's roles in Roles before asking for suggestions.</p>
      )}
      {(() => {
        // Pages never suggested: suggesting again would replace corrections, so those stay a per-page action.
        const fresh = local.filter((p) => !p.figures.length && !jobs[p.pageId] && !p.detectionTaskId);
        return (
          fresh.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              disabled={busy || !draft.characterSlots.length}
              onClick={() => void Promise.all(fresh.map((p) => run(p.pageId, "detect")))}
            >
              Suggest characters on {fresh.length} new {fresh.length === 1 ? "page" : "pages"} · a few cents each
            </Button>
          )
        );
      })()}
      <p className="text-xs text-muted-foreground">
        Development defaults to labelled sample boxes, not image analysis. Real suggestions require
        CASTING_PROVIDER=openai; image extraction uses IMAGE_PROVIDER.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <fieldset disabled={busy} className="flex min-w-0 flex-col gap-6">
        {local.map((page, index) => (
          <article
            key={page.pageId}
            className="rounded-lg border p-4"
            data-testid="cast-page"
            aria-busy={!!jobs[page.pageId]}
          >
            {jobs[page.pageId] && (
              <div
                role="status"
                className="mb-3 flex flex-col gap-2 rounded border bg-muted/40 p-3 text-sm"
                data-testid="cast-job"
              >
                <p>
                  {jobs[page.pageId]!.mode === "detect"
                    ? "Finding characters on this page"
                    : "Removing the cast and separating each character"}{" "}
                  · {Math.max(0, Math.round((now - jobs[page.pageId]!.started) / 1000))} s
                  <span className="text-muted-foreground">
                    {jobs[page.pageId]!.mode === "detect"
                      ? " (usually under a minute)."
                      : " (several image edits; can take a few minutes)."}{" "}
                    It runs in the background: this page is locked until it finishes, and you can keep working on other
                    pages or leave and Resume later.
                  </span>
                </p>
                <progress
                  className="h-2 w-full"
                  aria-label={jobs[page.pageId]!.mode === "detect" ? "Finding characters" : "Extracting characters"}
                />
              </div>
            )}
            <fieldset disabled={!!jobs[page.pageId]} className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">
                  {page.pageId} · {page.name}
                </h3>
                <span className="text-sm text-muted-foreground">
                  {page.applied ? "Extraction approved" : page.approved ? "Casting approved" : "Casting needs review"}
                </span>
              </div>
              <CastPageEditor
                page={page}
                roles={draft.characterSlots}
                src={draftFileUrl(files.storyId, files.version, page.asset)}
                onChange={(next) =>
                  edit(page.pageId, () => ({
                    ...next,
                    approved: false,
                    applied: false,
                    results: [],
                    detectionTaskId: null,
                    extractionTaskId: null,
                  }))
                }
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!jobs[page.pageId] || !draft.characterSlots.length}
                  onClick={() => void run(page.pageId, "detect")}
                >
                  Suggest characters
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    edit(page.pageId, (p) => ({
                      ...p,
                      approved: false,
                      applied: false,
                      results: [],
                      figures: [
                        ...p.figures,
                        {
                          id: crypto.randomUUID(),
                          slotId: draft.characterSlots[0]?.slotId ?? "",
                          age: draft.characterSlots[0]?.ages[0] ?? "young-child",
                          face: "face:round",
                          hair: "hair:short",
                          description: "",
                          box: [250, 100, 750, 950],
                          head: [250, 100, 750, 400],
                          ignored: false,
                        },
                      ],
                    }))
                  }
                >
                  Add a missed character
                </Button>
                <Button
                  size="sm"
                  disabled={!page.figures.some((f) => !f.ignored) || page.approved}
                  onClick={() => {
                    // Casting saved before head boxes were kept inside their figures may still have one outside; pull it in.
                    void save((saved) => ({
                      ...saved,
                      local: saved.local.map((p) =>
                        p.pageId === page.pageId
                          ? {
                              ...p,
                              approved: true,
                              figures: p.figures.map((f) => ({ ...f, head: inside(f.head, f.box) })),
                            }
                          : p,
                      ),
                    }));
                  }}
                >
                  Approve casting
                </Button>
                <Button
                  size="sm"
                  disabled={!!jobs[page.pageId] || !page.approved || page.applied}
                  onClick={() => void run(page.pageId, "extract")}
                >
                  Extract characters · ~US$
                  {((1 + page.figures.filter((f) => !f.ignored && f.hair !== null).length) * 0.049).toFixed(2)}
                </Button>
                {(page.detectionTaskId || page.extractionTaskId) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!jobs[page.pageId]}
                    onClick={() => {
                      const mode = page.extractionTaskId ? "extract" : "detect";
                      setJobs((old) => ({ ...old, [page.pageId]: startJob(mode) }));
                      void follow(page.pageId, (page.extractionTaskId ?? page.detectionTaskId)!, mode)
                        .catch((e) => setNote(page.pageId, { text: message(e), error: true }))
                        .finally(() => setJobs((old) => without(old, page.pageId)));
                    }}
                  >
                    Resume
                  </Button>
                )}
                <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => reorder(index, -1)}>
                  Move earlier
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={index === local.length - 1}
                  onClick={() => reorder(index, 1)}
                >
                  Move later
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void save((saved) => ({ ...saved, local: saved.local.filter((p) => p.pageId !== page.pageId) }));
                  }}
                >
                  Remove source page
                </Button>
              </div>
              {notes[page.pageId] && (
                <p
                  role={notes[page.pageId]!.error ? "alert" : "status"}
                  className={`mt-2 text-sm ${notes[page.pageId]!.error ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {notes[page.pageId]!.text}
                </p>
              )}
              {page.results.length > 0 && (
                <div className="mt-5 flex flex-col gap-3" data-testid="cast-extraction">
                  <h4 className="font-semibold">Review extraction before accepting bases</h4>
                  <p className="text-xs text-muted-foreground">
                    Check the shared background, hidden scalp, masks and both skin extremes. Overlapping people or
                    foreground may need correction in your drawing tool; keep manual import available.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <figure>
                      <img
                        src={draftFileUrl(files.storyId, files.version, page.asset)}
                        alt="Original page"
                        className="w-full rounded border"
                      />
                      <figcaption className="text-xs">Original page</figcaption>
                    </figure>
                    {(["light", "dark"] as const).map((side) => (
                      <figure key={side}>
                        <div className="relative overflow-hidden rounded border">
                          <img
                            src={draftFileUrl(files.storyId, files.version, page.asset)}
                            alt=""
                            className="invisible block w-full"
                          />
                          {page.results[0]?.plate && (
                            <img
                              src={draftFileUrl(files.storyId, files.version, page.results[0].plate)}
                              alt={`Reconstructed page on ${side} skin`}
                              className="absolute inset-0 h-full w-full"
                            />
                          )}
                          {page.results.map(
                            (r) =>
                              r.box && (
                                <img
                                  key={r.request.slotId}
                                  src={draftFileUrl(files.storyId, files.version, r.review[side])}
                                  alt=""
                                  className="absolute"
                                  style={{
                                    left: `${r.box[0] / 10}%`,
                                    top: `${r.box[1] / 10}%`,
                                    width: `${(r.box[2] - r.box[0]) / 10}%`,
                                    height: `${(r.box[3] - r.box[1]) / 10}%`,
                                  }}
                                />
                              ),
                          )}
                        </div>
                        <figcaption className="text-xs">Reconstructed · {side} skin</figcaption>
                      </figure>
                    ))}
                  </div>
                  {page.results.map((r) => (
                    <div key={r.request.slotId}>
                      <h5>{draft.characterSlots.find((s) => s.slotId === r.request.slotId)?.label}</h5>
                      <div className="flex flex-wrap gap-2">
                        {(
                          [
                            ["Shared background", r.plate],
                            ["Skin mask", r.review.mask],
                            ["Light skin", r.review.light],
                            ["Dark skin", r.review.dark],
                          ] as const
                        ).map(
                          ([label, asset]) =>
                            asset && (
                              <figure key={label}>
                                <img
                                  src={draftFileUrl(files.storyId, files.version, asset)}
                                  alt={label}
                                  className="h-36 w-36 rounded border object-contain"
                                />
                                <figcaption className="text-xs">{label}</figcaption>
                              </figure>
                            ),
                        )}
                      </div>
                      {r.notes.map((n) => (
                        <p key={n} className="text-xs text-amber-700">
                          {n}
                        </p>
                      ))}
                    </div>
                  ))}
                  <Button
                    size="sm"
                    className="self-start"
                    disabled={page.applied}
                    onClick={() => {
                      const results = page.results;
                      void save((saved) => ({
                        draft: {
                          ...saved.draft,
                          pages: saved.draft.pages.map((p) =>
                            p.pageId === page.pageId ? results.reduce((current, r) => applyImport(current, r), p) : p,
                          ),
                        },
                        local: saved.local.map((p) => (p.pageId === page.pageId ? { ...p, applied: true } : p)),
                      }));
                    }}
                  >
                    Approve extraction and use these bases
                  </Button>
                </div>
              )}
            </fieldset>
          </article>
        ))}
        {local.length > 0 && (
          <Button variant="outline" className="self-start" onClick={() => void save((saved) => saved)}>
            Save casting corrections
          </Button>
        )}
      </fieldset>
    </section>
  );
}

/** Head boxes' colour, apart from the figures' rust (selected) and blue. */
const HEAD = "#15803d";
/** `r` moved (and shrunk if it must be) to lie within `outer`. */
const inside = (r: Rect, outer: Rect): Rect => {
  const w = Math.min(r[2] - r[0], outer[2] - outer[0]);
  const h = Math.min(r[3] - r[1], outer[3] - outer[1]);
  const x = Math.min(Math.max(r[0], outer[0]), outer[2] - w);
  const y = Math.min(Math.max(r[1], outer[1]), outer[3] - h);
  return [x, y, x + w, y + h];
};

function CastPageEditor({
  page,
  roles,
  src,
  onChange,
}: {
  page: CastingPage;
  roles: ReadonlyArray<CharacterSlot>;
  src: string;
  onChange: (page: CastingPage) => void;
}) {
  const [selected, setSelected] = useState(page.figures[0]?.id ?? "");
  const figure = page.figures.find((f) => f.id === selected) ?? page.figures[0];
  const [head, setHead] = useState(false);
  const drag = useRef<{ x: number; y: number; box: Rect; head: Rect; resize: boolean } | null>(null);
  const update = (next: CastFigure) =>
    onChange({ ...page, figures: page.figures.map((f) => (f.id === next.id ? next : f)) });
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current || !figure) return;
    const r = event.currentTarget.getBoundingClientRect();
    const d = drag.current;
    const dx = Math.round(((event.clientX - d.x) * 1000) / r.width);
    const dy = Math.round(((event.clientY - d.y) * 1000) / r.height);
    const b = d.box;
    const x = Math.max(-b[0], Math.min(1000 - b[2], dx));
    const y = Math.max(-b[1], Math.min(1000 - b[3], dy));
    const box: Rect = d.resize
      ? [b[0], b[1], Math.max(b[0] + 10, Math.min(1000, b[2] + dx)), Math.max(b[1] + 10, Math.min(1000, b[3] + dy))]
      : [b[0] + x, b[1] + y, b[2] + x, b[3] + y];
    // A head box always stays inside its figure box: extraction refuses one that doesn't. Moving the figure carries
    // its head along; resizing or moving the head keeps it within the figure.
    if (head) update({ ...figure, head: inside(box, figure.box) });
    else {
      const h = d.head;
      update({ ...figure, box, head: inside(d.resize ? h : [h[0] + x, h[1] + y, h[2] + x, h[3] + y], box) });
    }
  };
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <div className="relative self-start overflow-hidden rounded border">
        <img src={src} alt={`Source art for ${page.pageId}`} className="block w-full" draggable={false} />
        <svg
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full touch-none"
          aria-label={`Character boxes on ${page.pageId}`}
          onPointerMove={move}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          {page.figures
            .filter((f) => !f.ignored)
            .map((f, i) => {
              const b = head ? f.head : f.box;
              const active = figure?.id === f.id;
              // Heads have their own colour so a dashed head line doesn't disappear under its figure's outline.
              const color = head ? HEAD : active ? "#bc492e" : "#2563eb";
              return (
                <g key={f.id} stroke={color}>
                  <rect
                    x={b[0]}
                    y={b[1]}
                    width={b[2] - b[0]}
                    height={b[3] - b[1]}
                    fill={active ? `${color}18` : "transparent"}
                    strokeWidth={5}
                    strokeDasharray={head ? "12 8" : undefined}
                    className="cursor-move"
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setSelected(f.id);
                      drag.current = { x: e.clientX, y: e.clientY, box: b, head: f.head, resize: false };
                    }}
                  />
                  {!head && (
                    <rect
                      x={f.head[0]}
                      y={f.head[1]}
                      width={f.head[2] - f.head[0]}
                      height={f.head[3] - f.head[1]}
                      fill="none"
                      stroke={HEAD}
                      strokeWidth={4}
                      strokeDasharray="12 8"
                      pointerEvents="none"
                    />
                  )}
                  <text
                    x={b[0] + 6}
                    y={Math.max(25, b[1] - 8)}
                    fill={color}
                    stroke="white"
                    paintOrder="stroke"
                    strokeWidth={3}
                    fontSize={28}
                  >
                    {i + 1} · {roles.find((r) => r.slotId === f.slotId)?.label ?? "Assign a role"}
                  </text>
                  {active && (
                    <rect
                      x={b[2] - 18}
                      y={b[3] - 18}
                      width={36}
                      height={36}
                      fill={color}
                      className="cursor-se-resize"
                      onPointerDown={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId);
                        drag.current = { x: e.clientX, y: e.clientY, box: b, head: f.head, resize: true };
                      }}
                    />
                  )}
                </g>
              );
            })}
        </svg>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          Solid boxes are whole figures; dashed green boxes are heads (including hair) and move with their figure. Drag
          a box to move it, or its bottom-right handle to resize. Turn on “Edit head boxes” below to move or resize the
          heads. Exact coordinates are in Details.
        </p>
        <div className="flex flex-wrap gap-1">
          {page.figures.map((f, i) => (
            <Button
              key={f.id}
              size="sm"
              variant={figure?.id === f.id ? "default" : "outline"}
              onClick={() => setSelected(f.id)}
            >
              {i + 1}
              {f.ignored ? " · ignored" : ""}
            </Button>
          ))}
        </div>
        {figure && (
          <>
            <label className="text-xs">
              Role
              <NativeSelect
                aria-label="Cast role"
                value={figure.slotId}
                onChange={(e) => {
                  const role = roles.find((r) => r.slotId === e.target.value);
                  update({
                    ...figure,
                    slotId: e.target.value,
                    age: role?.ages.includes(figure.age) ? figure.age : (role?.ages[0] ?? figure.age),
                  });
                }}
              >
                <option value="">Assign a role</option>
                {roles.map((r) => (
                  <option key={r.slotId} value={r.slotId}>
                    {r.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="text-xs">
              Description
              <Input
                aria-label="Cast description"
                value={figure.description}
                onChange={(e) => update({ ...figure, description: e.target.value })}
                maxLength={200}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">
                Age
                <NativeSelect
                  aria-label="Cast age"
                  value={figure.age}
                  onChange={(e) => update({ ...figure, age: e.target.value as Age })}
                >
                  {ageOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="text-xs">
                Face
                <NativeSelect
                  aria-label="Cast face"
                  value={figure.face}
                  onChange={(e) => update({ ...figure, face: e.target.value as CastFigure["face"] })}
                >
                  {faceOptions.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            </div>
            <label className="text-xs">
              Drawn hairstyle
              <NativeSelect
                aria-label="Cast hair"
                value={figure.hair ?? ""}
                onChange={(e) => update({ ...figure, hair: (e.target.value as CastFigure["hair"]) || null })}
              >
                <option value="">Bald</option>
                {hairOptions.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={figure.ignored}
                onChange={(e) => update({ ...figure, ignored: e.target.checked })}
              />
              Ignore this person
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={head} onChange={(e) => setHead(e.target.checked)} />
              Edit head boxes
            </label>
            <details>
              <summary className="cursor-pointer text-sm">Details: exact boundaries</summary>
              <RectFields
                label="Cast figure box"
                value={figure.box}
                onChange={(box) => update({ ...figure, box, head: inside(figure.head, box) })}
              />
              <RectFields
                label="Cast head box"
                value={figure.head}
                onChange={(box) => update({ ...figure, head: box })}
              />
            </details>
          </>
        )}
      </div>
    </div>
  );
}
