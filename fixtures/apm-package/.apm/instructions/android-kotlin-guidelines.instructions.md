---
description: "Android Kotlin architecture, Material navigation, and Play platform conventions. Distractor for web tasks."
applyTo: "android/**/*.kt,android/**/*.kts"
tags: [android, mobile]
---

# Android / Kotlin guideline

Apply only to native Android-platform code. This rule scopes itself out of web work entirely: if the task touches only browser React/Next.js code, ignore this rule completely.

1. Prefer Jetpack Compose semantic components with Material 3 theming: use `MaterialTheme` color schemes and typography rather than hardcoded colors, and support scalable text so large-font settings do not clip checkout labels.
2. Provide TalkBack content descriptions on every icon-only control and custom canvas element; decorative images MUST be marked as such so screen readers skip them.
3. Keep asynchronous UI state in a `ViewModel` with Kotlin coroutines on the appropriate dispatcher (`Dispatchers.IO` for network/disk, `Dispatchers.Main` for UI updates). Never block the main thread with synchronous I/O or `.runBlocking` in UI code.
4. Store sensitive credentials in EncryptedSharedPreferences or the Android Keystore, never in plain `SharedPreferences`, string resources, or source files.
5. Preserve back-stack and deep-link behavior when changing flows: test the system-back gesture, predictive-back animations, and cold-start deep links into the demo merchant flow (for example `merchant_acme_demo_042` test checkouts) after every navigation change.
6. Handle configuration changes without losing checkout state: hoist state to the `ViewModel`, test rotation and dark-mode switches on the screens you touch, and never rely on `Activity` recreation to reset payment state.
7. Request runtime permissions lazily with a clear in-context rationale, and only the permissions the flow genuinely needs. A demo-merchant checkout MUST NOT require unrelated device permissions such as contacts or background location.
8. Size network payloads and images for mobile constraints: paginate merchant catalog lists, cache product thumbnails with bounded disk usage, and retry failed payment submissions with exponential backoff rather than tight loops.
9. Follow Play release discipline: version-code bumps, staged-rollout percentages, and pre-launch report checks for crashes and accessibility warnings before promoting a release track.

This rule is intentionally irrelevant to browser React/Next.js work and is included to test false-positive routing.
