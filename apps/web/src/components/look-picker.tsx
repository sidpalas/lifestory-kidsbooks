// The look picker (brief, milestone 1 item 2; D26): start from a curated look, then change one feature at a time.
// Every choice is shown on the story-independent portrait (/api/portrait), composed on the server with the same
// parts-and-recolour pipeline as book pages; each story then draws the same option IDs with its own parts.
import { curatedLooks, type Look, type LookAxis, lookVocabulary } from "@lifestory/core/contracts";
import type * as React from "react";
import { cn } from "~/lib/utils";

export const portraitUrl = (look: Look) =>
  `/api/portrait?${new URLSearchParams({ face: look.face, skin: look.skin, hair: look.hair, hairColour: look.hairColour, glasses: look.glasses })}`;

export const axisLabels: Record<LookAxis, string> = { face: "Face", skin: "Skin tone", hair: "Hairstyle", hairColour: "Hair colour", glasses: "Extras" };

/** "Round face, medium skin, curly black hair, glasses". */
export const describeLook = (look: Look) => {
  const label = (axis: LookAxis) => lookVocabulary[axis].find((option) => option.id === look[axis])?.label ?? look[axis];
  return `${label("face")}, ${label("skin").toLowerCase()} skin, ${label("hair").toLowerCase()} ${label("hairColour").toLowerCase()} hair${look.glasses === "glasses:none" ? "" : ", glasses"}`;
};

export const ageLabel = (face: Look["face"]) => (lookVocabulary.face.find((option) => option.id === face)?.age === "child" ? "Child" : "Grown-up");

function Choice({
  pressed,
  label,
  onClick,
  disabled,
  round,
  children,
}: {
  pressed: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  round?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "overflow-hidden leading-none ring-1 ring-black/15 transition hover:ring-black/40 disabled:cursor-not-allowed disabled:opacity-50",
        round ? "rounded-full" : "rounded-md",
        pressed && "ring-2 ring-offset-2 ring-foreground hover:ring-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Thumb({ look, label }: { look: Look; label?: string }) {
  return (
    <span className="flex flex-col items-center">
      <img src={portraitUrl(look)} alt="" width={61} height={70} className="block h-[70px] w-[61px] object-cover" />
      {label && <span className="w-[61px] truncate px-0.5 py-1 text-[10px] leading-tight">{label}</span>}
    </span>
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={title} className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">{title}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

const same = (a: Look, b: Look) => (Object.keys(a) as Array<LookAxis>).every((axis) => a[axis] === b[axis]);

/** A controlled picker: `look` is the current look, `onChange` receives the next one. */
export function LookPicker({ look, onChange, disabled }: { look: Look; onChange: (look: Look) => void; disabled?: boolean }) {
  const set = (change: Partial<Look>) => onChange({ ...look, ...change });

  return (
    <div className="grid gap-6 md:grid-cols-[244px_minmax(0,1fr)]" data-testid="look-picker">
      <figure className="flex flex-col gap-2">
        <img
          src={portraitUrl(look)}
          alt={describeLook(look)}
          data-testid="look-preview"
          width={244}
          height={280}
          className="rounded-md shadow-sm ring-1 ring-black/10"
        />
        <figcaption className="text-muted-foreground text-xs" data-testid="look-summary">
          {describeLook(look)}
        </figcaption>
        <p className="text-muted-foreground text-[11px] leading-snug">
          Placeholder art from the FLUX 3 Klein experiment: one grown-up base so far, so every face shows it until the
          illustrator draws the others. Books draw each choice with their own illustrations.
        </p>
      </figure>

      <div className="flex flex-col gap-4">
        <Step title="1. Start from a look">
          {curatedLooks.map((curated) => (
            <Choice key={curated.id} pressed={same(curated.look, look)} label={`${ageLabel(curated.look.face)}: ${curated.label}`} disabled={disabled} onClick={() => onChange(curated.look)}>
              <Thumb look={curated.look} label={`${ageLabel(curated.look.face)}: ${curated.label}`} />
            </Choice>
          ))}
        </Step>
        <Step title={`2. ${axisLabels.face}`}>
          {lookVocabulary.face.map((option) => (
            <Choice key={option.id} pressed={look.face === option.id} label={`${ageLabel(option.id)}, ${option.label.toLowerCase()}`} disabled={disabled} onClick={() => set({ face: option.id })}>
              <Thumb look={{ ...look, face: option.id }} label={`${ageLabel(option.id)}, ${option.label.toLowerCase()}`} />
            </Choice>
          ))}
        </Step>
        <Step title={`3. ${axisLabels.skin}`}>
          {lookVocabulary.skin.map((option) => (
            <Choice key={option.id} round pressed={look.skin === option.id} label={`${option.label} skin`} disabled={disabled} onClick={() => set({ skin: option.id })}>
              <span className="block size-8" style={{ background: option.swatch }} />
            </Choice>
          ))}
        </Step>
        <Step title={`4. ${axisLabels.hair}`}>
          {lookVocabulary.hair.map((option) => (
            <Choice key={option.id} pressed={look.hair === option.id} label={`${option.label} hair`} disabled={disabled} onClick={() => set({ hair: option.id })}>
              <Thumb look={{ ...look, hair: option.id }} label={option.label} />
            </Choice>
          ))}
        </Step>
        <Step title={`5. ${axisLabels.hairColour}`}>
          {lookVocabulary.hairColour.map((option) => (
            <Choice key={option.id} round pressed={look.hairColour === option.id} label={`${option.label} hair colour`} disabled={disabled} onClick={() => set({ hairColour: option.id })}>
              <span className="block size-8" style={{ background: option.swatch }} />
            </Choice>
          ))}
        </Step>
        <Step title={`6. ${axisLabels.glasses}`}>
          {lookVocabulary.glasses.map((option) => (
            <Choice key={option.id} pressed={look.glasses === option.id} label={option.label} disabled={disabled} onClick={() => set({ glasses: option.id })}>
              <Thumb look={{ ...look, glasses: option.id }} label={option.label} />
            </Choice>
          ))}
        </Step>
      </div>
    </div>
  );
}
