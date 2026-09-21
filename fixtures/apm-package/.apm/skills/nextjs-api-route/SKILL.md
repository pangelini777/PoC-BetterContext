---
name: nextjs-api-route
description: >-
  Implement or modify a Next.js route handler with request validation, typed responses, server-only dependencies, and focused tests.
---

# Next.js API route

Use when implementing or modifying a Next.js route handler.

1. Validate all inputs server-side; never trust client-supplied totals or identifiers.
2. Return stable machine-readable error shapes with correct status codes.
3. Keep secrets and provider clients server-only; never leak them to the client bundle.
4. Use typed request/response shapes shared with callers where possible.
5. Add a focused test for the success path and at least one failure path.
