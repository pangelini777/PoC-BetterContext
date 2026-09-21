---
description: "Brand and product-copy rules for customer-facing web UI, calls to action, labels, and transactional language."
applyTo: "app/**/*.{ts,tsx,js,jsx},components/**/*.{ts,tsx,js,jsx}"
tags: [brand, copy, ui]
---

# Brand UI copy rule

Use for customer-visible product copy and interface labels.

- Voice is concise, calm, concrete, and action-oriented. Avoid hype, superlatives, jokes during error states, and internal implementation terminology.
- Prefer verbs that describe the next action: `Continue to payment`, `Save address`, `Try again`.
- Do not claim an operation succeeded before the server confirms it.
- Error copy should state what happened and what the user can do next without exposing stack traces, provider error codes, or secrets.
- Payment copy must not imply that a card has been charged until payment is confirmed.
- Keep primary calls to action under 32 characters where practical.

When a change introduces or materially modifies customer-facing copy, review all new strings together for consistency.
