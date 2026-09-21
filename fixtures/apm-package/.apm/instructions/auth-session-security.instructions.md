---
description: "Authentication and session security rules for login, OAuth, cookies, tokens, redirects, and authorization checks."
applyTo: "app/api/auth/**/*.ts,auth/**/*.ts,lib/auth/**/*.ts"
tags: [security, auth]
---

# Authentication and session security

Apply to authentication, OAuth, sessions, tokens, and authorization.

- Treat authentication and authorization as separate checks; an authenticated user is not automatically authorized for every resource.
- Session identifiers and tokens must not be logged or returned in diagnostic payloads.
- Cookies carrying sessions should use secure defaults appropriate to deployment, including HttpOnly and SameSite behavior.
- OAuth redirect targets must be allow-listed or derived from trusted configuration; never accept arbitrary redirect URLs from untrusted input.
- Validate state/nonce or equivalent anti-forgery mechanisms for external auth flows.
- Token expiry and refresh behavior must fail closed.

Add tests for unauthorized access and the most relevant invalid/expired credential path.
