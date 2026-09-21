---
description: "iOS-specific SwiftUI architecture, accessibility, navigation, and Apple platform conventions. Distractor for web tasks."
applyTo: "ios/**/*.swift,**/*.swift"
tags: [ios, mobile]
---

# iOS / SwiftUI guideline

Apply only to native Apple-platform code.

- Prefer SwiftUI semantic controls, Dynamic Type, VoiceOver labels, and platform navigation conventions.
- Keep asynchronous UI state on the appropriate actor and avoid blocking the main thread.
- Use Keychain for sensitive credentials rather than preferences or source files.
- Preserve back navigation and deep-link behavior when changing flows.

This rule is intentionally irrelevant to browser React/Next.js work and is included to test false-positive routing.
