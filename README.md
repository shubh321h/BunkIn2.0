# BunkIn — good food, right here

A branded, responsive single-restaurant frontend built with React Native, Expo SDK 57, TypeScript and Expo Router. Android, iOS and web bundles are supported. The restaurant, owner, and rider interfaces share typed domain services and a centralized session.

## What is implemented

- **Customer:** onboarding, sign-up/sign-in and password-reset forms, profile, saved address selection and entry, draggable/tappable OpenStreetMap pin, search, category/price/vegetarian/availability filters, favorites, food customization, persistent cart, coupon estimates, itemized checkout, COD/provider-hosted online payment handoff, order history, reorder, full seven-stage tracking timeline, cancellation eligibility, reviews and support.
- **Owner:** role gate, team management (create/reset/disable manager and rider sign-ins), dashboard and financial breakdown, period selection, active/completed orders, accept/reject, prep time, ready-for-pickup, rider assignment and owner-managed dispatch, authorized-delivery map, menu/category editors, availability, variant/add-on editing, coupons, restaurant settings, customer/payment/refund/review/support/delivery records, responses and server-generated report export.
- **Manager:** orders, menu and dashboard. Settings, reports and team stay owner-only.
- **Rider:** role gate, owner-issued sign-in with forced first-login password change, assignments/history, pickup and customer details, external navigation, real foreground GPS with permission handling, optional routing, server-confirmed status transitions, customer OTP verification and failed-delivery reporting.
- **Shared:** original typography, locally bundled food photography/icons, responsive sidebar/native tabs, light/dark appearance, reusable forms/cards/dialogs, skeleton/loading/empty/error states, persistent local preferences, accessible control labels, and animated feedback.

## Accounts and access

BunkIn serves **one restaurant**. There is no demo or preview mode: the app needs `EXPO_PUBLIC_API_URL` and the Supabase public URL/anon key to do anything, and it says so plainly when they are missing. Nothing is fabricated on the device.

- **Customers** create their own account in the app.
- **The owner** is pre-registered once with `scripts/seed-owner.mjs`. There is exactly one owner (enforced by a unique index).
- **Managers and riders** cannot sign up. Only the owner creates their sign-ins (Owner → Team). The owner gets a one-time temporary password to hand over, and the person must choose their own password on first sign-in. The owner can reset a password or disable a sign-in at any time.
- Roles come from server-owned records only (`app_metadata`), never from anything the client sends. The app has no restaurant or rider registration, and there is no workspace switcher: each person lands in the workspace their role allows.

Setup details, the SQL migration and the reference Edge Function are in `docs/STAFF_ACCOUNTS.md`. Endpoint shapes are in `docs/BACKEND_CONTRACT.md`, which is a proposed contract: **Part 2 / the real backend was not supplied**, so its endpoint names may need adapting. Services call only the live API and never fall back to fixtures. Order tracking polls the authenticated endpoint every 15 seconds. It is polling, not a websocket subscription. GPS/ETA are absent until real source data exists.

## Run and verify

```sh
npm ci --legacy-peer-deps
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run build` runs `expo export --platform all`.

The app entry is `index.ts` → `expo-router/entry`; `src/app/_layout.tsx` wraps routes in `App.tsx` providers. Filesystem routes live under `src/app`, reusable UI under `src/components`, features under `src/screens`, and services under `src/lib`.

## Configuration

Copy `.env.example` to `.env` and supply public configuration. Rebuild after changing Expo public variables. Never ship Supabase service-role credentials, payment secrets, admin API keys, or unrestricted routing/geocoder credentials in this app.

For live service, configure:

- API base URL with HTTPS and CORS for your deployed frontend.
- Supabase public URL/anon key, redirect allowlist for `bunkin://` and your web domain, and real `/me` role lookup.
- Licensed/owned OSM-compatible tile provider, OSRM-compatible routing proxy, and a compliant geocoding proxy.
- Backend payment provider and secure hosted-payment URL. Settlement must be verified server-side by provider webhooks, never by a return URL alone.

## Android APK preparation

`app.json` includes `com.bunkin.app`, the `bunkin` scheme, original icons/splash assets, foreground coarse/fine location permissions and compatible WebView/Location modules. No Google Maps dependency or key is required. Background location is deliberately **not** requested; GPS sharing stops when the app backgrounds, and the assignment remains in the navigation state.

The SDK 57 local compatibility matrix is used for native packages, including Reanimated 4.5.1/Worklets 0.10.1, WebView 13.16.1, Location 57.0.20, Gesture Handler 2.32.0, Screens 4.26.0, Safe Area 5.7.0 and AsyncStorage 2.2.0. Dependencies are locked. Some newer remote SDK metadata advertised unpublished patch versions during setup; installed, available SDK 57 packages were retained rather than upgrading blindly.

The `preview` EAS profile produces an Android **APK**, and `production` uses EAS's production packaging. The starter EAS project/OTA owner links were removed from `app.json`. Link your own project and supply your own signing account:

```sh
npx eas-cli login
npx eas-cli init
npx eas-cli build --platform android --profile preview
```

These are owner-operated setup commands; they were not run on your behalf. **An APK was not signed or generated in this environment. No Android emulator/physical device was available.** Android JavaScript/Hermes export was verified; on-device GPS, native WebView, back gestures, keyboard and navigation-app interoperability still need the acceptance pass in `docs/ANDROID_TESTING.md`.

## Mapping and policies

See `docs/MAPPING.md`. The web build uses low-volume standard OSM raster tiles with browser caching and attribution. Native tiles require your configured provider rather than silently relying on a public community service. Routing and geocoding require configured services, with honest fallback states when unavailable. No public service is assumed to provide unlimited production access.

## Tests

- Strict TypeScript and ESLint.
- Twelve unit tests: totals, quantity/options pricing, coupon eligibility/caps, input validation, timeline completeness, and role routing/access rules.
- The earlier browser flows ran against the removed demo mode, so they were deleted. Add Playwright flows against a test backend when one exists.
- Browser tests are not a substitute for physical Android testing.

## Security boundaries

Frontend role guards improve UX, **not security**. Every backend endpoint must verify the Supabase JWT, derive roles from trusted server records, enforce the single restaurant, enforce delivery assignment/customer ownership, and sanitize returned contact data. Registration never accepts an owner/manager/rider role: the database assigns `customer` to every public sign-up, and staff accounts are created only by the owner through a server-side function that holds the service-role key. Configure RLS for any tables exposed through Supabase. Client totals and coupon eligibility are estimates only; the backend must recompute prices, enforce hours/radius/inventory/minimums and validate order-state transitions atomically.

Images are locally downloaded Unsplash photographs. Plus Jakarta Sans is bundled under the SIL Open Font License included in `assets/fonts/OFL.txt`.
