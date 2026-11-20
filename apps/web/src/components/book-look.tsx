// How one book draws a family member, without changing the family member (D46): the character builder's picker,
// starting from their saved look, offering only what the story draws for the role, at their own age. The story page
// keeps the result in its URL until the book is made; the book editor saves it to the book.
import { castLook, type Character, type Look, type LookAxis, type LookOverride, type StoryManifest } from "@lifestory/core/contracts";
import type { ReactNode } from "react";
import { LookPicker } from "~/components/look-picker";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

/** The axes `look` draws differently from `saved`, never age: what a book stores. */
export const lookChanges = (saved: Look, look: Look): LookOverride =>
  Object.fromEntries((Object.keys(look) as Array<LookAxis>).filter((axis) => axis !== "age" && look[axis] !== saved[axis]).map((axis) => [axis, look[axis]]));

/** The IDs of a role's "look in this book" picker and of the button that shows and hides it. */
export const lookPickerId = (slotId: string) => `book-look-picker-${slotId}`;
export const lookToggleId = (slotId: string) => `book-look-toggle-${slotId}`;

/** Moves focus to an element by ID, such as the button that showed a picker once the picker hides. */
export const focusById = (id: string) => document.getElementById(id)?.focus();

export function BookLookPicker({
  manifest,
  slotId,
  roleLabel,
  character,
  changes,
  onChange,
  onClose,
  disabled,
  note,
}: {
  manifest: StoryManifest;
  slotId: string;
  roleLabel: string;
  character: Character;
  changes: LookOverride;
  onChange: (changes: LookOverride) => void;
  /** Hides the picker. Each choice took effect when it was made, so hiding keeps it. */
  onClose: () => void;
  disabled?: boolean;
  /** Where the change goes, and what hiding the picker does with it, for the description. */
  note: string;
}) {
  const look: Look = { ...character.look, ...changes };
  const offers = (axis: LookAxis, option: string) =>
    !castLook(manifest, slotId, { ...look, [axis]: option } as Look).unsupported.includes(axis);
  return (
    <PickerCard
      id={lookPickerId(slotId)}
      testId={`book-look-${slotId}`}
      title={`${character.name}'s look in this book, as ${roleLabel.toLowerCase()}`}
      description={`${note} ${character.name}'s saved look doesn't change. Only options this story draws are shown.`}
      closeLabel={`Done: hide ${character.name}'s look options`}
      onClose={onClose}
    >
      <LookPicker
        look={look}
        pronouns={character.pronouns}
        ages={[character.look.age]}
        offers={offers}
        disabled={disabled}
        onChange={(next) => onChange(lookChanges(character.look, { ...next, age: character.look.age }))}
      />
      {Object.keys(changes).length > 0 && (
        <Button variant="outline" size="sm" className="w-fit" disabled={disabled} onClick={() => onChange({})}>
          Use {character.name}'s saved look
        </Button>
      )}
    </PickerCard>
  );
}

/**
 * A card of look options that hides with "Done" or Escape. Choices take effect as they're made, so hiding only hides;
 * `onClose` should move focus back to the button that showed the card.
 */
export function PickerCard({
  id,
  testId,
  title,
  description,
  closeLabel,
  onClose,
  children,
}: {
  id: string;
  testId: string;
  title: string;
  description: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Card
      id={id}
      data-testid={testId}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <CardHeader className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <CardTitle>
            <h2>{title}</h2>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" className="shrink-0" aria-label={closeLabel} onClick={onClose}>
          Done
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}
