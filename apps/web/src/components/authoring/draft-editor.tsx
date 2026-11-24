// The story draft editor (D37): story details, the photo style (D56), trim, fonts and text styles; roles with their
// accepted ages, pronoun tokens, stock character, outfit and sheet; pages with their layout, text, art layers and
// figures (book format 4: each figure's bald reference, stock drawing, box, window and head). The selected page shows as
// BookPage renders it (the same component the book editor and the PDF use), with the text live and the pictures as
// of the last save. Checking runs the publishing checks; publishing makes an immutable story version.
import {
  agreementIssues,
  type Age,
  ageOptions,
  type CastMember,
  type CastPerson,
  type CharacterSlot,
  DraftChanged,
  type DraftView,
  exampleCast,
  type IllustrationLayer,
  type Page,
  type PhotoFigure,
  PronounSet,
  type Rect,
  resolvePageText,
  type StoryDraft,
  StoryNotPublishable,
  type TextBlock,
  type TextFrame,
  type TextStyle,
  tokenIssues,
  unwrapResult,
} from "@lifestory/core/contracts";
import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { BookPage, ScaledPage, StoryFonts } from "~/components/book/BookPage";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { NativeSelect } from "~/components/ui/native-select";
import {
  CheckDraftResult,
  checkDraftFn,
  PreviewDraftResult,
  previewDraftFn,
  PublishDraftResult,
  publishDraftFn,
  SaveDraftResult,
  saveDraftFn,
} from "~/server/authoring";

import { type DraftFiles, draftFileUrl, message, NumberField, UploadField } from "./fields";
import { FRAME_PRESETS, FrameFields, type FramePreset, newFrame, nextFrameId, TextFrameOverlay } from "./text-frames";

type Change = (edit: (draft: StoryDraft) => StoryDraft) => void;

const tabs = [
  { id: "story", label: "Story and type" },
  { id: "roles", label: "Roles" },
  { id: "pages", label: "Pages" },
] as const;
type Tab = (typeof tabs)[number]["id"];

const PRONOUN_FIELDS = ["name", "title", "they", "them", "their", "theirs", "themself"] as const;

export function DraftEditor({ initial, people }: { initial: DraftView; people: ReadonlyArray<CastPerson> }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const revision = useRef(initial.revision);
  const [draft, setDraft] = useState<StoryDraft>(initial.draft);
  const [title, setTitle] = useState(initial.story.title);
  const [summary, setSummary] = useState(initial.story.summary);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ readonly error: boolean; readonly text: string } | null>(null);
  const [issues, setIssues] = useState<ReadonlyArray<string> | null>(null);
  const [tab, setTab] = useState<Tab>("story");
  const [selected, setSelected] = useState(initial.draft.pages[0]?.pageId ?? "");
  /** Text frames of the selected page whose text runs past them in the preview. */
  const [overflowing, setOverflowing] = useState<ReadonlyArray<number>>([]);
  const files: DraftFiles = { storyId: view.story.id, version: view.version };
  const change: Change = (edit) => {
    setDraft((current) => edit(current));
    setDirty(true);
    setIssues(null);
  };
  const page = draft.pages.find((candidate) => candidate.pageId === selected) ?? draft.pages[0];

  // "Preview as": someone from the family's books plays a role in the preview only; the role's example is saved.
  const [standIns, setStandIns] = useState<Record<string, string>>({});
  const standIn = (slotId: string) => (standIns[slotId] ? people[Number(standIns[slotId])] : undefined);
  const cast: Record<string, CastMember> = Object.fromEntries(
    Object.entries(exampleCast(draft)).map(([slotId, example]) => {
      const character = standIn(slotId);
      return [
        slotId,
        character
          ? {
              name: character.name,
              ...(character.title ? { title: character.title } : {}),
              pronouns: character.pronouns,
            }
          : example,
      ];
    }),
  );

  // The pictures follow unsaved edits: the server composes the draft as it is here, a moment after the last change.
  // Only the newest answer is shown, so a slow one can't overwrite a later edit.
  const [preview, setPreview] = useState(initial.pages);
  const previewSeq = useRef(0);
  useEffect(() => {
    const seq = ++previewSeq.current;
    const timer = setTimeout(() => {
      void previewDraftFn({ data: { storyId: initial.story.id, draft } })
        .then((result) => {
          if (seq === previewSeq.current) setPreview(unwrapResult(PreviewDraftResult)(result));
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [initial.story.id, draft]);

  const addPage = () => {
    const pageId = nextPageId(draft);
    change((d) => ({
      ...d,
      pages: [
        ...d.pages,
        { pageId, art: "full-bleed", frames: [newFrame(d.trim, "bottom", "t1")], illustration: { layers: [] } },
      ],
    }));
    setSelected(pageId);
    setTab("pages");
  };

  const persist = async (nextDraft: StoryDraft) => {
    setBusy(true);
    setStatus(null);
    try {
      const next = unwrapResult(SaveDraftResult)(
        await saveDraftFn({
          data: {
            storyId: files.storyId,
            revision: revision.current,
            draft: nextDraft,
            title,
            summary,
          },
        }),
      );
      revision.current = next.revision;
      setView(next);
      setDraft(next.draft);
      setDirty(false);
      setStatus({ error: false, text: "Saved." });
      return true;
    } catch (cause) {
      setStatus({
        error: true,
        text:
          cause instanceof DraftChanged
            ? "This draft changed somewhere else (another tab). Reload the page to see it; edits here aren't saved."
            : `Couldn't save: ${message(cause)}`,
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setBusy(true);
    setStatus(null);
    try {
      setIssues(unwrapResult(CheckDraftResult)(await checkDraftFn({ data: { storyId: files.storyId } })).issues);
    } catch (cause) {
      setStatus({ error: true, text: message(cause) });
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    setBusy(true);
    setStatus(null);
    try {
      unwrapResult(PublishDraftResult)(
        await publishDraftFn({ data: { storyId: files.storyId, revision: view.revision } }),
      );
      await router.invalidate();
    } catch (cause) {
      if (cause instanceof StoryNotPublishable) setIssues(cause.issues);
      else
        setStatus({
          error: true,
          text: cause instanceof DraftChanged ? "This draft changed somewhere else; reload the page." : message(cause),
        });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
      <StoryFonts fonts={draft.fonts} assetUrl={(asset) => draftFileUrl(files.storyId, files.version, asset)} />
      <div className="flex min-w-0 flex-col gap-4">
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background py-2">
          <div role="tablist" className="flex flex-wrap gap-1">
            {tabs.map((candidate) => (
              <Button
                key={candidate.id}
                role="tab"
                aria-selected={tab === candidate.id}
                disabled={busy}
                size="sm"
                variant={tab === candidate.id ? "default" : "outline"}
                onClick={() => setTab(candidate.id)}
              >
                {candidate.label}
              </Button>
            ))}
          </div>
          <span className="flex-1" />
          <span className="text-xs text-muted-foreground" data-testid="draft-state">
            {dirty ? "Unsaved changes" : `Saved · revision ${view.revision}`}
          </span>
          <Button size="sm" onClick={() => void persist(draft)} disabled={busy || !dirty}>
            Save draft
          </Button>
        </div>
        {status && (
          <p
            role={status.error ? "alert" : "status"}
            className={status.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
          >
            {status.text}
          </p>
        )}

        {tab === "story" && (
          <StoryTab
            files={files}
            draft={draft}
            change={change}
            title={title}
            summary={summary}
            setTitle={(t) => {
              setTitle(t);
              setDirty(true);
            }}
            setSummary={(s) => {
              setSummary(s);
              setDirty(true);
            }}
          />
        )}
        {tab === "roles" && <RolesTab files={files} draft={draft} change={change} />}
        {tab === "pages" && page && (
          <PageTab files={files} draft={draft} page={page} change={change} overflowing={overflowing} />
        )}
        {tab === "pages" && !page && (
          <Button className="self-start" onClick={addPage}>
            Add a page
          </Button>
        )}

        <section aria-label="Publish" className="flex flex-col gap-2 rounded-md border p-4">
          <h3 className="font-semibold">Check and publish version {view.version}</h3>
          <p className="text-xs text-muted-foreground">
            Publishing runs the book format's checks: every reference resolves, every role has a stock sheet and every
            figure a stock drawing, every file is uploaded, and fonts are static. A published version never changes;
            later edits go into the next version.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void check()} disabled={busy || dirty}>
              Check
            </Button>
            <Button size="sm" onClick={() => void publish()} disabled={busy || dirty}>
              Publish version {view.version}
            </Button>
            {dirty && <span className="self-center text-xs text-muted-foreground">Save first.</span>}
          </div>
          {issues && (
            <div data-testid="publish-issues" data-count={issues.length}>
              {issues.length === 0 ? (
                <p className="text-sm text-green-700">Ready to publish: no problems found.</p>
              ) : (
                <>
                  <p className="text-sm font-medium">
                    {issues.length === 1 ? "1 thing" : `${issues.length} things`} to fix before publishing:
                  </p>
                  <ul className="mt-1 max-h-64 list-disc overflow-auto pl-5 text-xs">
                    {issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </section>
      </div>

      <aside className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start" aria-label="Page preview">
        {/* As wide as the preview, not as all the tabs in one row: with 24 pages that squeezed the editor to nothing. */}
        <div className="flex w-0 min-w-full flex-wrap gap-1" role="tablist" aria-label="Pages">
          {draft.pages.map((candidate, i) => (
            <Button
              key={candidate.pageId}
              size="sm"
              role="tab"
              aria-selected={candidate.pageId === page?.pageId}
              variant={candidate.pageId === page?.pageId ? "default" : "outline"}
              onClick={() => {
                setSelected(candidate.pageId);
                setTab("pages");
              }}
            >
              Page {i + 1}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={addPage}>
            + Page
          </Button>
        </div>
        {page && (
          <div className="relative w-fit rounded-sm shadow-md ring-1 ring-black/10" data-testid="draft-preview">
            <ScaledPage trim={draft.trim} scale={0.55}>
              <BookPage
                manifest={draft}
                page={page}
                text={resolvePageText(page, cast)}
                illustration={(preview.find((composed) => composed.pageId === page.pageId)?.layers ?? []).map(
                  (layer) => ({
                    url: `/api/files/${layer.key}`,
                    rect: layer.rect,
                  }),
                )}
                cast={cast}
                guides
                onOverflow={setOverflowing}
              />
            </ScaledPage>
            <TextFrameOverlay
              trim={draft.trim}
              frames={page.frames}
              overflowing={overflowing}
              onChange={(frame, box) =>
                change((d) => ({
                  ...d,
                  pages: d.pages.map((p) =>
                    p.pageId === page.pageId
                      ? { ...p, frames: p.frames.map((x, i) => (i === frame ? { ...x, box } : x)) }
                      : p,
                  ),
                }))
              }
              onOpen={(frame) => {
                setTab("pages");
                const first = page.frames.slice(0, frame).reduce((n, x) => n + x.paragraphs.length, 0);
                requestAnimationFrame(() => document.getElementById(`text-block-${first + 1}`)?.focus());
              }}
            />
          </div>
        )}
        <p className="max-w-md text-xs text-muted-foreground">
          As the page will print. Text and pictures follow your edits before you save.
        </p>
        {draft.characterSlots.length > 0 && (
          <fieldset className="flex max-w-md flex-col gap-2 rounded-md border p-2" data-testid="preview-as">
            <legend className="px-1 text-xs font-medium">Preview as</legend>
            {draft.characterSlots.map((slot) => (
              <label key={slot.slotId} className="flex items-center justify-between gap-2 text-xs">
                {slot.label}
                <NativeSelect
                  aria-label={`Preview ${slot.label} as`}
                  className="h-7"
                  value={standIns[slot.slotId] ?? ""}
                  onChange={(event) => setStandIns({ ...standIns, [slot.slotId]: event.target.value })}
                >
                  <option value="">{slot.example.name} (example)</option>
                  {people.map((person, i) =>
                    slot.ages.includes(person.age) ? (
                      <option key={i} value={i}>
                        {person.name}
                      </option>
                    ) : null,
                  )}
                </NativeSelect>
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              People from your family's books of the ages a role accepts, for the text. Only the preview changes;
              families see the example.
            </p>
          </fieldset>
        )}
        {view.story.status !== "draft" && (
          <Link to="/stories/$slug" params={{ slug: view.story.slug }} className="text-sm hover:underline">
            Open the published story →
          </Link>
        )}
      </aside>
    </div>
  );
}

const nextPageId = (draft: StoryDraft) => {
  const used = new Set(draft.pages.map((page) => page.pageId));
  let n = draft.pages.length + 1;
  while (used.has(`p${String(n).padStart(2, "0")}`)) n++;
  return `p${String(n).padStart(2, "0")}`;
};

// ---- Story and type ----------------------------------------------------------------

function StoryTab({
  files,
  draft,
  change,
  title,
  summary,
  setTitle,
  setSummary,
}: {
  files: DraftFiles;
  draft: StoryDraft;
  change: Change;
  title: string;
  summary: string;
  setTitle: (title: string) => void;
  setSummary: (summary: string) => void;
}) {
  const [family, setFamily] = useState(draft.fonts[0]?.family ?? "");
  const [weight, setWeight] = useState("400");
  const families = [...new Set(draft.fonts.map((font) => font.family))];
  const setTrim = (field: keyof StoryDraft["trim"], value: number) =>
    change((d) => ({ ...d, trim: { ...d.trim, [field]: value } }));
  const setStyle = (name: "title" | "body", edit: Partial<TextStyle>) =>
    change((d) => ({ ...d, textStyles: { ...d.textStyles, [name]: { ...d.textStyles[name], ...edit } } }));

  return (
    <div className="flex flex-col gap-6" data-testid="story-tab">
      <section className="grid gap-3 md:grid-cols-2" aria-label="Story details">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Title
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
          Summary
          <textarea
            className="min-h-16 rounded-md border px-3 py-2 text-sm font-normal"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>
      </section>

      <section className="flex flex-col gap-2" aria-label="Photo style">
        <h3 className="font-semibold">Photo style</h3>
        <p className="text-xs text-muted-foreground">
          Each family's character sheets are drawn from their photo in this story's style: a crop of one painted page,
          and the style in words (D56).
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <UploadField
            files={files}
            folder="style"
            label="Style reference"
            asset={draft.photo?.styleReference}
            onUploaded={(styleReference) =>
              change((d) => ({
                ...d,
                photo: { styleWords: "", promptVersion: "photo-hero-v2", ...d.photo, styleReference },
              }))
            }
          />
          <label className="flex flex-col gap-1 text-sm font-medium">
            The style in words
            <Input
              aria-label="The style in words"
              placeholder="thin pencil outline and soft watercolour colouring"
              value={draft.photo?.styleWords ?? ""}
              disabled={!draft.photo}
              onChange={(event) =>
                change((d) => (d.photo ? { ...d, photo: { ...d.photo, styleWords: event.target.value } } : d))
              }
            />
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-2" aria-label="Trim">
        <h3 className="font-semibold">Trim</h3>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <NumberField
            label="Width (in)"
            step={0.125}
            value={draft.trim.widthIn}
            onChange={(n) => setTrim("widthIn", n)}
          />
          <NumberField
            label="Height (in)"
            step={0.125}
            value={draft.trim.heightIn}
            onChange={(n) => setTrim("heightIn", n)}
          />
          <NumberField
            label="Bleed (in)"
            step={0.0625}
            value={draft.trim.bleedIn}
            onChange={(n) => setTrim("bleedIn", n)}
          />
          <NumberField
            label="Safe margin (in)"
            step={0.0625}
            value={draft.trim.safeMarginIn}
            onChange={(n) => setTrim("safeMarginIn", n)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2" aria-label="Fonts">
        <h3 className="font-semibold">Fonts</h3>
        <p className="text-xs text-muted-foreground">
          One static WOFF2 file per weight, so the printed PDF uses the real font. Fonts must allow embedding (e.g. SIL
          OFL).
        </p>
        <ul className="flex flex-col gap-1 text-sm" data-testid="fonts">
          {draft.fonts.map((font) => (
            <li key={font.asset} className="flex items-center gap-2">
              <span className="font-medium">{font.family}</span>
              <span>{font.weight ?? "no weight"}</span>
              <code className="truncate text-xs text-muted-foreground">{font.asset}</code>
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => change((d) => ({ ...d, fonts: d.fonts.filter((f) => f !== font) }))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-2">
          <label className="flex flex-col gap-1 text-xs font-medium">
            Font family
            <Input className="h-8 w-40" value={family} onChange={(event) => setFamily(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Weight
            <NativeSelect
              aria-label="Font weight"
              className="h-8"
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
            >
              {["100", "200", "300", "400", "450", "500", "600", "700", "800", "900"].map((w) => (
                <option key={w}>{w}</option>
              ))}
            </NativeSelect>
          </label>
          {family.trim() ? (
            <UploadField
              files={files}
              folder="fonts"
              label="Upload a WOFF2 font file"
              accept=".woff2,font/woff2"
              asset={undefined}
              onUploaded={(asset) =>
                change((d) => ({
                  ...d,
                  fonts: [...d.fonts, { family: family.trim(), asset, weight, style: "normal" }],
                }))
              }
            />
          ) : (
            <span className="text-xs text-muted-foreground">Name the family to upload its file.</span>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2" aria-label="Text styles">
        <h3 className="font-semibold">Text styles</h3>
        {(["title", "body"] as const).map((name) => {
          const style = draft.textStyles[name];
          const label = name === "title" ? "Title" : "Body";
          return (
            <div
              key={name}
              className="grid grid-cols-2 items-end gap-2 md:grid-cols-5"
              data-testid={`text-style-${name}`}
            >
              <label className="flex flex-col gap-1 text-xs font-medium">
                {label} font
                <NativeSelect
                  aria-label={`${label} font`}
                  className="h-8"
                  value={style.fontFamily}
                  onChange={(event) => setStyle(name, { fontFamily: event.target.value })}
                >
                  {!families.includes(style.fontFamily) && (
                    <option value={style.fontFamily}>{style.fontFamily || "Choose a font"}</option>
                  )}
                  {families.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </NativeSelect>
              </label>
              <NumberField
                label={`${label} size (pt)`}
                value={style.sizePt}
                onChange={(n) => setStyle(name, { sizePt: n })}
              />
              <NumberField
                label={`${label} line height`}
                step={0.05}
                value={style.lineHeight}
                onChange={(n) => setStyle(name, { lineHeight: n })}
              />
              <label className="flex flex-col gap-1 text-xs font-medium">
                {label} weight
                <NativeSelect
                  aria-label={`${label} weight`}
                  className="h-8"
                  value={String(style.weight)}
                  onChange={(event) => setStyle(name, { weight: Number(event.target.value) })}
                >
                  {[
                    ...new Set([
                      String(style.weight),
                      ...draft.fonts
                        .filter((f) => f.family === style.fontFamily)
                        .flatMap((f) => (f.weight ? [f.weight] : [])),
                    ]),
                  ].map((w) => (
                    <option key={w}>{w}</option>
                  ))}
                </NativeSelect>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium">
                {label} alignment
                <NativeSelect
                  aria-label={`${label} alignment`}
                  className="h-8"
                  value={style.align}
                  onChange={(event) => setStyle(name, { align: event.target.value as TextStyle["align"] })}
                >
                  <option value="left">Left</option>
                  <option value="center">Centre</option>
                  <option value="right">Right</option>
                </NativeSelect>
              </label>
            </div>
          );
        })}
      </section>
    </div>
  );
}

// ---- Roles ---------------------------------------------------------------------------

const newSlot = (draft: StoryDraft): CharacterSlot => {
  const used = new Set(draft.characterSlots.map((slot) => slot.slotId));
  const slotId = used.has("hero") ? `role-${draft.characterSlots.length + 1}` : "hero";
  return {
    slotId,
    label: slotId === "hero" ? "The child" : "Another character",
    description: "",
    ages: ["young-child"],
    example: { name: "Mia", pronouns: "she/her" },
    outfit: "",
  };
};

function RolesTab({ files, draft, change }: { files: DraftFiles; draft: StoryDraft; change: Change }) {
  return (
    <div className="flex flex-col gap-4" data-testid="roles-tab">
      <p className="text-sm text-muted-foreground">
        Each role is played by a family member of an age it accepts, drawn from their photo. The stock character plays
        it in previews; its sheet and outfit guide every family's sheet.
      </p>
      {draft.characterSlots.map((slot, index) => (
        <RoleEditor key={index} files={files} slot={slot} index={index} change={change} />
      ))}
      <Button
        variant="outline"
        className="self-start"
        onClick={() => change((d) => ({ ...d, characterSlots: [...d.characterSlots, newSlot(d)] }))}
      >
        Add a role
      </Button>
    </div>
  );
}

function RoleEditor({
  files,
  slot,
  index,
  change,
}: {
  files: DraftFiles;
  slot: CharacterSlot;
  index: number;
  change: Change;
}) {
  const setSlot = (edit: (slot: CharacterSlot) => CharacterSlot) =>
    change((d) => {
      const next = edit(d.characterSlots[index]!);
      const renamed = next.slotId !== slot.slotId;
      return {
        ...d,
        characterSlots: d.characterSlots.map((s, i) => (i === index ? next : s)),
        // Figures follow a renamed role; text tokens are the author's to update, and the check lists any left.
        pages: renamed
          ? d.pages.map((page) => ({
              ...page,
              illustration: {
                layers: page.illustration.layers.map((layer) =>
                  layer.kind === "photoFigure" && layer.slotId === slot.slotId
                    ? { ...layer, slotId: next.slotId }
                    : layer,
                ),
              },
            }))
          : d.pages,
      };
    });
  const toggleAge = (age: Age, on: boolean) =>
    setSlot((s) => {
      const ages = ageOptions.map((option) => option.id).filter((id) => (id === age ? on : s.ages.includes(id)));
      return ages.length === 0 ? s : { ...s, ages };
    });
  const { title: _, ...withoutTitle } = slot.example;

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border p-3" data-testid={`role-${slot.slotId}`}>
      <legend className="px-1 text-sm font-semibold">{slot.label}</legend>
      <div className="grid gap-2 md:grid-cols-3">
        <label className="flex flex-col justify-between gap-1 text-xs font-medium">
          Role ID (used in tokens)
          <Input
            className="h-8"
            value={slot.slotId}
            onChange={(event) =>
              setSlot((s) => ({ ...s, slotId: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))
            }
          />
        </label>
        <label className="flex flex-col justify-between gap-1 text-xs font-medium">
          Role name for parents
          <Input
            className="h-8"
            value={slot.label}
            onChange={(event) => setSlot((s) => ({ ...s, label: event.target.value }))}
          />
        </label>
        <label className="flex flex-col justify-between gap-1 text-xs font-medium">
          Guidance for parents
          <Input
            className="h-8"
            value={slot.description}
            onChange={(event) => setSlot((s) => ({ ...s, description: event.target.value }))}
          />
        </label>
      </div>
      <fieldset className="flex flex-wrap gap-3 text-xs">
        <legend className="mb-1 font-medium">Ages this role accepts</legend>
        {ageOptions.map((option) => (
          <label key={option.id} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={slot.ages.includes(option.id)}
              onChange={(event) => toggleAge(option.id, event.target.checked)}
            />
            {option.label} ({option.years})
          </label>
        ))}
      </fieldset>
      <div className="grid gap-2 md:grid-cols-3">
        <label className="flex flex-col justify-between gap-1 text-xs font-medium">
          Example name
          <Input
            className="h-8"
            value={slot.example.name}
            onChange={(event) => setSlot((s) => ({ ...s, example: { ...s.example, name: event.target.value } }))}
          />
        </label>
        <label className="flex flex-col justify-between gap-1 text-xs font-medium">
          Example title (optional, e.g. Dad)
          <Input
            className="h-8"
            value={slot.example.title ?? ""}
            onChange={(event) =>
              setSlot((s) => ({
                ...s,
                example: event.target.value ? { ...s.example, title: event.target.value } : withoutTitle,
              }))
            }
          />
        </label>
        <label className="flex flex-col justify-between gap-1 text-xs font-medium">
          Example pronouns
          <NativeSelect
            aria-label="Example pronouns"
            className="h-8"
            value={slot.example.pronouns}
            onChange={(event) =>
              setSlot((s) => ({ ...s, example: { ...s.example, pronouns: event.target.value as PronounSet } }))
            }
          >
            {PronounSet.literals.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </NativeSelect>
        </label>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Outfit on the sheet
          <Input
            className="h-8"
            placeholder="a red-and-white striped top and red trousers"
            value={slot.outfit}
            onChange={(event) => setSlot((s) => ({ ...s, outfit: event.target.value }))}
          />
        </label>
        <UploadField
          files={files}
          folder="sheets"
          label="Stock character sheet"
          asset={slot.stockSheet}
          onUploaded={(stockSheet) => setSlot((s) => ({ ...s, stockSheet }))}
        />
      </div>
      <p className="text-xs text-muted-foreground" data-testid="role-tokens">
        Tokens: {PRONOUN_FIELDS.map((field) => `{{${slot.slotId}.${field}}}`).join(" ")} · capitalize the field (
        {`{{${slot.slotId}.They}}`}) to capitalize the word · a verb after a pronoun:{" "}
        {`{{${slot.slotId}.they}} {{${slot.slotId}:knows|know}}`} (she knows, they know).
      </p>
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        onClick={() => change((d) => ({ ...d, characterSlots: d.characterSlots.filter((_s, i) => i !== index) }))}
      >
        Remove this role
      </Button>
    </fieldset>
  );
}

// ---- Pages -----------------------------------------------------------------------------

function PageTab({
  files,
  draft,
  page,
  change,
  overflowing,
}: {
  files: DraftFiles;
  draft: StoryDraft;
  page: Page;
  change: Change;
  overflowing: ReadonlyArray<number>;
}) {
  const index = draft.pages.indexOf(page);
  const slotIds = new Set(draft.characterSlots.map((slot) => slot.slotId));
  const setPage = (edit: (page: Page) => Page) =>
    change((d) => ({ ...d, pages: d.pages.map((p) => (p.pageId === page.pageId ? edit(p) : p)) }));
  const setLayers = (edit: (layers: ReadonlyArray<IllustrationLayer>) => ReadonlyArray<IllustrationLayer>) =>
    setPage((p) => ({ ...p, illustration: { layers: edit(p.illustration.layers) } }));
  const firstFigure = page.illustration.layers.findIndex((layer) => layer.kind === "photoFigure");
  const move = (from: number, to: number) =>
    setLayers((layers) => {
      if (to < 0 || to >= layers.length) return layers;
      const next = [...layers];
      [next[from], next[to]] = [next[to]!, next[from]!];
      return next;
    });
  const movePage = (to: number) =>
    change((d) => {
      if (to < 0 || to >= d.pages.length) return d;
      const next = [...d.pages];
      [next[index], next[to]] = [next[to]!, next[index]!];
      return { ...d, pages: next };
    });

  return (
    <div className="flex flex-col gap-6" data-testid="page-tab">
      <div className="flex flex-wrap items-end gap-2">
        <h3 className="mr-2 font-semibold">
          Page {index + 1} <span className="text-xs font-normal text-muted-foreground">({page.pageId})</span>
        </h3>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Art
          <NativeSelect
            aria-label="Art"
            className="h-8"
            value={page.art}
            onChange={(event) => setPage((p) => ({ ...p, art: event.target.value as Page["art"] }))}
          >
            <option value="full-bleed">Fills the page</option>
            <option value="left-half">Left half</option>
          </NativeSelect>
        </label>
        <Button size="sm" variant="outline" onClick={() => movePage(index - 1)} disabled={index === 0}>
          Move earlier
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => movePage(index + 1)}
          disabled={index === draft.pages.length - 1}
        >
          Move later
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => change((d) => ({ ...d, pages: d.pages.filter((p) => p.pageId !== page.pageId) }))}
        >
          Delete page
        </Button>
      </div>

      <section className="flex flex-col gap-3" aria-label="Text">
        <h3 className="font-semibold">Text</h3>
        {page.frames.map((frame, f) => {
          // Paragraphs are numbered across the page in reading order, as a family's text editor numbers them.
          const first = page.frames.slice(0, f).reduce((n, x) => n + x.paragraphs.length, 0);
          const setFrame = (edit: (frame: TextFrame) => TextFrame) =>
            setPage((p) => ({ ...p, frames: p.frames.map((x, i) => (i === f ? edit(x) : x)) }));
          const setParagraphs = (edit: (paragraphs: ReadonlyArray<TextBlock>) => ReadonlyArray<TextBlock>) =>
            setFrame((x) => ({ ...x, paragraphs: edit(x.paragraphs) }));
          const moveFrame = (to: number) =>
            setPage((p) => {
              if (to < 0 || to >= p.frames.length) return p;
              const next = [...p.frames];
              [next[f], next[to]] = [next[to]!, next[f]!];
              return { ...p, frames: next };
            });
          return (
            <fieldset
              key={frame.frameId}
              className="flex flex-col gap-3 rounded-md border p-3"
              data-testid={`text-frame-fields-${f + 1}`}
            >
              <legend className="px-1 text-sm font-semibold">Text frame {f + 1}</legend>
              <div className="flex flex-wrap items-center gap-1">
                {overflowing.includes(f) && (
                  <p role="alert" className="mr-2 text-xs text-destructive">
                    The text runs past this frame with the preview's names. Make the frame bigger or the text shorter:
                    longer names in a family's book need room too.
                  </p>
                )}
                <span className="flex-1" />
                <Button size="sm" variant="ghost" className="h-7" onClick={() => moveFrame(f - 1)} disabled={f === 0}>
                  Read earlier
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={() => moveFrame(f + 1)}
                  disabled={f === page.frames.length - 1}
                >
                  Read later
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={() => setPage((p) => ({ ...p, frames: p.frames.filter((_x, i) => i !== f) }))}
                >
                  Remove frame
                </Button>
              </div>
              <FrameFields trim={draft.trim} frame={frame} index={f} onChange={(next) => setFrame(() => next)} />
              {frame.paragraphs.map((block, b) => {
                const n = first + b + 1;
                const problems = [...tokenIssues(block.content, slotIds), ...agreementIssues(block.content)];
                return (
                  <div key={b} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <NativeSelect
                        aria-label={`Style of text block ${n}`}
                        className="h-7 text-xs"
                        value={block.style}
                        onChange={(event) =>
                          setParagraphs((ps) =>
                            ps.map((t, i) => (i === b ? { ...t, style: event.target.value as "title" | "body" } : t)),
                          )
                        }
                      >
                        <option value="title">Title</option>
                        <option value="body">Body</option>
                      </NativeSelect>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        onClick={() => setParagraphs((ps) => ps.filter((_t, i) => i !== b))}
                      >
                        Remove
                      </Button>
                    </div>
                    <textarea
                      id={`text-block-${n}`}
                      aria-label={`Text block ${n}`}
                      className="min-h-20 rounded-md border px-3 py-2 font-serif text-sm"
                      value={block.content}
                      onChange={(event) =>
                        setParagraphs((ps) => ps.map((t, i) => (i === b ? { ...t, content: event.target.value } : t)))
                      }
                    />
                    {problems.map((problem) => (
                      <p key={problem} role="alert" className="text-xs text-destructive">
                        {problem}
                      </p>
                    ))}
                  </div>
                );
              })}
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                onClick={() =>
                  setFrame((x) => ({ ...x, paragraphs: [...x.paragraphs, { style: "body", content: "" }] }))
                }
              >
                Add a paragraph
              </Button>
            </fieldset>
          );
        })}
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="mr-1 font-medium">Add a text frame:</span>
          {(Object.keys(FRAME_PRESETS) as ReadonlyArray<FramePreset>).map((preset) => (
            <Button
              key={preset}
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() =>
                setPage((p) => ({ ...p, frames: [...p.frames, newFrame(draft.trim, preset, nextFrameId(p.frames))] }))
              }
            >
              {FRAME_PRESETS[preset]}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Drag a frame on the page to move it, drag its edges to resize it, or click it and use the arrow keys (Shift
          moves 0.1 in, Alt resizes). Line breaks you type are kept. Write {"{{role.name}}"}, {"{{role.title}}"}, or a
          pronoun such as {"{{role.they}}"} where the family's names go, and {"{{role:knows|know}}"} for a verb after a
          pronoun (she knows, they know); the Roles tab lists each role's tokens.
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-label="Illustration layers">
        <h3 className="font-semibold">Illustration, bottom to top</h3>
        <ol className="flex flex-col gap-3">
          {page.illustration.layers.map((layer, l) => (
            <li
              key={l}
              className="flex flex-col gap-2 rounded-md border p-3"
              data-testid="layer"
              data-kind={layer.kind}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">
                  {layer.kind === "art"
                    ? firstFigure === -1 || l < firstFigure
                      ? "Plate (behind the characters)"
                      : "Scenery in front of the characters"
                    : `Figure: ${draft.characterSlots.find((s) => s.slotId === layer.slotId)?.label ?? layer.slotId}`}
                </span>
                <span className="flex-1" />
                <Button size="sm" variant="ghost" className="h-7" onClick={() => move(l, l - 1)} disabled={l === 0}>
                  Down
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={() => move(l, l + 1)}
                  disabled={l === page.illustration.layers.length - 1}
                >
                  Up
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={() => setLayers((layers) => layers.filter((_x, i) => i !== l))}
                >
                  Remove
                </Button>
              </div>
              {layer.kind === "art" ? (
                <UploadField
                  files={files}
                  folder={`pages/${page.pageId}`}
                  label={`Replace art layer ${l + 1}`}
                  asset={layer.asset}
                  onUploaded={(asset) =>
                    setLayers((layers) => layers.map((x, i) => (i === l ? { kind: "art", asset } : x)))
                  }
                />
              ) : (
                <FigureFields
                  files={files}
                  pageId={page.pageId}
                  figure={layer}
                  onChange={(update) =>
                    setLayers((layers) => layers.map((x, i) => (i === l && x.kind === "photoFigure" ? update(x) : x)))
                  }
                />
              )}
            </li>
          ))}
        </ol>
        <div className="grid gap-3 rounded-md border border-dashed p-3 md:grid-cols-3">
          <UploadField
            files={files}
            folder={`pages/${page.pageId}`}
            label="Add plate art"
            asset={undefined}
            onUploaded={(asset) =>
              setLayers((layers) => {
                const at = layers.findIndex((layer) => layer.kind === "photoFigure");
                const next = [...layers];
                next.splice(at === -1 ? layers.length : at, 0, { kind: "art", asset });
                return next;
              })
            }
          />
          <UploadField
            files={files}
            folder={`pages/${page.pageId}`}
            label="Add scenery in front"
            asset={undefined}
            onUploaded={(asset) => setLayers((layers) => [...layers, { kind: "art", asset }])}
          />
          <div className="flex flex-col gap-1 text-xs">
            <span className="font-medium">Place a character</span>
            {draft.characterSlots.length === 0 ? (
              <span className="text-muted-foreground">Add a role first.</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {draft.characterSlots.map((slot) => (
                  <Button
                    key={slot.slotId}
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setLayers((layers) => {
                        // Above the plate and the other figures, below any foreground art added after them.
                        const lastFigure = layers.findLastIndex((layer) => layer.kind === "photoFigure");
                        const next = [...layers];
                        next.splice(lastFigure === -1 ? layers.length : lastFigure + 1, 0, {
                          kind: "photoFigure",
                          slotId: slot.slotId,
                          box: [350, 300, 650, 900],
                          window: [300, 250, 700, 950],
                          head: [420, 300, 580, 450],
                        });
                        return next;
                      })
                    }
                  >
                    Place {slot.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/** A rectangle in thousandths of the illustration, as four numbers. */
function RectField({ label, value, onChange }: { label: string; value: Rect; onChange: (rect: Rect) => void }) {
  return (
    <fieldset className="flex flex-col gap-1 text-xs">
      <legend className="font-medium">{label} (thousandths: x0, y0, x1, y1)</legend>
      <div className="grid grid-cols-4 gap-1">
        {value.map((n, i) => (
          <NumberField
            key={i}
            label={["x0", "y0", "x1", "y1"][i]!}
            value={n}
            onChange={(next) => onChange(value.map((v, j) => (j === i ? Math.round(next) : v)) as unknown as Rect)}
          />
        ))}
      </div>
    </fieldset>
  );
}

/**
 * A figure of book format 4 (D56): the illustrator's bald drawing cut tight, the stock character drawn on it, where it
 * sits, the window a family's drawing of it fills, and its head. The art import fills these from a layered file.
 */
function FigureFields({
  files,
  pageId,
  figure,
  onChange,
}: {
  files: DraftFiles;
  pageId: string;
  figure: PhotoFigure;
  /** Applied to the layer as it is when the change lands: two uploads finishing out of order both keep. */
  onChange: (change: (figure: PhotoFigure) => PhotoFigure) => void;
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="figure-fields">
      <div className="grid gap-3 md:grid-cols-2">
        <UploadField
          files={files}
          folder={`pages/${pageId}/${figure.slotId}`}
          label="Bald reference (cut tight)"
          asset={figure.reference}
          onUploaded={(reference) => onChange((current) => ({ ...current, reference }))}
        />
        <UploadField
          files={files}
          folder={`pages/${pageId}/${figure.slotId}`}
          label="Stock drawing (fills the window)"
          asset={figure.stock}
          onUploaded={(stock) => onChange((current) => ({ ...current, stock }))}
        />
      </div>
      <RectField
        label="Figure box"
        value={figure.box}
        onChange={(box) => onChange((current) => ({ ...current, box }))}
      />
      <RectField
        label="Window"
        value={figure.window}
        onChange={(window) => onChange((current) => ({ ...current, window }))}
      />
      <RectField label="Head" value={figure.head} onChange={(head) => onChange((current) => ({ ...current, head }))} />
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={figure.tint !== false}
          onChange={(event) => onChange((current) => ({ ...current, tint: event.target.checked }))}
        />
        Match the drawn figure's colour to the illustrator's (tint)
      </label>
    </div>
  );
}
