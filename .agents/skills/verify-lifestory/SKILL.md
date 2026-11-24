---
name: verify-lifestory
description: Run the Lifestory app (dev server, production images, or the live site as the agent family) and prove a feature works with screenshots, PDFs, and pass/fail checks. Use before handing back any change to lifestory-kidsbooks, after a deploy, or to reproduce a report about family members, books, page previews, or PDF proofs.
---

# Verify Lifestory

1. Find the feature in `docs/features/README.md` and read its file: routes, roles, seed data, the `verify` command,
   and gotchas.
2. Run it: `mise run verify -- <command> --config dev` first; add `--config image` when the change touches a build,
   a Dockerfile, CSS, or a native module; `--config live` after a deploy (signs in as the agent family, D38).
   Every command runs `doctor` first and stops on a mismatched port or print origin; do what its FAIL line says.
3. Look at the evidence in the directory the last line names (`view_media` on the PNGs) and show it to the user
   with the PASS/FAIL lines. A pass you didn't look at isn't a review.
4. If the map has no command for what you changed, drive it with agent-browser through `/__dev/log-me-in/<email>`
   (AGENTS.md), then add the command to `apps/web/scripts/verify/` and a map file, so the next agent doesn't
   repeat it.
5. Full suite: `mise run verify -- e2e --ci` (add `--port 3100` when the `web` service holds :3000).

Never run `verify` against production with any account but the agent family's, and never seed it.
