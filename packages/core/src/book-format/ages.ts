// Character ages (D29): a family member has one, a story role accepts some, and the character sheet prompt draws the
// person at that age (D56). Browser-safe.
import { Schema } from "effect";

export const ageOptions = [
  { id: "baby", label: "Baby", years: "0–1", prompt: "a baby" },
  { id: "toddler", label: "Toddler", years: "1–3", prompt: "a toddler of about two" },
  { id: "young-child", label: "Young child", years: "3–7", prompt: "a young child of about six" },
  { id: "older-child", label: "Older child", years: "8–12", prompt: "a child of about ten" },
  { id: "teen", label: "Teen", years: "13–17", prompt: "a teenager" },
  { id: "adult", label: "Adult", years: "18–64", prompt: "an adult" },
  { id: "older-adult", label: "Older adult", years: "65+", prompt: "an older adult" },
] as const;

export const Age = Schema.Literals(["baby", "toddler", "young-child", "older-child", "teen", "adult", "older-adult"]);
export type Age = typeof Age.Type;

export const ageLabel = (age: Age) => ageOptions.find((option) => option.id === age)!.label;

/**
 * Whether a person of this age has a title, what the kids call them ("Dad", "Nana"): adults only (Sid, 2026-11-25).
 * A child's title is never asked for, stored, shown or printed; `{{slot.title}}` prints their name.
 */
export const takesTitle = (age: Age) => age === "adult" || age === "older-adult";
