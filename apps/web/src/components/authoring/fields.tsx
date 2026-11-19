// Small controls the story draft editor shares: file uploads into the draft's folder, numbers, and rectangles.
import { storyAssetKey } from "@lifestory/core/contracts";
import { useState } from "react";
import { Input } from "~/components/ui/input";

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const draftFileUrl = (storyId: string, version: number, asset: string) => `/api/files/${storyAssetKey(storyId, version, asset)}`;

/** Stores a file in the draft's folder (routes/api/authoring) and returns its path for the manifest. */
export async function uploadDraftFile(storyId: string, folder: string, file: File): Promise<string> {
  const form = new FormData();
  form.set("file", file);
  form.set("folder", folder);
  const response = await fetch(`/api/authoring/stories/${storyId}/assets`, { method: "POST", body: form, headers: { "x-lifestory-upload": "1" } });
  const body = (await response.json().catch(() => ({}))) as { asset?: string; error?: string };
  if (!response.ok || !body.asset) throw new Error(body.error ?? `Upload failed (${response.status})`);
  return body.asset;
}

export interface DraftFiles {
  readonly storyId: string;
  readonly version: number;
}

/** A file input that uploads on choice and shows what the field holds now. */
export function UploadField({
  files,
  label,
  folder,
  asset,
  accept = "image/png,image/jpeg,image/webp,image/svg+xml,.svg",
  onUploaded,
}: {
  files: DraftFiles;
  label: string;
  folder: string;
  asset: string | undefined;
  accept?: string;
  onUploaded: (asset: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onUploaded(await uploadDraftFile(files.storyId, folder, file));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-1 text-xs">
      <label className="flex flex-col gap-1 font-medium">
        {label}
        <input type="file" aria-label={label} accept={accept} disabled={busy} className="text-xs" onChange={(event) => void choose(event.currentTarget)} />
      </label>
      {asset && (
        <span className="flex min-w-0 items-center gap-2" data-testid="uploaded">
          {!asset.endsWith(".woff2") && <img src={draftFileUrl(files.storyId, files.version, asset)} alt="" className="size-10 shrink-0 rounded border bg-white object-contain" />}
          <code className="text-muted-foreground truncate">{asset}</code>
        </span>
      )}
      {busy && <span>Uploading…</span>}
      {error && (
        <span role="alert" className="text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  className,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 text-xs ${className ?? ""}`}>
      {label}
      <Input type="number" step={step} value={Number.isFinite(value) ? value : ""} onChange={(event) => onChange(event.target.valueAsNumber)} className="h-8" />
    </label>
  );
}

export type Rect4 = readonly [number, number, number, number];

/** [x0, y0, x1, y1] in thousandths of the container. */
export function RectFields({ label, value, onChange }: { label: string; value: Rect4; onChange: (rect: Rect4) => void }) {
  const names = ["left", "top", "right", "bottom"] as const;
  return (
    <fieldset className="flex flex-col gap-1 text-xs">
      <legend className="mb-1 font-medium">{label} (thousandths)</legend>
      <div className="grid grid-cols-4 gap-1">
        {names.map((name, i) => (
          <NumberField
            key={name}
            label={`${label} ${name}`}
            value={value[i]!}
            onChange={(n) => onChange(value.map((v, j) => (j === i ? Math.round(n) : v)) as unknown as Rect4)}
          />
        ))}
      </div>
    </fieldset>
  );
}
