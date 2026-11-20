// The look picker (brief, milestone 1 item 2; D26, D29, D50): age first, then one feature at a time in a fixed
// order (skin tone, face, features, hairstyle, hair colour, facial hair, extras), each choice changing only its own
// axis, so working down the list never undoes what's above or below. Features an age has no parts for (a baby's
// hairstyle, a toddler's glasses) aren't offered, and features (softer or defined, D40) only from teen up.
// Every choice is shown on the story-independent portrait (/api/portrait), composed on the server with the same
// parts-and-recolour pipeline as book pages; each story then draws the same option IDs with its own parts.
// The signed-out landing demo passes `portrait` to draw from static layers instead (landing-look-demo.tsx).
import { ageLabel, ageOptions, hasFeatures, type Look, type LookAxis, lookVocabulary, partAxesAt, type PronounSet } from "@lifestory/core/contracts";
import type * as React from "react";
import { useRef } from "react";
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
        "flex flex-col overflow-hidden leading-none ring-1 ring-black/15 transition hover:ring-black/40 disabled:cursor-not-allowed disabled:opacity-50",
        round ? "rounded-full" : "rounded-md",
        pressed && "ring-2 ring-offset-2 ring-foreground hover:ring-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Draws a look's portrait at a size; the signed-in picker loads /api/portrait, the landing demo stacks static layers. */
export type Portrait = (props: { look: Look; alt: string; width: number; height: number; className?: string; testId?: string }) => React.ReactNode;

const ServerPortrait: Portrait = ({ look, testId, ...props }) => <img src={portraitUrl(look)} data-testid={testId} {...props} />;

function Thumb({ look, label, portrait: Portrait }: { look: Look; label?: string; portrait: Portrait }) {
  return (
    <span className="flex flex-col items-center">
      <Portrait look={look} alt="" width={61} height={70} className="block h-[70px] w-[61px] object-cover" />
      {label && <span className="w-[61px] px-0.5 py-1 text-center text-[10px] leading-tight text-balance">{label}</span>}
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
 * Pronouns order the hairstyles, so the likelier ones come first. They never hide an option: a boy may have long hair
 * and a girl short (D29).
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

/**
 * A controlled picker: `look` is the current look, `onChange` receives the next one. `ages` limits the ages offered,
 * such as to the ones a story role accepts.
 */
export function LookPicker({
  look,
  pronouns,
  onChange,
  disabled,
  ages,
  offers,
  portrait = ServerPortrait,
}: {
  look: Look;
  pronouns: PronounSet;
  onChange: (look: Look) => void;
  disabled?: boolean;
  ages?: ReadonlyArray<Look["age"]>;
  /** Whether to offer `option` for `axis`, such as only what a story draws (D46). Every option by default. */
  offers?: (axis: LookAxis, option: string) => boolean;
  portrait?: Portrait;
}) {
  const Portrait = portrait;
  const set = (change: Partial<Look>) => onChange({ ...look, ...change });
  const offered = <T extends { id: string }>(axis: LookAxis, options: ReadonlyArray<T>) => (offers ? options.filter((option) => offers(axis, option.id)) : options);
  const drawn = partAxesAt(look.age);
  // Steps are numbered in order, skipping the ones this age doesn't show.
  const shown: ReadonlyArray<string> = ["Age", "skin", "face", ...(hasFeatures(look.age) ? ["features"] : []), ...drawn.filter((axis) => axis === "hair"), "hairColour", ...(["facialHair", "glasses"] as const).filter((axis) => drawn.includes(axis))];
  const step = (key: string, title: string) => `${shown.indexOf(key) + 1}. ${title}`;
  // Glasses and facial hair chosen at an age that draws them, kept while another age hides them (D50).
  const hidden = useRef<Partial<Pick<Look, "glasses" | "facialHair">>>({});
  // Another age keeps the face, colours, and hairstyle, and growing into an age with features starts from the ones
  // the pronouns suggest. Glasses and facial hair go to none while the new age doesn't draw them, so the look never
  // holds a choice the parent can't see (a page pinned to an older age would draw it), and come back with an age
  // that draws them.
  const setAge = (age: Look["age"]) => {
    const next: Look = { ...(hasFeatures(age) && !hasFeatures(look.age) ? withPronounFeatures(look, pronouns) : look), age };
    for (const [axis, none] of [["glasses", "glasses:none"], ["facialHair", "facial-hair:none"]] as const) {
      if (!partAxesAt(age).includes(axis)) {
        if (look[axis] !== none) hidden.current = { ...hidden.current, [axis]: look[axis] };
        Object.assign(next, { [axis]: none });
      } else if (!partAxesAt(look.age).includes(axis) && hidden.current[axis]) {
        Object.assign(next, { [axis]: hidden.current[axis] });
        hidden.current = { ...hidden.current, [axis]: undefined };
      }
    }
    onChange(next);
  };

  return (
    <div className="grid gap-6 md:grid-cols-[244px_minmax(0,1fr)]" data-testid="look-picker">
      <figure className="flex flex-col gap-2">
        <Portrait look={look} alt={describeLook(look)} testId="look-preview" width={244} height={280} className="rounded-md shadow-sm ring-1 ring-black/10" />
        <figcaption className="text-muted-foreground text-xs" data-testid="look-summary">
          {describeLook(look)}
        </figcaption>
        <p className="text-muted-foreground text-[11px] leading-snug">Books draw each choice with their own illustrations.</p>
      </figure>

      <div className="flex flex-col gap-4">
        <Step title={step("Age", "Age")}>
          {ageOptions.filter((option) => !ages || ages.includes(option.id)).map((option) => (
            <Choice key={option.id} pressed={look.age === option.id} label={option.label} disabled={disabled} onClick={() => setAge(option.id)}>
              <span className="block px-3 py-2 text-left text-sm">
                {option.label}
                <span className="text-muted-foreground block text-[11px]">{option.years}</span>
              </span>
            </Choice>
          ))}
        </Step>
        <Step title={step("skin", axisLabels.skin)}>
          {offered("skin", lookVocabulary.skin).map((option) => (
            <Choice key={option.id} round pressed={look.skin === option.id} label={`${option.label} skin`} disabled={disabled} onClick={() => set({ skin: option.id })}>
              <span className="block size-8" style={{ background: option.swatch }} />
            </Choice>
          ))}
        </Step>
        <Step title={step("face", axisLabels.face)}>
          {offered("face", lookVocabulary.face).map((option) => (
            <Choice key={option.id} pressed={look.face === option.id} label={option.label} disabled={disabled} onClick={() => set({ face: option.id })}>
              <Thumb portrait={Portrait} look={{ ...look, face: option.id }} label={option.label} />
            </Choice>
          ))}
        </Step>
        {hasFeatures(look.age) && (
          <Step title={step("features", axisLabels.features)}>
            {offered("features", lookVocabulary.features).map((option) => (
              <Choice key={option.id} pressed={look.features === option.id} label={option.label} disabled={disabled} onClick={() => set({ features: option.id })}>
                <Thumb portrait={Portrait} look={{ ...look, features: option.id }} label={option.label.replace(" features", "")} />
              </Choice>
            ))}
          </Step>
        )}
        {drawn.includes("hair") && (
          <Step title={step("hair", axisLabels.hair)}>
            {offered("hair", orderedHairstyles(pronouns)).map((option) => (
              <Choice key={option.id} pressed={look.hair === option.id} label={`${option.label} hair`} disabled={disabled} onClick={() => set({ hair: option.id })}>
                <Thumb portrait={Portrait} look={{ ...look, hair: option.id }} label={option.label} />
              </Choice>
            ))}
          </Step>
        )}
        <Step title={step("hairColour", axisLabels.hairColour)}>
          {offered("hairColour", lookVocabulary.hairColour).map((option) => (
            <Choice key={option.id} round pressed={look.hairColour === option.id} label={`${option.label} hair colour`} disabled={disabled} onClick={() => set({ hairColour: option.id })}>
              <span className="block size-8" style={{ background: option.swatch }} />
            </Choice>
          ))}
        </Step>
        {drawn.includes("facialHair") && (
          <Step title={step("facialHair", axisLabels.facialHair)}>
            {offered("facialHair", lookVocabulary.facialHair).map((option) => (
              <Choice key={option.id} pressed={look.facialHair === option.id} label={option.label} disabled={disabled} onClick={() => set({ facialHair: option.id })}>
                <Thumb portrait={Portrait} look={{ ...look, facialHair: option.id }} label={option.id === "facial-hair:none" ? "None" : option.label} />
              </Choice>
            ))}
          </Step>
        )}
        {drawn.includes("glasses") && (
          <Step title={step("glasses", axisLabels.glasses)}>
            {offered("glasses", lookVocabulary.glasses).map((option) => (
              <Choice key={option.id} pressed={look.glasses === option.id} label={option.label} disabled={disabled} onClick={() => set({ glasses: option.id })}>
                <Thumb portrait={Portrait} look={{ ...look, glasses: option.id }} label={option.label} />
              </Choice>
            ))}
          </Step>
        )}
      </div>
    </div>
  );
}
