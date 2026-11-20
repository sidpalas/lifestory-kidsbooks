// Importing art made outside the app into a page: a layered file (PSD from Photoshop, Procreate, Krita, Affinity or
// Clip Studio, read here in the browser), a set of PNG layers, or one flat picture of the page. The server's
// `page.import` task turns it into the plate, the figure's box, its bald base with skin mask and overlay, and the drawn
// hair as a part; the author reviews it on the lightest and darkest skin and applies it to the page, or tries again.
import {
  type Age,
  ageLabel,
  type ArtImportRequest,
  applyImport,
  type CharacterSlot,
  faceOptions,
  hairOptions,
  NO_PART_OPTIONS,
  offeredAt,
  type ImportResult,
  type ImportSource,
  type ImportStatus,
  type LayerUse,
  type Page,
  type Rect,
  unwrapResult,
} from "@lifestory/core/contracts";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { FileInput } from "~/components/ui/file-input";
import { Input } from "~/components/ui/input";
import { NativeSelect } from "~/components/ui/native-select";
import { ArtImportStartResult, ArtImportStatusResult, artImportStatusFn, requestArtImportFn } from "~/server/authoring";
import { type DraftFiles, draftFileUrl, message, RectFields, uploadDraftFile } from "./fields";

type Face = (typeof faceOptions)[number]["id"];
type HairId = (typeof hairOptions)[number]["id"];

/** One layer of the chosen file, bottom to top, as a PNG on the page's whole canvas. */
interface SourceLayer {
  readonly name: string;
  readonly blob: Blob;
  readonly url: string;
  use: LayerUse;
  readonly warning: string | null;
}

const useLabels: Record<LayerUse, string> = {
  plate: "Plate (the scene behind)",
  foreground: "Foreground (in front of the character)",
  figure: "The character",
  hair: "The character's hair",
  overlay: "Blush and lips (kept as drawn)",
  occluder: "In front of the face (a hand)",
  ignore: "Leave out",
};

/** A layer's likely use, from the name the illustrator gave it. */
export const suggestUse = (name: string, index: number): LayerUse => {
  const n = name.toLowerCase();
  if (/hair|fringe|bangs|curls|braid/.test(n)) return "hair";
  if (/blush|cheek|lip|mouth|freckle/.test(n)) return "overlay";
  if (/hand|occlu|in front/.test(n)) return "occluder";
  if (/fore|^fg\b|front/.test(n)) return "foreground";
  if (/back|^bg\b|plate|scene|sky|landscape|paper/.test(n) || index === 0) return "plate";
  if (/sketch|guide|ref|note|text/.test(n)) return "ignore";
  return "figure";
};

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("couldn't encode a layer"))), "image/png"),
  );

/** Larger documents or layers than any picture book page needs; a PSD from outside can declare anything. */
const MAX_SIDE = 12_000;
const MAX_LAYERS = 64;

/**
 * A PSD's pixel layers, bottom to top, each drawn on a canvas of the document's size. Following ag-psd's advice for
 * files from outside: read the structure without decoding pixels, check sizes, then decode one layer at a time.
 */
async function readPsdLayers(file: File): Promise<ReadonlyArray<SourceLayer>> {
  const { getLayerCanvas, readPsd } = await import("ag-psd");
  const psd = readPsd(await file.arrayBuffer(), {
    useRawData: true,
    useRawThumbnail: true,
    skipCompositeImageData: true,
  });
  if (psd.width > MAX_SIDE || psd.height > MAX_SIDE)
    throw new Error(`This file is ${psd.width} × ${psd.height} px; export it at most ${MAX_SIDE} px wide and high.`);
  if ((psd.bitsPerChannel ?? 8) > 8) throw new Error("Export the file in 8 bits per channel.");
  const out: Array<SourceLayer> = [];
  type Node = NonNullable<typeof psd.children>[number];
  const walk = async (nodes: ReadonlyArray<Node>, hidden: boolean, path: string) => {
    for (const node of nodes) {
      const name = path ? `${path} / ${node.name ?? "layer"}` : (node.name ?? "layer");
      if (node.children) {
        await walk(node.children, hidden || node.hidden === true, name);
        continue;
      }
      if (out.length >= MAX_LAYERS)
        throw new Error(`This file has more than ${MAX_LAYERS} layers; merge the ones that belong together.`);
      if ((node.right ?? 0) - (node.left ?? 0) > MAX_SIDE || (node.bottom ?? 0) - (node.top ?? 0) > MAX_SIDE)
        throw new Error(`The layer "${name}" is too large.`);
      const pixels = getLayerCanvas(node);
      if (!pixels) continue;
      const canvas = document.createElement("canvas");
      canvas.width = psd.width;
      canvas.height = psd.height;
      const context = canvas.getContext("2d")!;
      context.globalAlpha = node.opacity ?? 1;
      context.drawImage(pixels, node.left ?? 0, node.top ?? 0);
      const blob = await toBlob(canvas);
      const warnings = [
        node.blendMode && node.blendMode !== "normal" && node.blendMode !== "pass through"
          ? `blend mode "${node.blendMode}" isn't applied`
          : null,
        node.clipping ? "clipping isn't applied" : null,
      ].filter(Boolean);
      out.push({
        name,
        blob,
        url: URL.createObjectURL(blob),
        use: hidden || node.hidden ? "ignore" : suggestUse(name, out.length),
        warning: warnings.length > 0 ? warnings.join("; ") : null,
      });
    }
  };
  await walk(psd.children ?? [], false, "");
  return out;
}

export function ArtImport({
  files,
  page,
  slots,
  onApply,
}: {
  files: DraftFiles;
  page: Page;
  slots: ReadonlyArray<CharacterSlot>;
  onApply: (edit: (page: Page) => Page) => void;
}) {
  const [slotId, setSlotId] = useState(slots[0]?.slotId ?? "");
  const slot = slots.find((candidate) => candidate.slotId === slotId);
  const [age, setAge] = useState<Age>(slot?.ages[0] ?? "young-child");
  const [face, setFace] = useState<Face>("face:round");
  const [layers, setLayers] = useState<ReadonlyArray<SourceLayer>>([]);
  const [flat, setFlat] = useState<File | null>(null);
  const [box, setBox] = useState<Rect>([300, 200, 700, 900]);
  const [description, setDescription] = useState("");
  const [hair, setHair] = useState<string>("hair:short");
  const [bald, setBald] = useState(false);
  const [hairZone, setHairZone] = useState<Rect>([0, 0, 1000, 400]);
  const [seed, setSeed] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [applied, setApplied] = useState<ReadonlyArray<string>>([]);

  const choose = async (input: HTMLInputElement) => {
    const chosen = [...(input.files ?? [])];
    input.value = "";
    setError(null);
    setResult(null);
    if (chosen.length === 0) return;
    try {
      if (chosen.length === 1 && /\.psd$/i.test(chosen[0]!.name)) {
        setBusy("Reading the layers…");
        const read = await readPsdLayers(chosen[0]!);
        if (read.length === 0) throw new Error("This file has no pixel layers.");
        setLayers(read);
        setFlat(null);
      } else if (chosen.length === 1) {
        setFlat(chosen[0]!);
        setLayers([]);
      } else {
        setLayers(
          chosen.map((file, i) => ({
            name: file.name,
            blob: file,
            url: URL.createObjectURL(file),
            use: suggestUse(file.name, i),
            warning: null,
          })),
        );
        setFlat(null);
      }
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  };

  /** Starts an import and follows it until it's done (up to 10 minutes). */
  const run = async (request: ArtImportRequest) => {
    setError(null);
    setBusy(
      request.kind === "derive"
        ? "Drawing the other face type…"
        : "Importing… the image model takes about 20 s per step.",
    );
    try {
      const { taskId } = unwrapResult(ArtImportStartResult)(
        await requestArtImportFn({ data: { storyId: files.storyId, request } }),
      );
      for (let i = 0; i < 600; i++) {
        const status: ImportStatus = unwrapResult(ArtImportStatusResult)(
          await artImportStatusFn({ data: { storyId: files.storyId, taskId } }),
        );
        if (status.state === "done") return status.result;
        if (status.state === "failed") throw new Error(status.error ?? "The import failed.");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error("The import is taking too long; try again.");
    } catch (cause) {
      setError(message(cause));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const start = async (attempt: number) => {
    setSeed(attempt);
    setResult(null);
    const folder = `pages/${page.pageId}/import`;
    let source: ImportSource;
    try {
      setBusy("Uploading…");
      if (flat) {
        source = {
          kind: "flat",
          asset: await uploadDraftFile(files.storyId, folder, flat),
          box,
          description: description.trim() || "the character",
        };
      } else {
        const used = layers.filter((layer) => layer.use !== "ignore");
        const assets = await Promise.all(
          used.map((layer, i) =>
            uploadDraftFile(files.storyId, folder, new File([layer.blob], `layer-${i}.png`, { type: "image/png" })),
          ),
        );
        source = {
          kind: "layers",
          layers: used.map((layer, i) => ({ asset: assets[i]!, name: layer.name, use: layer.use })),
        };
      }
    } catch (cause) {
      setError(message(cause));
      setBusy(null);
      return;
    }
    setResult(
      await run({
        kind: "page",
        pageId: page.pageId,
        slotId,
        age,
        face,
        hair: bald || hair === "" ? null : (hair as HairId),
        bald,
        hairZone,
        source,
        seed: attempt,
      }),
    );
  };

  const apply = (imported: ImportResult) => {
    onApply((current) => applyImport(current, imported));
    setApplied((done) => [
      ...done,
      `${ageLabel(imported.request.age)}, ${faceOptions.find((option) => option.id === imported.request.face)?.label.toLowerCase()}`,
    ]);
  };

  const otherFace = faceOptions.find((option) => option.id !== result?.request.face);
  const derive = async () => {
    if (!result || !otherFace) return;
    const derived = await run({
      kind: "derive",
      pageId: page.pageId,
      slotId: result.request.slotId,
      age: result.request.age,
      face: otherFace.id,
      from: result.colourFigure,
      seed: 1,
    });
    if (derived) setResult(derived);
  };

  if (slots.length === 0) return null;
  const ready =
    (flat !== null ||
      (layers.some((layer) => layer.use === "plate") && layers.some((layer) => layer.use === "figure"))) &&
    busy === null;
  const fileUrl = (asset: string) => draftFileUrl(files.storyId, files.version, asset);

  return (
    <section
      className="flex flex-col gap-3 rounded-md border border-dashed bg-muted/40 p-3"
      aria-label="Import art"
      data-testid="art-import"
    >
      <div>
        <h3 className="font-semibold">Import art made outside the app</h3>
        <p className="text-muted-foreground text-xs">
          A layered file (PSD from Photoshop, Procreate, Krita, Affinity or Clip Studio), several PNG layers, or one
          flat picture of the page. The import separates the character from the scene, takes the hair off into a part,
          and finds the skin, blush and lips. You review it on light and dark skin before it goes into the page.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Role
          <NativeSelect aria-label="Import role" value={slotId} onChange={(event) => setSlotId(event.target.value)}>
            {slots.map((candidate) => (
              <option key={candidate.slotId} value={candidate.slotId}>
                {candidate.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Drawn at the age
          <NativeSelect aria-label="Import age" value={age} onChange={(event) => setAge(event.target.value as Age)}>
            {(slot?.ages ?? []).map((candidate) => (
              <option key={candidate} value={candidate}>
                {ageLabel(candidate)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          With a
          <NativeSelect aria-label="Import face" value={face} onChange={(event) => setFace(event.target.value as Face)}>
            {faceOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label.toLowerCase()}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>
      <FileInput
        label="Art file"
        multiple
        accept=".psd,image/png,image/jpeg,image/webp"
        onChange={(event) => void choose(event.currentTarget)}
      />

      {layers.length > 0 && (
        <ol className="flex flex-col gap-1" aria-label="Layers, bottom to top" data-testid="import-layers">
          {layers.map((layer, i) => (
            <li key={i} className="flex items-center gap-2 text-xs">
              <img
                src={layer.url}
                alt=""
                className="size-10 shrink-0 rounded border bg-[repeating-conic-gradient(#ddd_0_25%,#fff_0_50%)] bg-[length:8px_8px] object-contain"
              />
              <span className="min-w-0 flex-1 truncate">{layer.name}</span>
              {layer.warning && <span className="text-amber-700">{layer.warning}</span>}
              <NativeSelect
                aria-label={`Use of ${layer.name}`}
                className="h-7"
                value={layer.use}
                onChange={(event) =>
                  setLayers(layers.map((x, j) => (j === i ? { ...x, use: event.target.value as LayerUse } : x)))
                }
              >
                {Object.entries(useLabels).map(([use, label]) => (
                  <option key={use} value={use}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </li>
          ))}
        </ol>
      )}
      {flat && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="text-xs">
              One flat picture: the image model removes the character and paints what was behind them; the character is
              cut out against that. Mark where they are.
            </p>
            <RectFields label="Where the character is" value={box} onChange={(rect) => setBox(rect as Rect)} />
            <label className="flex flex-col gap-1 text-xs font-medium">
              Who to remove, in a few words
              <Input
                aria-label="Who to remove"
                value={description}
                placeholder="the girl in the yellow T-shirt"
                onChange={(event) => setDescription(event.target.value)}
                className="h-8"
              />
            </label>
          </div>
          <FlatPreview key={`${flat.name}:${flat.size}`} file={flat} box={box} />
        </div>
      )}
      {(flat || layers.length > 0) && (
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" checked={bald} onChange={(event) => setBald(event.target.checked)} />
            Drawn bald already
          </label>
          {!bald && (
            <label className="flex flex-col gap-1 font-medium">
              The hair drawn is
              <NativeSelect
                aria-label="Drawn hair"
                className="h-8"
                value={hair}
                onChange={(event) => setHair(event.target.value)}
              >
                {hairOptions
                  .filter((option) => offeredAt(option, age) && !NO_PART_OPTIONS.has(option.id))
                  .map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}: keep it as that part
                    </option>
                  ))}
                <option value="">Leave it out</option>
              </NativeSelect>
            </label>
          )}
          {!bald && layers.every((layer) => layer.use !== "hair") && (
            <RectFields
              label="Where the hair is, in the character"
              value={hairZone}
              onChange={(rect) => setHairZone(rect as Rect)}
            />
          )}
          <Button size="sm" disabled={!ready} onClick={() => void start(1)}>
            Import
          </Button>
        </div>
      )}
      {busy && (
        <p className="text-xs" role="status">
          {busy}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-2 rounded-md border bg-background p-2" data-testid="import-review">
          <p className="text-xs font-medium">
            {result.request.kind === "derive" ? "The other face type" : "The import"}: {ageLabel(result.request.age)},{" "}
            {faceOptions.find((option) => option.id === result.request.face)?.label.toLowerCase()} · US$
            {result.costUsd.toFixed(3)}
          </p>
          <div className="flex flex-wrap gap-2">
            {result.review.plate && (
              <Review
                src={fileUrl(result.review.plate)}
                label={
                  result.request.kind === "page" && result.request.source.kind === "flat"
                    ? "Plate, with the character taken out"
                    : "Plate"
                }
                wide
              />
            )}
            <Review src={fileUrl(result.review.mask)} label="Skin mask (tinted red)" />
            <Review src={fileUrl(result.review.light)} label="On the lightest skin" />
            <Review src={fileUrl(result.review.dark)} label="On the darkest skin" />
          </div>
          {result.notes.map((note) => (
            <p key={note} className="text-xs text-amber-700">
              {note}
            </p>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => apply(result)}>
              Apply to this page
            </Button>
            {result.request.kind === "page" && (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void start(seed + 1)}>
                Try another
              </Button>
            )}
            {otherFace && (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void derive()}>
                Draw the {otherFace.label.toLowerCase()} from it
              </Button>
            )}
          </div>
          {applied.length > 0 && (
            <p className="text-muted-foreground text-xs">
              Applied: {applied.join("; ")}. Save to keep it; the parts grid can generate the other hairstyles.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Review({ src, label, wide }: { src: string; label: string; wide?: boolean }) {
  return (
    <figure className="flex flex-col gap-1 text-xs">
      <img
        src={src}
        alt={label}
        className={`h-40 rounded border bg-white object-contain ${wide ? "aspect-square" : ""}`}
      />
      <figcaption className="text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

/** The flat picture with the box the author marks over it. */
function FlatPreview({ file, box }: { file: File; box: Rect }) {
  const [url] = useState(() => URL.createObjectURL(file));
  return (
    <div className="relative w-fit">
      <img src={url} alt="The flat page" className="max-h-56 rounded border" />
      <div
        className="absolute border-2 border-dashed border-red-600"
        style={{
          left: `${box[0] / 10}%`,
          top: `${box[1] / 10}%`,
          width: `${(box[2] - box[0]) / 10}%`,
          height: `${(box[3] - box[1]) / 10}%`,
        }}
      />
    </div>
  );
}
