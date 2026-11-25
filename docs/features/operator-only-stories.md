# Operator-only stories

## What it is

The operator marks a story operator-only (D60), for testing the pipeline on a story families must never see. It stays
published (or a draft, or archived) as it was; only who sees it changes. Operators list it in Stories with an
"Operator only" badge, open its page (with a notice), read its files, and make books of it in their own family.
Everyone else gets nothing: not listed, its page is not found, its files are refused, and `createBook` answers
NotFound. Books already made of it keep working for their family.

## Routes and roles

- `/author/<storyId>`: "Make operator only" / "Show to everyone when published". Only an operator, on a story they
  wrote; a granted author gets Forbidden from the server function.
- `/author`: the story list marks it "operator only: hidden from families".
- `/stories`: listed only for operators, with the badge. `/stories/<slug>`: not found for anyone else.
- `/api/files/stories/<id>/v<n>/...`: operators and the author; members of a family with a book of that version.
- `story:import -- --author <email> --operator-only <dir>`: a new story starts operator-only.

## Seed data

None operator-only. The e2e spec imports a fresh copy of The Kite Day for the operator each run, and promotes a
throwaway account to operator for the not-the-author check; never switch seeded or production stories to try it.

## Verify

`mise run verify -- e2e -- operator-only`: the operator switches it in Studio, it stays published, the parent's
stories leave it out, its page is 404, `createBook` is NotFound, a stranger's file request is 404, a non-operator
can't switch it, the family's existing book still draws, the author operator and a second operator (not the author)
list, open, read, and book it, and switching back returns it to families.

## Gotchas

- The operator check reads `user.role = 'admin'` from the database in SQL, not the session, so promoting or demoting
  an operator takes effect on the next request.
- The author always reads their own story, so a test of the operator rule needs an operator who isn't the author.
- `--operator-only` applies when the import creates the story; an existing story keeps its setting.
