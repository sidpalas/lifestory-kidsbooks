// Text tokens: `{{slot.field}}` in a story's text names a character slot and a field,
// resolved from whoever fills the slot. Fields: `name`, `title` (what the children call them, such as "Dad";
// the name when there's none), and the pronoun forms
// `they`, `them`, `their`, `theirs`, `themself`. A capitalized field capitalizes the
// result: `{{hero.They}}` is "She" for she/her. Pronoun forms differ in verb
// agreement ("they are", "she is"), so authors write around it, as in past tense.
import type { CastMember, PronounSet, TextStyleName } from "./manifest.ts";

const pronounForms = {
  "she/her": { they: "she", them: "her", their: "her", theirs: "hers", themself: "herself" },
  "he/him": { they: "he", them: "him", their: "his", theirs: "his", themself: "himself" },
  "they/them": { they: "they", them: "them", their: "their", theirs: "theirs", themself: "themself" },
} as const satisfies Record<PronounSet, Record<string, string>>;

type Field = "name" | "title" | keyof (typeof pronounForms)["they/them"];
const fields: ReadonlySet<string> = new Set<Field>(["name", "title", "they", "them", "their", "theirs", "themself"]);

const TOKEN = /\{\{\s*([a-z][a-z0-9-]*)\.([A-Za-z]+)\s*\}\}/g;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Problems with the tokens in `content`, given the story's slot IDs. Empty when it's valid. */
export const tokenIssues = (content: string, slotIds: ReadonlySet<string>): ReadonlyArray<string> => {
  const issues: Array<string> = [];
  for (const [token, slotId, field] of content.matchAll(TOKEN)) {
    if (!slotIds.has(slotId!)) issues.push(`${token}: unknown slot "${slotId}"`);
    if (!fields.has(field!.toLowerCase())) issues.push(`${token}: unknown field "${field}"`);
  }
  const rest = content.replace(TOKEN, "");
  if (rest.includes("{{") || rest.includes("}}")) issues.push("malformed token: use {{slot.field}}");
  return issues;
};

type TextCast = Readonly<Record<string, Pick<CastMember, "name" | "title" | "pronouns">>>;

/** Replaces every token with the cast member's name, title, or pronoun. The manifest's validation guarantees tokens are known. */
export const resolveText = (content: string, cast: TextCast): string =>
  content.replace(TOKEN, (token, slotId: string, field: string) => {
    const member = cast[slotId];
    if (!member) return token;
    const key = field.toLowerCase() as Field;
    const value =
      key === "name"
        ? member.name
        : key === "title"
          ? (member.title ?? member.name)
          : pronounForms[member.pronouns][key];
    return field === key ? value : capitalize(value);
  });

/** A page's text blocks with tokens resolved for `cast`: what BookPage prints. */
export const resolvePageText = (
  page: { readonly text: ReadonlyArray<{ readonly style: TextStyleName; readonly content: string }> },
  cast: TextCast,
): ReadonlyArray<ResolvedTextBlock> =>
  page.text.map((block) => ({ style: block.style, text: resolveText(block.content, cast) }));

export interface ResolvedTextBlock {
  readonly style: TextStyleName;
  readonly text: string;
}
