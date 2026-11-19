// One character figure on a draft page (D26, D29): which role, its box, an optional pinned age, the base drawings
// with their masks for each age and face type it draws, and the part grid every look option needs. A cell is filled by
// an uploaded drawing (approved here, in the manifest) or by a generated part (D36; generated from the base and
// approved or rejected in story_part, the one record of its review).
import {
  type Age,
  ageLabel,
  ageOptions,
  type CharacterSlot,
  faceOptions,
  type FigureBase,
  type FigureLayer,
  type LookOption,
  lookVocabulary,
  NO_PART_OPTIONS,
  type Part,
  partAxesAt,
  type PartDecision,
  type Rect,
  type StoryPart,
} from "@lifestory/core/contracts";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { NativeSelect } from "~/components/ui/native-select";
import { type DraftFiles, draftFileUrl, RectFields, UploadField } from "./fields";

const faceLabel = (face: string) => faceOptions.find((option) => option.id === face)?.label.toLowerCase() ?? face;

/** What the parts grid needs from the part pipeline (D36), for this figure. */
export interface Generation {
  /** Parts generated for this figure's role on this page, oldest first. */
  readonly parts: ReadonlyArray<StoryPart>;
  /** Why generating isn't possible now (unsaved changes, two figures of the role on the page), or null. */
  readonly blocked: string | null;
  readonly generate: (requests: ReadonlyArray<{ age: Age; face: FigureBase["face"]; axis: Part["axis"]; option: string; zone: Rect; seed: number }>) => void;
  readonly review: (partId: string, decision: PartDecision) => void;
}

export function FigureEditor({
  files,
  pageId,
  figure,
  slots,
  generation,
  onChange,
}: {
  files: DraftFiles;
  pageId: string;
  figure: FigureLayer;
  slots: ReadonlyArray<CharacterSlot>;
  generation: Generation;
  onChange: (figure: FigureLayer) => void;
}) {
  const slot = slots.find((candidate) => candidate.slotId === figure.slotId);
  const ages: ReadonlyArray<Age> = figure.age ? [figure.age] : (slot?.ages ?? []);
  const folder = `pages/${pageId}/${figure.slotId}`;
  const role = slot?.label ?? figure.slotId;

  return (
    <div className="flex flex-col gap-4" data-testid={`figure-${figure.slotId}`}>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Role
          <NativeSelect aria-label="Figure role" value={figure.slotId} onChange={(event) => onChange({ ...figure, slotId: event.target.value })}>
            {!slot && <option value={figure.slotId}>{figure.slotId} (missing)</option>}
            {slots.map((candidate) => (
              <option key={candidate.slotId} value={candidate.slotId}>
                {candidate.label} ({candidate.slotId})
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Age on this page
          <NativeSelect
            aria-label="Age on this page"
            value={figure.age ?? ""}
            onChange={(event) => {
              const { age: _, ...rest } = figure;
              onChange(event.target.value ? { ...rest, age: event.target.value as Age } : rest);
            }}
          >
            <option value="">The character's own age</option>
            {ageOptions.map((option) => (
              <option key={option.id} value={option.id}>
                Always {option.label.toLowerCase()}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex items-center gap-2 self-end text-xs font-medium">
          <input
            type="checkbox"
            checked={figure.showsHead !== false}
            onChange={(event) => {
              const { showsHead: _, ...rest } = figure;
              onChange(event.target.checked ? rest : { ...rest, showsHead: false, parts: [] });
            }}
          />
          Head in frame (hair and glasses parts)
        </label>
      </div>
      <RectFields label="Figure box" value={figure.box} onChange={(box) => onChange({ ...figure, box })} />

      <BasesGrid files={files} folder={folder} role={role} figure={figure} ages={ages} onChange={onChange} />
      {figure.showsHead !== false && <PartsGrid files={files} folder={folder} role={role} figure={figure} ages={ages} generation={generation} onChange={onChange} />}
    </div>
  );
}

function BasesGrid({
  files,
  folder,
  role,
  figure,
  ages,
  onChange,
}: {
  files: DraftFiles;
  folder: string;
  role: string;
  figure: FigureLayer;
  ages: ReadonlyArray<Age>;
  onChange: (figure: FigureLayer) => void;
}) {
  // A base needs its drawing and its skin mask; whichever arrives first waits here for the other.
  const [pending, setPending] = useState<Record<string, { asset?: string; skinMask?: string }>>({});
  const set = (age: Age, face: FigureBase["face"], field: "asset" | "skinMask" | "browMask", asset: string) => {
    const existing = figure.bases.find((base) => base.age === age && base.face === face);
    if (existing) {
      onChange({ ...figure, bases: figure.bases.map((base) => (base === existing ? { ...base, [field]: asset } : base)) });
      return;
    }
    const key = `${age}/${face}`;
    const next = { ...pending[key], [field]: asset };
    if (next.asset && next.skinMask) {
      onChange({ ...figure, bases: [...figure.bases, { age, face, asset: next.asset, skinMask: next.skinMask }] });
      setPending((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== key)));
    } else {
      setPending({ ...pending, [key]: next });
    }
  };

  return (
    <section className="flex flex-col gap-2" aria-label={`Base drawings of ${role}`}>
      <h4 className="text-sm font-semibold">Base drawings</h4>
      <p className="text-muted-foreground text-xs">
        One per face type at each age this figure draws: bald, in neutral greys, filling the box. The skin mask covers every visible bit of skin (it takes
        the skin tone); the brow mask takes the hair colour.
      </p>
      <ul className="grid gap-2 md:grid-cols-2">
        {ages.flatMap((age) =>
          faceOptions.map(({ id: face }) => {
            const base = figure.bases.find((candidate) => candidate.age === age && candidate.face === face);
            const waiting = pending[`${age}/${face}`];
            const at = `${ageLabel(age)}, ${faceLabel(face)}`;
            return (
              <li key={`${age}/${face}`} className="flex flex-col gap-2 rounded-md border p-2" data-testid="base-cell" data-ready={base ? "true" : "false"}>
                <span className="text-xs font-semibold">{at}</span>
                <UploadField files={files} folder={folder} label={`Base drawing: ${at}`} asset={base?.asset ?? waiting?.asset} onUploaded={(asset) => set(age, face, "asset", asset)} />
                <UploadField files={files} folder={folder} label={`Skin mask: ${at}`} asset={base?.skinMask ?? waiting?.skinMask} onUploaded={(asset) => set(age, face, "skinMask", asset)} />
                {base && <UploadField files={files} folder={folder} label={`Brow mask: ${at}`} asset={base.browMask} onUploaded={(asset) => set(age, face, "browMask", asset)} />}
              </li>
            );
          }),
        )}
      </ul>
    </section>
  );
}

interface PartCell {
  readonly age: Age;
  readonly face: FigureBase["face"];
  readonly axis: Part["axis"];
  readonly option: LookOption;
}

const sameCell = (cell: PartCell, part: Pick<Part, "age" | "face" | "axis" | "option">) =>
  part.age === cell.age && part.face === cell.face && part.axis === cell.axis && part.option === cell.option.id;

const statusLabel: Record<StoryPart["status"], string> = {
  generating: "Generating…",
  pending_review: "Generated, waiting for your review",
  approved: "Generated and approved",
  rejected: "Generated and rejected",
  failed: "Generation failed",
};

function PartsGrid({
  files,
  folder,
  role,
  figure,
  ages,
  generation,
  onChange,
}: {
  files: DraftFiles;
  folder: string;
  role: string;
  figure: FigureLayer;
  ages: ReadonlyArray<Age>;
  generation: Generation;
  onChange: (figure: FigureLayer) => void;
}) {
  // Where generated parts may be, in thousandths of the base: the head, with room for long hair (D36).
  const [zone, setZone] = useState<Rect>([200, 0, 800, 450]);
  const cells: ReadonlyArray<PartCell> = ages.flatMap((age) =>
    faceOptions.flatMap(({ id: face }) =>
      partAxesAt(age).flatMap((axis) =>
        (lookVocabulary[axis] as ReadonlyArray<LookOption>).filter((option) => !NO_PART_OPTIONS.has(option.id)).map((option) => ({ age, face, axis, option })),
      ),
    ),
  );
  const uploaded = (cell: PartCell) => figure.parts.find((part) => sameCell(cell, part));
  const attempts = (cell: PartCell) => generation.parts.filter((part) => sameCell(cell, part));
  /** The generated part that fills the cell: an approved one, else the newest still generating or waiting. */
  const generated = (cell: PartCell) => {
    const all = attempts(cell);
    return all.findLast((part) => part.status === "approved") ?? all.findLast((part) => part.status === "pending_review" || part.status === "generating");
  };
  const hasBase = (cell: PartCell) => figure.bases.some((base) => base.age === cell.age && base.face === cell.face);
  const request = (cell: PartCell) => ({
    age: cell.age,
    face: cell.face,
    axis: cell.axis,
    option: cell.option.id,
    zone,
    seed: attempts(cell).reduce((max, part) => Math.max(max, part.seed), 0) + 1,
  });
  const setPart = (old: Part, next: Part) => onChange({ ...figure, parts: figure.parts.map((part) => (part === old ? next : part)) });
  const add = (cell: PartCell, asset: string) => {
    // Hairstyles of one figure usually sit in the same place, so a new part starts where a part of its axis is.
    const sibling = figure.parts.find((part) => part.axis === cell.axis);
    const part: Part = {
      age: cell.age,
      face: cell.face,
      axis: cell.axis,
      option: cell.option.id,
      asset,
      at: sibling?.at ?? [0, 0, 1000, 1000],
      palette: cell.axis === "hair" ? "hairColour" : "none",
      approved: false,
    };
    onChange({ ...figure, parts: [...figure.parts, part] });
  };
  const empty = cells.filter((cell) => !uploaded(cell) && !generated(cell));
  const generatable = empty.filter(hasBase);
  const waiting = cells.filter((cell) => {
    const gen = generated(cell);
    return gen ? gen.status !== "approved" : uploaded(cell)?.approved === false;
  }).length;
  const unapprovedUploads = figure.parts.filter((part) => !part.approved).length;

  return (
    <section className="flex flex-col gap-2" aria-label={`Parts of ${role}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">
          Parts{" "}
          <span className="text-muted-foreground font-normal" data-testid="parts-count">
            {cells.length - empty.length} of {cells.length} drawn, {waiting} waiting for approval
          </span>
        </h4>
        <Button
          size="sm"
          variant="outline"
          disabled={unapprovedUploads === 0}
          onClick={() => onChange({ ...figure, parts: figure.parts.map((part) => ({ ...part, approved: true })) })}
        >
          Approve every uploaded part of this figure
        </Button>
      </div>
      <div className="flex flex-col gap-2 rounded-md border border-dashed bg-muted/40 p-2 text-xs" data-testid="part-generation">
        <p className="font-medium">Generate the missing parts from the base</p>
        <p className="text-muted-foreground">
          Each empty cell is drawn on its base by the image model, cut out, and shown here on the lightest and darkest skin for you to approve or reject.
          Parts may only appear inside the zone.
        </p>
        <RectFields label="Head zone" value={zone} onChange={(rect) => setZone(rect as Rect)} />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={generation.blocked !== null || generatable.length === 0}
            onClick={() => generation.generate(generatable.map(request))}
          >
            Generate {generatable.length} missing parts
          </Button>
          {generation.blocked && <span className="text-muted-foreground">{generation.blocked}</span>}
          {empty.length > generatable.length && <span className="text-muted-foreground">Cells without a base drawing can't be generated yet.</span>}
        </div>
      </div>
      <ul className="grid gap-2 md:grid-cols-2">
        {cells.map((cell) => {
          const part = uploaded(cell);
          const gen = generated(cell);
          const last = attempts(cell).at(-1);
          const at = `${cell.option.label}, ${ageLabel(cell.age).toLowerCase()}, ${faceLabel(cell.face)}`;
          const state = gen
            ? gen.status === "approved"
              ? "approved"
              : gen.status === "generating"
                ? "generating"
                : "unapproved"
            : part
              ? part.approved
                ? "approved"
                : "unapproved"
              : "missing";
          return (
            <li
              key={`${cell.age}/${cell.face}/${cell.option.id}`}
              className="flex flex-col gap-2 rounded-md border p-2"
              data-testid="part-cell"
              data-option={cell.option.id}
              data-state={state}
              data-source={gen ? "generated" : part ? "uploaded" : "none"}
            >
              <span className="text-xs font-semibold">{at}</span>
              {gen ? (
                <GeneratedPart part={gen} at={at} generation={generation} onRetry={() => generation.generate([request(cell)])} />
              ) : part ? (
                <>
                  <span className="flex items-center gap-2 text-xs">
                    <img src={draftFileUrl(files.storyId, files.version, part.asset)} alt="" className="size-12 rounded border bg-white object-contain" />
                    <code className="text-muted-foreground truncate">{part.asset}</code>
                  </span>
                  <RectFields label={`Place ${at}`} value={part.at} onChange={(rect) => setPart(part, { ...part, at: rect })} />
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <label className="flex items-center gap-1">
                      Colour
                      <NativeSelect
                        aria-label={`Palette of ${at}`}
                        className="h-7"
                        value={part.palette}
                        onChange={(event) => setPart(part, { ...part, palette: event.target.value as Part["palette"] })}
                      >
                        <option value="hairColour">Hair colour</option>
                        <option value="skin">Skin tone</option>
                        <option value="none">As drawn</option>
                      </NativeSelect>
                    </label>
                    <label className="flex items-center gap-1 font-medium">
                      <input type="checkbox" aria-label={`Approve ${at}`} checked={part.approved} onChange={(event) => setPart(part, { ...part, approved: event.target.checked })} />
                      Approved
                    </label>
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => onChange({ ...figure, parts: figure.parts.filter((p) => p !== part) })}>
                      Remove
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  {last && (
                    <span className="text-muted-foreground text-xs" data-testid="last-attempt">
                      {statusLabel[last.status]}
                      {last.error ? `: ${last.error}` : ""}
                    </span>
                  )}
                  <div className="flex flex-wrap items-end gap-2">
                    <UploadField files={files} folder={folder} label={`Upload ${at}`} asset={undefined} onUploaded={(asset) => add(cell, asset)} />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      aria-label={`Generate ${at}`}
                      disabled={generation.blocked !== null || !hasBase(cell)}
                      onClick={() => generation.generate([request(cell)])}
                    >
                      {last ? "Generate again" : "Generate"}
                    </Button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A generated part in its cell: its review images, cost, and the author's decision. */
function GeneratedPart({ part, at, generation, onRetry }: { part: StoryPart; at: string; generation: Generation; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="generated-part" data-status={part.status}>
      <span className="font-medium">{statusLabel[part.status]}</span>
      {part.files.light && part.files.dark && (
        <span className="flex gap-2">
          <img src={`/api/files/${part.files.light}`} alt={`${at} on light skin`} className="size-20 rounded border bg-white object-contain" />
          <img src={`/api/files/${part.files.dark}`} alt={`${at} on dark skin`} className="size-20 rounded border bg-white object-contain" />
        </span>
      )}
      {part.status !== "generating" && (
        <span className="text-muted-foreground">
          {part.provider ?? "provider"} · seed {part.seed}
          {part.costUsd !== null && ` · US$${part.costUsd.toFixed(3)}`}
        </span>
      )}
      {part.status !== "generating" && (
        <div className="flex flex-wrap gap-2">
          {part.status !== "approved" && (
            <Button size="sm" className="h-7" aria-label={`Approve generated ${at}`} onClick={() => generation.review(part.id, "approve")}>
              Approve
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7" aria-label={`Reject generated ${at}`} onClick={() => generation.review(part.id, "reject")}>
            Reject
          </Button>
          <Button size="sm" variant="ghost" className="h-7" disabled={generation.blocked !== null} onClick={onRetry}>
            Try another
          </Button>
        </div>
      )}
    </div>
  );
}
