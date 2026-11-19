// The look picker (brief, milestone 1 item 2; D26, D29): pick the character's age first, start from a curated look
// of that age, then change one feature at a time. Features an age has no parts for (a baby's hairstyle, a toddler's
// glasses) aren't offered, and features (softer or defined, D40) only from teen up.
// Every choice is shown on the story-independent portrait (/api/portrait), composed on the server with the same
// parts-and-recolour pipeline as book pages; each story then draws the same option IDs with its own parts.
import { ageLabel, ageOptions, curatedLooks, hasFeatures, type Look, type LookAxis, lookVocabulary, partAxesAt, type PronounSet } from "@lifestory/core/contracts";
import type * as React from "react";
import { cn } from "~/lib/utils";

export const portraitUrl = (look: Look) =>
  `/api/portrait?${new URLSearchParams({ age: look.age, face: look.face, features: look.features, skin: look.skin, hair: look.hair, hairColour: look.hairColour, glasses: look.glasses, facialHair: look.facialHair })}`;

export const axisLabels: Record<LookAxis, string> = { age: "Age", face: "Face", features: "Features", skin: "Skin tone", hair: "Hairstyle", hairColour: "Hair colour", glasses: "Extras", facialHair: "Facial hair" };

/** "Adult, round face, defined, medium skin, curly black hair, full beard, glasses", leaving out what the age doesn't draw. */
export const describeLook = (look: Look) => {
  const label = (axis: LookAxis) => (lookVocabulary[axis] as ReadonlyArray<{ id: string; label: string }>).find((option) => option.id === look[axis])?.label ?? look[axis];
  const drawn = partAxesAt(look.age);
  const [style, colour] = [label("hair").toLowerCase(), label("hairColour").toLowerCase()];
  // "Curly black hair", but "black braids": the newer hairstyles name the hair themselves.
  const hair = !drawn.includes("hair") ? `${colour} hair` : ["hair:short", "hair:curly", "hair:long"].includes(look.hair) ? `${style} ${colour} hair` : `${colour} ${style}`;
  const glasses = drawn.includes("glasses") && look.glasses !== "glasses:none" ? ", glasses" : "";
  const facialHair = drawn.includes("facialHair") && look.facialHair !== "facial-hair:none" ? `, ${label("facialHair").toLowerCase()}` : "";
  const features = hasFeatures(look.age) ? `, ${label("features").toLowerCase()}` : "";
  return `${ageLabel(look.age)}, ${label("face").toLowerCase()}${features}, ${label("skin").toLowerCase()} skin, ${hair}${facialHair}${glasses}`;
};

export { ageLabel };

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

/**
 * Pronouns order the hairstyles, and the curated looks by their hairstyle, so the likelier ones come first. They never
 * hide an option: a boy may have long hair and a girl short (D29).
 */
const hairOrder: Record<PronounSet, ReadonlyArray<Look["hair"]>> = {
  "she/her": ["hair:long", "hair:ponytail", "hair:braids", "hair:curly", "hair:bun", "hair:afro", "hair:locs", "hair:short", "hair:buzz"],
  "he/him": ["hair:short", "hair:buzz", "hair:curly", "hair:afro", "hair:locs", "hair:long", "hair:ponytail", "hair:braids", "hair:bun"],
  "they/them": lookVocabulary.hair.map((option) => option.id),
};
/**
 * The features pronouns suggest from teen up (D40, Sid): softer for she/her, defined for he/him; they/them keeps
 * what's chosen. A default only: either is one click away.
 */
const pronounFeatures: Record<PronounSet, Look["features"] | undefined> = { "she/her": "features:soft", "he/him": "features:defined", "they/them": undefined };
export const withPronounFeatures = (look: Look, pronouns: PronounSet): Look => ({ ...look, features: pronounFeatures[pronouns] ?? look.features });

export const orderedHairstyles = (pronouns: PronounSet) =>
  lookVocabulary.hair.toSorted((a, b) => hairOrder[pronouns].indexOf(a.id) - hairOrder[pronouns].indexOf(b.id));
export const orderedCuratedLooks = (age: Look["age"], pronouns: PronounSet) =>
  curatedLooks
    .filter((curated) => curated.look.age === age)
    .toSorted((a, b) => hairOrder[pronouns].indexOf(a.look.hair) - hairOrder[pronouns].indexOf(b.look.hair));

const same = (a: Look, b: Look) => (Object.keys(a) as Array<LookAxis>).every((axis) => a[axis] === b[axis]);

/** A controlled picker: `look` is the current look, `onChange` receives the next one. */
export function LookPicker({ look, pronouns, onChange, disabled }: { look: Look; pronouns: PronounSet; onChange: (look: Look) => void; disabled?: boolean }) {
  const set = (change: Partial<Look>) => onChange({ ...look, ...change });
  const drawn = partAxesAt(look.age);
  // Steps are numbered in order, skipping the ones this age doesn't show.
  const shown: ReadonlyArray<string> = ["Age", "Start from a look", "face", ...(hasFeatures(look.age) ? ["features"] : []), "skin", ...drawn.filter((axis) => axis === "hair"), "hairColour", ...(["facialHair", "glasses"] as const).filter((axis) => drawn.includes(axis))];
  const step = (key: string, title: string) => `${shown.indexOf(key) + 1}. ${title}`;
  // Another age keeps the face, colours, and hairstyle; glasses and facial hair go when the new age doesn't draw them, and growing
  // into an age with features starts from the ones the pronouns suggest.
  const setAge = (age: Look["age"]) =>
    onChange({
      ...(hasFeatures(age) && !hasFeatures(look.age) ? withPronounFeatures(look, pronouns) : look),
      age,
      ...(partAxesAt(age).includes("glasses") ? {} : { glasses: "glasses:none" }),
      ...(partAxesAt(age).includes("facialHair") ? {} : { facialHair: "facial-hair:none" }),
    });

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
        <p className="text-muted-foreground text-[11px] leading-snug">Books draw each choice with their own illustrations.</p>
      </figure>

      <div className="flex flex-col gap-4">
        <Step title={step("Age", "Age")}>
          {ageOptions.map((option) => (
            <Choice key={option.id} pressed={look.age === option.id} label={option.label} disabled={disabled} onClick={() => setAge(option.id)}>
              <span className="block px-3 py-2 text-left text-sm">
                {option.label}
                <span className="text-muted-foreground block text-[11px]">{option.years}</span>
              </span>
            </Choice>
          ))}
        </Step>
        <Step title={step("Start from a look", "Start from a look")}>
          {orderedCuratedLooks(look.age, pronouns).map((curated) => (
              <Choice key={curated.id} pressed={same(curated.look, look)} label={curated.label} disabled={disabled} onClick={() => onChange(curated.look)}>
                <Thumb look={curated.look} label={curated.label} />
              </Choice>
            ))}
        </Step>
        <Step title={step("face", axisLabels.face)}>
          {lookVocabulary.face.map((option) => (
            <Choice key={option.id} pressed={look.face === option.id} label={option.label} disabled={disabled} onClick={() => set({ face: option.id })}>
              <Thumb look={{ ...look, face: option.id }} label={option.label} />
            </Choice>
          ))}
        </Step>
        {hasFeatures(look.age) && (
          <Step title={step("features", axisLabels.features)}>
            {lookVocabulary.features.map((option) => (
              <Choice key={option.id} pressed={look.features === option.id} label={option.label} disabled={disabled} onClick={() => set({ features: option.id })}>
                <Thumb look={{ ...look, features: option.id }} label={option.label.replace(" features", "")} />
              </Choice>
            ))}
          </Step>
        )}
        <Step title={step("skin", axisLabels.skin)}>
          {lookVocabulary.skin.map((option) => (
            <Choice key={option.id} round pressed={look.skin === option.id} label={`${option.label} skin`} disabled={disabled} onClick={() => set({ skin: option.id })}>
              <span className="block size-8" style={{ background: option.swatch }} />
            </Choice>
          ))}
        </Step>
        {drawn.includes("hair") && (
          <Step title={step("hair", axisLabels.hair)}>
            {orderedHairstyles(pronouns).map((option) => (
              <Choice key={option.id} pressed={look.hair === option.id} label={`${option.label} hair`} disabled={disabled} onClick={() => set({ hair: option.id })}>
                <Thumb look={{ ...look, hair: option.id }} label={option.label} />
              </Choice>
            ))}
          </Step>
        )}
        <Step title={step("hairColour", axisLabels.hairColour)}>
          {lookVocabulary.hairColour.map((option) => (
            <Choice key={option.id} round pressed={look.hairColour === option.id} label={`${option.label} hair colour`} disabled={disabled} onClick={() => set({ hairColour: option.id })}>
              <span className="block size-8" style={{ background: option.swatch }} />
            </Choice>
          ))}
        </Step>
        {drawn.includes("facialHair") && (
          <Step title={step("facialHair", axisLabels.facialHair)}>
            {lookVocabulary.facialHair.map((option) => (
              <Choice key={option.id} pressed={look.facialHair === option.id} label={option.label} disabled={disabled} onClick={() => set({ facialHair: option.id })}>
                <Thumb look={{ ...look, facialHair: option.id }} label={option.id === "facial-hair:none" ? "None" : option.label} />
              </Choice>
            ))}
          </Step>
        )}
        {drawn.includes("glasses") && (
          <Step title={step("glasses", axisLabels.glasses)}>
            {lookVocabulary.glasses.map((option) => (
              <Choice key={option.id} pressed={look.glasses === option.id} label={option.label} disabled={disabled} onClick={() => set({ glasses: option.id })}>
                <Thumb look={{ ...look, glasses: option.id }} label={option.label} />
              </Choice>
            ))}
          </Step>
        )}
      </div>
    </div>
  );
}
