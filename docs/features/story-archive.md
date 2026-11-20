# Story archive

## What it is

An author takes a published story out of every family's stories, and can put it back (D49). An archived story isn't
listed, its page is not found for families, and nobody makes a new book of it. Books already made keep opening,
drawing, and printing from their pinned version; every version, addition, and file stays. Its author still sees it in
Studio and on its story page (with an "Archived" notice and no make-a-book button), drafts and publishes new versions
of it, which stay archived until restored. Nothing is deleted.

## Routes and roles

- `/author/<storyId>`: "Archive…" then "Archive the story" (with what it does spelled out), or "Restore to
  families' stories". Only the story's author, and only once it was published; a draft is already private.
- `/author`: the story list marks archived stories "archived: hidden from families".
- `/stories/<slug>`: not found for families; the author sees the notice and a "Restore it in Studio" link.
- `/api/files/stories/<id>/v<n>/...`: still served to members of a family with a book of that version.

## Seed data

None archived. The e2e spec imports a fresh copy of The Moon Picnic for the operator each run; never archive the
seeded stories or production ones to try it.

## Verify

`mise run verify -- e2e -- archive`: archive with confirmation, gone from the parent's stories, story page 404,
`createBook` refused for the family and for the author's own family, the existing book draws and its files load, a
stranger's file request is refused, restore brings it back.

## Gotchas

- `createBook` re-reads the status inside its per-family lock, so an archive landing mid-request still stops it.
- Publishing a version keeps `archived`; only "Restore" puts the story back in the catalogue.
