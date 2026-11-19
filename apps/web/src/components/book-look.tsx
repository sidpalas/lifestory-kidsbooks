// How one book draws a family member, without changing the family member (D46): the character builder's picker,
// starting from their saved look, offering only what the story draws for the role, at their own age. The story page
// keeps the result in its URL until the book is made; the book editor saves it to the book.
import { castLook, type Character, type Look, type LookAxis, type LookOverride, type StoryManifest } from "@lifestory/core/contracts";
import { LookPicker } from "~/components/look-picker";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

/** The axes `look` draws differently from `saved`, never age: what a book stores. */
export const lookChanges = (saved: Look, look: Look): LookOverride =>
  Object.fromEntries((Object.keys(look) as Array<LookAxis>).filter((axis) => axis !== "age" && look[axis] !== saved[axis]).map((axis) => [axis, look[axis]]));

export function BookLookPicker({
  manifest,
  slotId,
  roleLabel,
  character,
  changes,
  onChange,
  disabled,
  note,
}: {
  manifest: StoryManifest;
  slotId: string;
  roleLabel: string;
  character: Character;
  changes: LookOverride;
  onChange: (changes: LookOverride) => void;
  disabled?: boolean;
  /** Where the change goes, for the description. */
  note: string;
}) {
  const look: Look = { ...character.look, ...changes };
  const offers = (axis: LookAxis, option: string) =>
    !castLook(manifest, slotId, { ...look, [axis]: option } as Look).unsupported.includes(axis);
  return (
    <Card data-testid={`book-look-${slotId}`}>
      <CardHeader>
        <CardTitle>
          <h2>
            {character.name}'s look in this book, as {roleLabel.toLowerCase()}
          </h2>
        </CardTitle>
        <CardDescription>
          {note} {character.name}'s saved look doesn't change. Only options this story draws are shown.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
      </CardContent>
    </Card>
  );
}
