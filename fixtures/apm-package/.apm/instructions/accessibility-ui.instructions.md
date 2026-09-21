---
description: "Accessibility requirements for user-facing web UI, forms, buttons, dialogs, focus handling, labels, and keyboard behavior."
applyTo: "app/**/*.{ts,tsx,js,jsx},components/**/*.{ts,tsx,js,jsx}"
tags: [accessibility, ui]
---

# Accessibility UI rule

Apply this rule when changing user-facing web interfaces.

- Interactive controls must use native semantic elements whenever possible; a clickable action should normally be a `<button>` rather than a styled `<div>`.
- Every control needs an accessible name. Icon-only controls require an explicit label.
- Keyboard users must be able to reach and operate new controls, and focus must not become trapped or disappear after dialogs or async actions.
- Do not communicate state or errors by color alone. Associate validation errors with the relevant field and expose status changes to assistive technology when needed.
- Preserve visible focus treatment and reasonable touch/click targets.
- For loading or disabled states, keep the control semantics clear and prevent duplicate submissions without making the page inaccessible.

Before considering UI work complete, add or run a targeted accessibility check for the changed interaction.
