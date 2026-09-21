---
description: "Rules for API keys, webhook secrets, credentials, environment variables, example files, rotation, and repository safety."
applyTo: "**/*"
tags: [secrets, security]
---

# Secrets management

Apply when a task introduces or uses credentials, provider keys, signing secrets, or deployment configuration.

- Secrets belong in the runtime secret store/environment, never committed source, fixtures, screenshots, test snapshots, or documentation examples.
- `.env.example` may contain variable names and clearly fake placeholders only.
- Fail startup or the relevant feature with a clear safe error when a mandatory secret is absent; do not silently fall back to an insecure value.
- Do not print secret values in logs or CLI output.
- Keep server-only secrets out of client bundles and public-prefixed environment variables.
- When renaming or replacing a secret, document deploy ordering/rotation so old and new versions do not break each other.
