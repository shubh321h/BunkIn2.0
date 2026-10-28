# Android acceptance checklist

## Verification performed in this environment

- Strict TypeScript, ESLint, seven unit tests and fourteen browser interaction flows.
- Responsive browser checks at 390 × 844 and desktop widths.
- Production export for **Android, iOS and web**, including Android Hermes bytecode generation.
- SDK 57 native-module version alignment using the installed SDK compatibility matrix.

No Android emulator, physical device, signing credentials or backend was supplied. **The steps below are pending device/integration tests, not completed test claims.**

## Before installing

1. Configure your real Supabase URL/public key, API, redirect allowlist, tiles, routing and geocoding.
2. Link your own EAS project and build `preview` for an APK; install it on Android 13+ and one older supported Android version.
3. Test with customer, owner, rider and deliberately unauthorized accounts.

## Navigation and UI

- First launch splash, onboarding completion, skip/back behavior and persisted onboarding flag.
- All five customer tabs, owner/rider navigation, product back navigation and Android hardware back.
- Modal dismissal, keyboard resize, form scrolling, large-font accessibility and touch targets.
- Food imagery offline after cache, menu retries, sold-out controls, variants/add-ons, favorites, bag persistence, coupon minimum revalidation and empty state.
- Dark appearance, rotation restrictions and small/large Android screens.

## Auth and backend

- Registration with email verification, password login/reset, PKCE deep links, expired-session refresh and logout.
- A customer cannot open owner or rider data; direct API calls also return 403.
- Required checkout fields, server pricing/minimum/radius/hours/stock validation, idempotent retry and COD confirmation.
- Actual hosted online payment success, provider cancellation, failure, pending settlement, verified payment webhook and refund-pending/refunded statuses.
- Owner accept/reject reason, preparation time, inventory editing, category save, rider reassignment, owner-managed delivery and verified cash reconciliation.

## Maps and rider

- Licensed raster tiles load in Android WebView with visible/clickable OSM attribution.
- Drag/tap address pin and confirm persisted coordinates.
- GPS granted, denied, permanently denied, disabled and poor-accuracy scenarios.
- Geocoder unavailable, routing unavailable, no GPS, stale GPS and network loss/reconnect.
- Foreground GPS reaches only the authorized assignment, and stops on background/unmount.
- Customer/owner see real GPS updates; no timestamp or ETA appears when data is absent/unreliable.
- Open OsmAnd/Organic Maps via geo intent, route to pickup/customer, return with the assignment intact.
- Verify OTP failures and rate limits, successful delivery, customer-unavailable escalation and revoked contact access after delivery.

## Release gate

Do not call the app production-ready until the actual Part 2 contract, all authorization rules, on-device WebView/navigation interoperability, live payment provider, location privacy policy and the above checks have passed.
