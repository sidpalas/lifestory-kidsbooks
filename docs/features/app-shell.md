# App shell

## What it is

The navigation around every family page (D48): a sidebar with Home, Stories, Our books, Characters, and Family
settings; bottom tabs on phones. Home shows a "Next step" card until the family has a character and a book, then
the newest book ("Pick up where you left off") and the stories. A story card opens the family's book of it, or the
story page when there are several (D47). Authors and the operator reach Studio (`/author`),
which has its own dark bar and is only for making stories. The operator also gets Admin (`/admin`), under Studio in
the sidebar: Families ("Invite a new family") and Authors (who can write stories).

## Routes and roles

- `/` (Home; signed-out visitors get the landing page), `/stories`, `/books`, `/characters`, `/characters/new`,
  `/characters/<id>`, `/family`, `/admin`. All under the `_family` layout route except Home, which renders the shell itself.
- Viewers see the same places without edit actions; "Family settings" reads "Family". Studio only for authors and
  the operator. Admin only for the operator: its loader lists authors, which the server refuses with `Forbidden` for
  anyone else, so the page is not found; inviting a family and granting or removing authors check the role again.
  On phones Admin has no link yet (operators open `/admin` directly) until the mobile menu is decided.
  Story and book pages are outside the shell.

## Seed data

- `parent@lifestory.dev` (owner), `grandparent@lifestory.dev` (viewer), `operator@lifestory.dev` (Studio, Admin).
- A new account from `/__dev/log-me-in/<email>` has no characters or books, so it shows the next-step card.

## Verify

`mise run verify -- e2e -- smoke families books milestone1`: signed-in identity and family name in the sidebar,
stories on Home, family settings at `/family`, characters at `/characters`, books at `/books`, the operator's family
invite and author grants in Admin, and `/admin` not found for a parent and for a non-operator author.

## Gotchas

- Testids for who's signed in and the family name live only in the desktop sidebar; the phone top bar repeats them
  without testids, so specs stay unambiguous.
- The shell's data (`getHome`) reloads with each navigation; keep it small.
- `/family` lists members (`member` rows) and pending invitations (`invitation` rows) apart from the invite form; a
  member whose name is their email shows it once. On phones the role pill sits under the identity; `families.spec.ts`
  checks a 320px screen with a long pending email.
