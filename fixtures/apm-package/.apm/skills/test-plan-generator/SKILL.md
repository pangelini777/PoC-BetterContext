---
name: test-plan-generator
description: >-
  Create and execute a focused implementation test plan that discriminates the requested behavior and covers important failure/edge paths.
---

# Test plan generator

Use when building a focused regression test plan for an implementation change.

1. List the behaviors under test, one per bullet, tied to the change.
2. Include failure and edge paths: invalid input, provider errors, duplicates, retries.
3. Prefer small deterministic tests over broad integration coverage.
4. Execute the plan and record pass/fail per item with evidence.
5. Stop at the boundary of the change; do not expand into unrelated suites.
