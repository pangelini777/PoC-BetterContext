---
description: "Quality gates for implementation changes: targeted tests, failure-path coverage, regression protection, and meaningful verification evidence."
applyTo: "**/*"
tags: [testing, quality]
---

# Testing and quality gates

Apply during the verification phase or when adding tests.

- Add the smallest tests that would fail if the requested behavior were still wrong; avoid tests that merely execute code without discriminating the defect.
- Cover at least one meaningful failure or edge path for new boundary logic.
- Prefer deterministic tests; mock external providers at a clear boundary while preserving request/response semantics relevant to the feature.
- Do not weaken existing assertions to make a change pass.
- Run the targeted test first, then the relevant broader suite/typecheck/build when practical.
- Record the exact command and result used as completion evidence.

A green unrelated test suite is not sufficient verification for a changed payment, auth, migration, or webhook behavior.
