# App shell

## What it is

The navigation around every family page (D48): a sidebar with Home, Stories, Our books, People (D61), and Sharing (who can open
the family's books: members and invitations); bottom tabs on phones. Who plays each role is entered per book (D56).
Home shows a "Next step" card until the family has a book, then
the newest book ("Pick up where you left off") and the stories. A story card shows the story's cover beside its
title: the cover, always page 1 (the front of a printed book, the first page of a digital one), of its newest published version, with the illustrator's stock
figures, as the story page draws it; nothing is generated for it. Each book in Our books shows its own cover the same
way: the cover page as drawn for the book (the version the parent chose), else its story version's stock figures; again nothing is generated for it, and its images are the family's
files and the pinned version's assets, under the usual file rules. A story card's button opens the family's book of it, or the
story page when there are several (D47). Authors and the operator reach Studio (`/author`),
which has its own dark bar and is only for making stories. The operator also gets Admin (`/admin`), under Studio in
the sidebar: Families ("Invite a new family") and Authors (who can write stories).

## Routes and roles

- `/` (Home; signed-out visitors get the landing page), `/stories`, `/books`, `/sharing`, `/admin`. All under the `_family` layout route except Home, which renders the shell itself.
- Viewers see the same places without edit actions. Studio only for authors and
  the operator. Admin only for the operator: its loader lists authors, which the server refuses with `Forbidden` for
  anyone else, so the page is not found; inviting a family and granting or removing authors check the role again.
  On phones the top bar holds the logo, the family name, and a Menu button (the account's initial and a down arrow in an outlined pill); its sheet holds who's signed in, the
  family switcher (past one family), Studio, Admin, and Sign out, each only for whom it applies.
  Story and book pages are outside the shell.

## Seed data

- `parent@lifestory.dev` (owner), `grandparent@lifestory.dev` (viewer), `operator@lifestory.dev` (Studio, Admin).
- A new account from `/__dev/log-me-in/<email>` has no books, so it shows the next-step card.

## Verify

`mise run verify -- e2e -- smoke families books milestone1 stories`: signed-in identity and family name in the sidebar,
stories on Home, each story card's cover (newest published version's cover page, desktop and 320 px), each book's cover in Our books (stock, chosen drawn page; desktop and 320 px; an outsider can't load it), Sharing at
`/sharing`, books at `/books`, the operator's family invite and author grants in Admin, and `/admin` not found for a parent and for a non-operator author; on a phone,
the Menu sheet's switcher, Sign out, Studio and Admin links.

## Gotchas

- Testids for who's signed in and the family name live only in the desktop sidebar; the phone top bar and Menu sheet
  repeat them without testids, so specs stay unambiguous. The sheet is a native `<dialog>` opened with `showModal()`,
  so Esc and focus containment come from the browser; a click on its backdrop closes it.
- The story list's columns follow the room it has, not the window: from 768 px the sidebar takes 224 px, so two columns
  there squeezed the summary to a word per line and pushed the button out of the card. A card is at least 22rem
  wide. `stories.spec.ts` checks the card from 1440 down to 320 px with `expectContained` (`e2e/layout.ts`), which
  catches content sticking out of a card even when the page doesn't scroll sideways.
- Buttons wrap a label longer than their container instead of overflowing it (`ui/button.tsx`: sizes are minimum
  heights). Override a button's height with `min-h-*`, not `h-*`, and let a row of several buttons `flex-wrap`.
- Studio's bar says "Studio" alone under 640 px so it stays one line; `authoring.spec.ts` checks it at 320 px.
- The shell's data (`getHome`) reloads with each navigation; keep it small.
- `/sharing` lists members (`member` rows) and pending invitations (`invitation` rows) apart from the invite form; a
  member whose name is their email shows it once. On phones the role pill sits under the identity; `families.spec.ts`
  checks a 320px screen with a long pending email.
