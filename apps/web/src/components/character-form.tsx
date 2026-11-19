// Adding or changing a family member: name, what the children call them, pronouns, and a look from the picker. Viewers see it read-only.
import { type Character, curatedLooks, type Look, PronounSet, unwrapResult } from "@lifestory/core/contracts";
import { Link, useHydrated, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { LookPicker, withPronounFeatures } from "~/components/look-picker";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { NativeSelect } from "~/components/ui/native-select";
import { saveCharacterFn, SaveCharacterResult } from "~/server/books";

/** Suggestions only: families use many words and spellings, so the field takes any text. */
const titleSuggestions = ["Mum", "Mom", "Dad", "Mama", "Papa", "Grandma", "Grandpa", "Nana", "Granny", "Abuela", "Abuelo", "Auntie", "Uncle"];

export function CharacterForm({ character, canEdit }: { character?: Character; canEdit: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [name, setName] = useState(character?.name ?? "");
  const [title, setTitle] = useState(character?.title ?? "");
  const [pronouns, setPronouns] = useState<PronounSet>(character?.pronouns ?? "she/her");
  const [look, setLook] = useState<Look>(character?.look ?? curatedLooks.find((curated) => curated.look.age === "young-child")!.look);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const locked = !hydrated || !canEdit;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      unwrapResult(SaveCharacterResult)(await saveCharacterFn({ data: { characterId: character?.id, character: { name, title: title.trim() || null, pronouns, look } } }));
      await router.navigate({ to: "/" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      <Link to="/" className="text-muted-foreground text-sm hover:underline">
        ← Home
      </Link>
      <h1 className="text-2xl font-semibold">{character ? character.name : "Add a family member"}</h1>
      {!canEdit && <p className="text-muted-foreground text-sm">You're a viewer in this family, so you can see characters but not change them.</p>}
      <form className="flex flex-col gap-6" onSubmit={save} aria-label="Character">
        <div className="flex flex-wrap gap-4">
          <div className="flex min-w-56 flex-col gap-2">
            <Label htmlFor="character-name">Name</Label>
            <Input id="character-name" value={name} required maxLength={60} disabled={locked} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="flex min-w-48 flex-col gap-2">
            <Label htmlFor="character-title">
              What the kids call them <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="character-title"
              value={title}
              maxLength={30}
              list="character-titles"
              placeholder="Dad, Nana, Abuela…"
              disabled={locked}
              onChange={(event) => setTitle(event.target.value)}
            />
            <datalist id="character-titles">
              {titleSuggestions.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="character-pronouns">Pronouns</Label>
            <NativeSelect id="character-pronouns" value={pronouns} disabled={locked} onChange={(event) => {
                const next = event.target.value as PronounSet;
                setPronouns(next);
                setLook((current) => withPronounFeatures(current, next));
              }}>
              {PronounSet.literals.map((set) => (
                <option key={set} value={set}>
                  {set}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <LookPicker look={look} pronouns={pronouns} onChange={setLook} disabled={locked} />
        {canEdit && (
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={locked || saving || name.trim() === ""}>
              {character ? "Save changes" : "Add to the family"}
            </Button>
            {character && <p className="text-muted-foreground text-xs">Every book with {character.name} redraws from the new look.</p>}
          </div>
        )}
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
