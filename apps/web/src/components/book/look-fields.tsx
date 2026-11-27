// The look's attributes (D56) with their options and the control that sets one, for the photo step's confirmation and
// the People page (D61).
import { eyeColours, hairColours, hairLengths, hairTextures, type LookKey, skinTones } from "@lifestory/core/contracts";

import { NativeSelect } from "~/components/ui/native-select";

/**
 * The look's attributes as the confirmation shows them: each option with its swatch or its description (hair length
 * and texture), if it has one.
 */
const yesNo = [
  { id: true, label: "Yes" },
  { id: false, label: "No" },
] as const;
export type LookField = {
  key: LookKey;
  label: string;
  options: ReadonlyArray<{ id: string | boolean; label: string; swatch?: string; description?: string }>;
};
export const lookFields: ReadonlyArray<LookField> = [
  { key: "hairColour", label: "Hair colour", options: hairColours },
  { key: "hairLength", label: "Hair length", options: hairLengths },
  { key: "hairTexture", label: "Hair texture", options: hairTextures },
  { key: "eyeColour", label: "Eyes", options: eyeColours },
  { key: "skinTone", label: "Skin tone", options: skinTones },
  { key: "freckles", label: "Freckles", options: yesNo },
  { key: "glasses", label: "Glasses", options: yesNo },
];

/**
 * One attribute's control, as `<dd>`s for the caller's `<dl>`: a swatch, a select whose empty option (`emptyLabel`)
 * leaves the attribute to the photo, the chosen option's description, and what each option means. `onChange` gets the
 * option's id, or undefined for the empty option.
 */
export function LookSelect({
  field,
  value,
  emptyLabel,
  ariaLabel,
  idPrefix,
  disabled,
  onChange,
}: {
  field: LookField;
  value: string | boolean | null | undefined;
  emptyLabel: string;
  ariaLabel: string;
  /** Unique on the page, for the description's id. */
  idPrefix: string;
  disabled?: boolean;
  onChange: (value: string | boolean | undefined) => void;
}) {
  const selected = field.options.find((option) => option.id === value);
  const described = field.options.some((option) => option.description);
  const descriptionId = `${idPrefix}-${field.key}-description`;
  return (
    <>
      <dd className="flex items-center gap-2">
        <span
          aria-hidden
          className="size-4 shrink-0 rounded-full ring-1 ring-black/20"
          style={{ background: selected?.swatch ?? "transparent" }}
        />
        <NativeSelect
          aria-label={ariaLabel}
          aria-describedby={selected?.description ? descriptionId : undefined}
          className="h-8 min-w-0 flex-1 text-xs"
          value={value === null || value === undefined ? "" : String(value)}
          disabled={disabled}
          onChange={(event) => onChange(field.options.find((option) => String(option.id) === event.target.value)?.id)}
        >
          <option value="">{emptyLabel}</option>
          {field.options.map((option) => (
            <option key={String(option.id)} value={String(option.id)}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </dd>
      {selected?.description && (
        <dd id={descriptionId} className="text-muted-foreground" data-testid={descriptionId}>
          {selected.description}
        </dd>
      )}
      {described && (
        <dd>
          <details className="text-muted-foreground">
            <summary className="cursor-pointer underline-offset-2 hover:underline">
              What each {field.label.toLowerCase()} means
            </summary>
            <dl className="mt-1 flex flex-col gap-1.5 border-l-2 pl-2 leading-snug">
              {field.options.map((option) => (
                <div key={String(option.id)}>
                  <dt className="inline font-medium text-foreground">{option.label}:</dt>{" "}
                  <dd className="inline">{option.description}</dd>
                </div>
              ))}
            </dl>
          </details>
        </dd>
      )}
    </>
  );
}
