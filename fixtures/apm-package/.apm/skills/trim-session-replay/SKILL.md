---
name: trim-session-replay
description: >-
  Trim an Acme Checkout session replay capture to the minimal failing interaction with masked inputs, stable timestamps, and a shareable clip.
---

# Session replay trimmer

Use when a support or QA replay capture is hours long and the failing interaction needs isolating.

1. Anchor on the failure first: locate the error event (for example `order_create_failed` on order `ord_88021` at `2026-08-14T10:31:00Z`) and keep 60s before plus 30s after; cut everything outside that window, and note the retained range in the ticket.
2. Preserve the interaction chain: include the page views, clicks, and API calls that led to the failure (cart add, address entry, checkout submit) so the clip replays the cause, not just the error frame.
3. Mask sensitive inputs in every retained frame: card numbers, emails like `buyer@example.com`, and addresses render as `•••`; verify masking frame by frame before sharing, and re-mask console-log arguments that echo form values.
4. Stabilize timestamps: convert relative offsets to absolute UTC, keep monotonic ordering, and drop duplicate heartbeat events that bloat the timeline; the trimmed clip must play start to finish without jumps.
5. Keep the clip self-contained: bundle the trimmed event JSON, console errors, and network summary (`POST /api/orders` 500, 812ms) so reviewers need no extra tooling.
6. Cap clip size at 5MB: downsample pointer-move streams to 10Hz, drop offscreen mutations, and compress snapshots; reject trims that still exceed the cap and narrow the window further, prioritizing the 60s before the failure over the tail.
7. Label the clip with session hash, merchant `merch_44012`, browser build, and capture SDK version so the same interaction can be found in raw archives.
8. Store the trimmed clip in the ticket attachment store with a 30-day expiry, not in chat or email threads; link it from the bug report, and confirm the link resolves for a reviewer without special tooling.
9. Delete the untrimmed capture once the clip is accepted, and confirm retention policy (raw captures expire in 7 days) is satisfied.
10. Never include full request bodies, auth tokens, or unmasked personal data in the trimmed output or its filename, and re-verify masking after any re-trim before re-sharing the clip.

Do not use this for analytics, funnel measurement, or permanent event logging.
