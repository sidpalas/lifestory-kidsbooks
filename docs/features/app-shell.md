# App shell

## What it is

The navigation around every family page (D48): a sidebar with Home, Stories, Our books, Characters, and Family
settings; bottom tabs on phones. Home shows a "Next step" card until the family has a character and a book, then
the newest book ("Pick up where you left off") and the stories. A story card opens the family's book of it, or the
story page when there are several (D47). Authors and the operator reach Studio (`/author`),
which has its own dark bar and holds the operator's "Invite a new family".

## Routes and roles

- `/` (Home; signed-out visitors get the landing page), `/stories`, `/books`, `/characters`, `/characters/new`,
  `/characters/<id>`, `/family`. All under the `_family` layout route except Home, which renders the shell itself.
- Viewers see the same places without edit actions; "Family settings" reads "Family". Studio only for authors and
  the operator. Story and book pages are outside the shell.

## Seed data

- `parent@lifestory.dev` (owner), `grandparent@lifestory.dev` (viewer), `operator@lifestory.dev` (Studio).
- A new account from `/__dev/log-me-in/<email>` has no characters or books, so it shows the next-step card.

## Verify

`mise run verify -- e2e -- smoke families books milestone1`: signed-in identity and family name in the sidebar,
stories on Home, family settings at `/family`, characters at `/characters`, books at `/books`, the operator's family
invite in Studio.

## Gotchas

- Testids for who's signed in and the family name live only in the desktop sidebar; the phone top bar repeats them
  without testids, so specs stay unambiguous.
- The shell's data (`getHome`) reloads with each navigation; keep it small.
