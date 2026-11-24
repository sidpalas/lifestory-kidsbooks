# Feature map

What Lifestory does, from the user's point of view, and how an agent proves each part works. Each feature file
answers the same questions under the same headings: **What it is**, **Routes and roles**, **Seed data**, **Verify**
(the `verify` command and what it checks), and **Gotchas**. Keep entries behaviour-level and short enough to run
without reading source. A change to a feature updates its file in the same commit; `apps/web/test/feature-map.test.ts`
fails when a file names a `verify` command that doesn't exist or lacks a heading.

The CLI: `mise run verify -- <command> [--config dev|image|live]`. `mise run verify -- help` lists commands and options.

## Configurations

<!-- oxfmt-ignore -->
| Config | What runs | Origin | Signs in as | Use it for |
| --- | --- | --- | --- | --- |
| `dev` (default) | The dev web app (`mise run dev:web`, reused if one answers) and a worker this run starts | `http://localhost:3000`, or `--port` | `parent@lifestory.dev`, or `--as <seeded email>` | Every change, first |
| `image` | The production web and worker images built from this checkout (`apps/*/Dockerfile`), migrated, against local Postgres and SeaweedFS, `/__dev` compiled out | `http://localhost:3200`, or `--port` | the same seeded accounts, by password | Bundling, Dockerfile, CSS, native modules (sharp, Chromium): what only breaks in a build |
| `live` | Nothing starts: production | `https://lifestory.devopsdirective.com` | the agent family (D38; secrets `LIFESTORY_AGENT_EMAIL`, `LIFESTORY_AGENT_PASSWORD`) | After a deploy; writes only to the agent family |

Every run uses **one origin**: the web app it drives and the worker that prints proofs from it. `doctor` (run first by
every command) fails before driving when another worker sharing the database would print from an origin where nothing
answers, when `.env` sets `PORT`, `PRINT_APP_URL`, or `BETTER_AUTH_URL`, or when the image config shares the database
with a dev worker. `e2e` (and Playwright itself, in its global setup) fails when any other worker beats on the
database: it would take the tests' tasks with its own `IMAGE_PROVIDER` and print origin, so a preview worker on real
providers would bill the tests' edits. Stop the orb's worker with `amp orb service stop worker` when it says so.

## Evidence

Every run writes `.amp/in/artifacts/verify/<time>-<command>-<config>/`: screenshots, PDFs, diffs, contact sheets, and
`report.json` (each check, pass or fail, with its detail). The last stdout line is the verdict:
`verify <command> (<config>, <origin>): PASS|FAIL n/m checks. Evidence: <dir>/`. Exit 0 pass, 1 fail, 2 usage.
Show the user the images from that directory; a PASS line with no evidence looked at is not a review.

## Features

### Accounts and families

- [app-shell](app-shell.md): sidebar, Home's next step, Stories, Our books, Sharing, Studio.
  `verify e2e -- smoke families books`.
- Sign in, invitations, set password, viewer role: covered by `e2e -- families milestone1`; no map file yet.

### Characters

- Who plays each role: a name, what the kids call them, pronouns, and an age the role accepts (D29, D56), entered
  per book on the story page and changeable in the book editor; people from the family's earlier books are offered.
  Covered by `e2e -- books milestone1`; no map file yet. Their likeness comes from a photo per book (photo-books).

### Stories and books

- [text-frames](text-frames.md): text placed in frames the author drags, resizes, and types positions for (D54).
  `verify e2e -- authoring`, `verify proof`.
- [page-previews](page-previews.md): pages fit phones and desktop in the book editor, story page, and draft
  preview, keeping their shape. `verify layout`.
- Book of a story, its cast, and the text editor: covered by `e2e -- milestone1 books`; no map file yet.
- [photo-books](photo-books.md): photos per role, the check, sheets and preview rounds, the order, page changes and
  our review (D56–D58; being built, replaces looks and parts). `verify e2e -- photo-book` once its spec lands.

### Print

- [pdf-proof](pdf-proof.md): print-ready PDF proof that matches the editor. `verify proof`.

### Authoring (operator and authors)

- Story editor (D37, book format 4): photo style, roles with outfit and stock sheet, pages with plate, figures and
  scenery, check and publish. Covered by `e2e -- authoring drafts`; no map file yet.
- [story-archive](story-archive.md): an author archives or restores a published story; existing books keep
  working. `verify e2e -- archive`.

### Whole suite

- `verify e2e [--ci] [-- <spec>]`: Playwright on one port with peak memory against the orb's cap (3 GiB on a1.small); fails first when another worker shares the database.
