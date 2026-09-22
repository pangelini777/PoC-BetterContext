---
name: build-android-component
description: >-
  Build a native Android Kotlin component or screen using Jetpack Compose, Material 3, TalkBack labels, and coroutine-safe state.
---

# Android Kotlin component

Use only for native Android Kotlin work. Distractor for web tasks; never apply to Acme Checkout web UI, Next.js routes, or server-side payment flows.

1. Build screens with Jetpack Compose and Material 3 components; keep theming in one `AcmeAndroidTheme` object so light/dark contrast stays consistent, and preview every screen in both themes with `@Preview` annotations before opening a review.
2. Manage state with `ViewModel` plus `StateFlow` collected via `collectAsStateWithLifecycle()`; never hold Activity or Context references in the ViewModel.
3. Run I/O on `Dispatchers.IO` inside `viewModelScope`, and confine UI mutation to the main thread; expose loading and error states as a sealed `UiState` so Compose renders skeletons during slow catalog loads for merchant `merch_44012`, and cancel in-flight jobs in `onCleared()` to avoid leaks on rotation.
4. Support TalkBack from the start: every icon button gets a `contentDescription`, custom actions expose `semantics { }` labels, and touch targets are at least 48dp.
5. Handle configuration change and process death with `rememberSaveable` for UI state (for example selected tab `tab_orders_03`) and `SavedStateHandle` for arguments; test rotation and process recreation in the emulator rather than assuming state survives.
6. Load images with Coil using placeholder, error, and content-description fallbacks; never block composition on synchronous network or disk reads.
7. Persist small preferences with DataStore, never with blocking `SharedPreferences.commit()` on the main thread; encrypt tokens with EncryptedFile or the Keystore.
8. Request runtime permissions with the Activity Result API, showing an educational rationale screen before the system dialog; when denied, degrade gracefully, for example showing the cached catalog when location permission is refused, and deep-link to Settings on permanent denial.
9. Test with synthetic fixtures only (merchant `merch_44012`, order `ord_88021`): Robolectric for ViewModel logic, Compose UI tests with `createComposeRule()` for interaction, and screenshot tests for Material 3 variants.
10. Log only anonymized screen names and interaction counts; never log device identifiers, customer emails, or auth tokens from native code, and strip PII from crash-report breadcrumbs before upload.

Do not import web patterns (React hooks, Next.js route handlers, Stripe.js) into native code, and do not route Acme Checkout web traffic through this skill.
