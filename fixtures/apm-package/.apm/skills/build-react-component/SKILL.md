---
name: build-react-component
description: >-
  Build or modify a React/Next.js user-interface component, including interactive state, loading states, events, and tests.
---

# React UI component

Use when building or changing a React/Next.js user-interface component.

1. Locate the owning route or component file before editing.
2. Keep client-side state minimal; derive what you can from props or server data.
3. Handle loading, empty, and error states explicitly.
4. Preserve accessible names, roles, and keyboard behavior for interactive elements.
5. Do not hard-code server-trusted values (totals, prices) into client markup.
6. Add or update a focused component test for the changed behavior.
