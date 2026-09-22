---
name: write-release-notes
description: >-
  Draft Acme Checkout release notes from merged pull requests with verified claims, breaking-change callouts, and rollback links.
---

# Release notes writer

Use when drafting customer- or merchant-facing notes for an Acme Checkout release.

1. Source every entry from merged PRs in the release range (for example `v2.14.0..v2.15.0`): title, PR number, and author; never invent features or copy from unmerged branches, and drop reverted PRs from the draft entirely.
2. Group entries into Added, Changed, Fixed, and Breaking; put security fixes first within Fixed with the patched versions, and keep each entry to one line plus PR link.
3. Verify every user-visible claim against the shipped behavior: flag text, endpoint path, and default values checked in staging for deploy `d_9917`; mark unverified entries `NEEDS QA` instead of publishing them.
4. Call out breaking changes explicitly with migration steps: renamed field `checkout_token` to `session_token`, affected endpoints, and a before/after request snippet using synthetic merchant `merch_44012`; lead the notes with the breaking section so upgraders cannot miss it.
5. State rollback plainly: rollback deploy id, data-migration reversibility, and any irreversible step (for example backfill `bf_5518` is forward-only); never promise a clean rollback for irreversible changes, and name the on-call runbook for the rollback path.
6. Keep voice consistent with Acme Checkout docs: concise, present tense, no superlatives, no blame; write `Fixes timeout on large carts` not `Amazing fix for our terrible bug`.
7. Link supporting material: changelog diff, migration guide, and status page for incidents fixed in the release; check every link returns 200 before publishing, and replace branch links with permanent tag links.
8. Include upgrade instructions only when action is required: dependency bumps, config keys, or webhook version changes with exact commands and example values.
9. Circulate the draft to engineering and support for a 24h review window; incorporate corrections as new commits, never by editing the published notes silently, and keep the review thread linked from the release tag.
10. Publish to one canonical location with the release tag and date; corrections after publish go in a dated Addendum section, and drafts never contain customer emails or secrets.

Do not use this for marketing announcements, internal sprint summaries, or API reference updates.
