// Text tokens: `{{slot.field}}` in a story's text names a character slot and a field,
// resolved from whoever fills the slot. Fields: `name`, `title` (what the children call them, such as "Dad";
// the name when there's none), and the pronoun forms
// `they`, `them`, `their`, `theirs`, `themself`. A capitalized field capitalizes the
// result: `{{hero.They}}` is "She" for she/her.
//
// A verb after a pronoun agrees with it: "she knows" but "they know". `{{slot:singular|plural}}` prints the first
// choice for she/her and he/him and the second for they/them, as typed: `{{hero.they}} {{hero:knows|know}}`,
// `{{hero.they}}{{hero:’s|’re}} here`. `agreementIssues` finds a verb after `{{slot.they}}` written for only one of
// them, which publishing refuses (it isn't a decoding rule, so versions stored before it stay readable).
import type { CastMember, PronounSet, TextStyleName } from "./manifest.ts";

const pronounForms = {
  "she/her": { they: "she", them: "her", their: "her", theirs: "hers", themself: "herself" },
  "he/him": { they: "he", them: "him", their: "his", theirs: "his", themself: "himself" },
  "they/them": { they: "they", them: "them", their: "their", theirs: "theirs", themself: "themself" },
} as const satisfies Record<PronounSet, Record<string, string>>;

type Field = "name" | "title" | keyof (typeof pronounForms)["they/them"];
const fields: ReadonlySet<string> = new Set<Field>(["name", "title", "they", "them", "their", "theirs", "themself"]);

// `{{slot.field}}` (groups 1 and 2) or `{{slot:singular|plural}}` (groups 1, 3 and 4).
const TOKEN = /\{\{\s*([a-z][a-z0-9-]*)(?:\.([A-Za-z]+)|:([^{}|]*)\|([^{}|]*))\s*\}\}/g;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Problems with the tokens in `content`, given the story's slot IDs. Empty when it's valid. */
export const tokenIssues = (content: string, slotIds: ReadonlySet<string>): ReadonlyArray<string> => {
  const issues: Array<string> = [];
  for (const [token, slotId, field, singular, plural] of content.matchAll(TOKEN)) {
    if (!slotIds.has(slotId!)) issues.push(`${token}: unknown slot "${slotId}"`);
    if (field !== undefined && !fields.has(field.toLowerCase())) issues.push(`${token}: unknown field "${field}"`);
    if (field === undefined && singular!.trim() === "" && plural!.trim() === "")
      issues.push(`${token}: write the singular and plural forms, as in {{${slotId}:knows|know}}`);
  }
  const rest = content.replace(TOKEN, "");
  if (rest.includes("{{") || rest.includes("}}"))
    issues.push("malformed token: use {{slot.field}}, or {{slot:singular|plural}} for a verb");
  return issues;
};

// Verbs whose singular and plural forms differ other than by an -s. Lowercase, with straight apostrophes.
const singularToPlural: Readonly<Record<string, string>> = {
  is: "are",
  was: "were",
  has: "have",
  does: "do",
  "isn't": "aren't",
  "wasn't": "weren't",
  "hasn't": "haven't",
  "doesn't": "don't",
};
const pluralToSingular = Object.fromEntries(Object.entries(singularToPlural).map(([s, p]) => [p, s]));

// Words that can stand between a pronoun and its verb ("she always knows"); words ending in -ly count too.
const ADVERB = /^(?:always|sometimes|never|still|just|also|even|often|almost|already|soon|now|then|too|\p{L}+ly)$/iu;

/** The plural of a present-tense verb ending in -s: "knows" → "know", "watches" → "watch", "cries" → "cry". */
const pluralOf = (verb: string) =>
  verb
    .replace(/ies$/i, "y")
    .replace(/(ch|sh|ss|x|z|o)es$/i, "$1")
    .replace(/(?<!s)s$/i, "");

/**
 * Verbs that agree with only some pronouns: after `{{slot.they}}`, a verb that reads right for she/he but not they
 * ("knows", "has", "is", "’s") or the other way round ("are", "have", "’re"), and a verb choice right after a name or
 * title, which is singular whoever it is. Each issue suggests the `{{slot:singular|plural}}` to write instead.
 * Present-tense verbs without an -s ("they know") can't be told from other words, so those aren't caught.
 */
export const agreementIssues = (content: string): ReadonlyArray<string> => {
  const issues: Array<string> = [];
  const tokens = [...content.matchAll(TOKEN)];
  tokens.forEach((match, i) => {
    const [token, slotId, field] = match;
    const after = content.slice(match.index + token.length, tokens[i + 1]?.index ?? content.length);
    if (field === undefined) {
      const previous = tokens[i - 1];
      if (!previous) return;
      const between = content.slice(previous.index + previous[0].length, match.index);
      if (previous[1] === slotId && /^(name|title)$/i.test(previous[2] ?? "") && /^\s*$/.test(between))
        issues.push(
          `${previous[0]} ${token}: a ${previous[2]!.toLowerCase()} is singular for everyone; write the singular verb, or {{${slotId}.they}} ${token}`,
        );
      return;
    }
    if (field.toLowerCase() !== "they") return;
    const contraction = /^([’'])(s|re|ve)(?!\p{L})/u.exec(after);
    if (contraction) {
      const [written, mark, ending] = contraction;
      const choice = ending === "s" ? `${mark}s|${mark}re` : `${mark}s|${written}`;
      issues.push(`${token}${written}: write ${token}{{${slotId}:${choice}}} so it reads right for she, he and they`);
      return;
    }
    // The first word of the clause after the pronoun that isn't an adverb: its verb.
    const words = (/^[\s\p{L}’']*/u.exec(after)![0].match(/[\p{L}’']+/gu) ?? []).filter((w) => !ADVERB.test(w));
    if (!/^\s/.test(after) || words.length === 0) return;
    const verb = words[0]!;
    const key = verb.toLowerCase().replaceAll("’", "'");
    const typed = (form: string) => (verb.includes("’") ? form.replaceAll("'", "’") : form);
    const between = after.slice(0, after.indexOf(verb));
    const singular = singularToPlural[key] !== undefined || (/s$/i.test(key) && !/ss$/i.test(key) && key.length > 2);
    if (singular) {
      const plural = typed(singularToPlural[key] ?? pluralOf(verb));
      issues.push(
        `${token}${between}${verb}: reads "they ${verb}" for they/them; write ${token}${between}{{${slotId}:${verb}|${plural}}}`,
      );
    } else if (pluralToSingular[key] !== undefined) {
      issues.push(
        `${token}${between}${verb}: reads "she ${verb}" for she/her; write ${token}${between}{{${slotId}:${typed(pluralToSingular[key])}|${verb}}}`,
      );
    }
  });
  return issues;
};

/** `agreementIssues` for every paragraph of a story's pages, each with its page ID. */
export const storyAgreementIssues = (
  pages: ReadonlyArray<{
    readonly pageId: string;
    readonly frames: ReadonlyArray<{ readonly paragraphs: ReadonlyArray<{ readonly content: string }> }>;
  }>,
): ReadonlyArray<string> =>
  pages.flatMap((page) =>
    page.frames.flatMap((frame) =>
      frame.paragraphs.flatMap((block) => agreementIssues(block.content).map((issue) => `${page.pageId}: ${issue}`)),
    ),
  );

type TextCast = Readonly<Record<string, Pick<CastMember, "name" | "title" | "pronouns">>>;

/** Replaces every token with the cast member's name, title, pronoun, or verb form. The manifest's validation guarantees tokens are known. */
export const resolveText = (content: string, cast: TextCast): string =>
  content.replace(
    TOKEN,
    (token, slotId: string, field: string | undefined, singular: string | undefined, plural: string | undefined) => {
      const member = cast[slotId];
      if (!member) return token;
      if (field === undefined) return (member.pronouns === "they/them" ? plural! : singular!).trim();
      const key = field.toLowerCase() as Field;
      const value =
        key === "name"
          ? member.name
          : key === "title"
            ? (member.title ?? member.name)
            : pronounForms[member.pronouns][key];
      return field === key ? value : capitalize(value);
    },
  );

/** A page's paragraphs in reading order (pageText) with tokens resolved for `cast`: what BookPage prints. */
export const resolvePageText = (
  page: {
    readonly frames: ReadonlyArray<{
      readonly paragraphs: ReadonlyArray<{ readonly style: TextStyleName; readonly content: string }>;
    }>;
  },
  cast: TextCast,
): ReadonlyArray<ResolvedTextBlock> =>
  page.frames.flatMap((frame) =>
    frame.paragraphs.map((block) => ({ style: block.style, text: resolveText(block.content, cast) })),
  );

export interface ResolvedTextBlock {
  readonly style: TextStyleName;
  readonly text: string;
}
