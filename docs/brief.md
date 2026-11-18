# Storybook platform brief

## What this is and why

I'm building this as a realistic, fairly complex product that I'll use on my YouTube channel to test background coding agents and software factories, so it should look like a codebase a real company would have. It will be open source as a demo, I'm its only operator, and I don't expect others to deploy it.

The product: parents create custom picture books. Human authors and illustrators write the stories and draw the illustrations; AI adds the family's own members as characters in the illustrations. Parents can edit the text and adjust how their family's characters look; they don't edit the artwork itself. Later it grows into a marketplace with community ranking and community authoring with revenue share.

## Decided

- TypeScript throughout, except the image model.
- React, Tailwind, and shadcn/ui for the frontend.
- Better Auth for accounts. A family is a Better Auth organization, and members have roles; for example, a grandparent can view books but not edit them. Use its admin plugin for my operator access, without user impersonation, because accounts hold photos of children.
- Absurd (https://github.com/earendil-works/absurd) for background jobs and durable workflows on Postgres. An Absurd step can run more than once, so make every step idempotent.
- Image generation: FLUX 3 Klein in a Python function on Modal.
- Postgres, with Drizzle for schema and migrations.
- Hosting will probably start on Railway, but that isn't a requirement. Depend only on containers, Postgres, and S3-compatible object storage, with nothing host-specific.

## Recommended design

Go with these unless you hit a concrete problem:

- Web app and server: TanStack Start (React) in a pnpm monorepo. Use server functions for app calls and server routes for outside callers (Better Auth, the Modal callback). Turn off server rendering for the editor routes. There is no separate API service.
- Effect v4 is the server-side programming model: domain services, data access, and the generation worker live in a shared package as Effect services and layers, run from server functions and Absurd steps through one shared runtime. Use Effect Schema for validation, including server function input validators, instead of Zod. Keep Effect's typed errors across the server function boundary by encoding results with Schema. Effect v4 is new, so check the v4 docs instead of writing v3 patterns, and record the conventions you settle on in AGENTS.md.
- Rendering: one React page component, sized in physical units with embedded fonts, renders each page both in the editor and for print. Print PDFs come from headless Chromium (Playwright) on the server rendering that same component, and the parent approves the PDF as a proof. Don't build custom text layout or WebAssembly rendering; we'd only move to a precomputed layout if real screen-versus-print mismatches show up.
- Image generation sits behind one provider interface. A fake provider returns deterministic placeholder images and is the default in development, tests, and CI, so the whole flow runs without a GPU. This matters because the agents working on this repo run in sandboxes without GPUs.
- Generation runs as an Absurd workflow: submit the job to Modal, suspend until Modal calls back, then store the image in object storage. The workflow also suspends while the parent approves a character preview.

If one of these turns out to be wrong, tell me the evidence and what you'd do instead rather than switching on your own. Decisions should change only when new facts come up.

## Milestone 1 scope

The first version is invite-only: my family and families I invite. Build this vertical slice:

1. Sign up by invite, create a family, and invite another member with a view-only role.
2. Add family members as characters with reference photos. Photos are stored in object storage and visible only to that family.
3. A seeded sample book with human-written text and layered illustrations that have slots for characters. Use placeholder art. Define the first version of the book format that this needs.
4. Personalize the book: choose which family member fills each character slot, generate a character preview and wait for the parent to approve or adjust it (a different reference photo, or simple attributes such as hair and glasses), then generate every page through the workflow and provider, show progress, and regenerate a single page. A change to a character applies on every page.
5. Edit a page's text in the editor, with the page shown as it will print.
6. Produce a print-ready PDF proof of the whole book and download it.

## Coming later

These will be built in later milestones: payments, print ordering through a print-on-demand provider such as Lulu, the public marketplace with community ranking, community authoring with revenue share, moderation, public sign-ups, and server-rendered catalogue pages that search engines can index. Don't build them or add placeholder code for them now, but choose the data model and boundaries so they can be added without rewriting what you build. For example:

- A story, owned by its author, is separate from a family's personalized copy of it.
- The book format works for stories that people other than me publish.
- A print-ready PDF can later be attached to an order and sent to a print provider.
- Nothing assumes I'm the only author or that every user was invited.

## Done means (milestone 1)

- One command brings up the whole stack locally (Postgres, S3-compatible storage such as MinIO, the Start app, and the worker) using the fake provider.
- Typecheck, lint, unit tests, and a Playwright end-to-end test that walks the whole slice above all pass, locally and in CI.
- The Modal function is written and wired to the provider interface. I'll run it against a real GPU myself, so tell me how.
- The README covers setup, and docs/decisions.md records the decisions above plus any you make, each with its reason and what would reopen it.
- The final report shows what works with evidence (command output, plus screenshots of the editor and of a page from the PDF proof), what was decided and why, and what's left.
