# OpenStreetMap architecture and operations

## Rendering

`src/components/OSMMap.web.tsx` renders a sandboxed Leaflet iframe. `OSMMap.tsx` uses `react-native-webview` 13.16.1, the Expo SDK 57 compatible version verified against the installed SDK matrix and versioned Expo documentation before configuring Android. Leaflet 1.9.4 is loaded from a pinned HTTPS CDN asset. The app does not depend on Google Maps or a Google key.

The map supports restaurant/customer/rider markers, fit bounds, zoom/pan, tappable or draggable address pins, in-place marker updates, optional route polylines, tile errors and network fallbacks. Browser postMessage handlers verify the source iframe; label text is not interpolated as unescaped HTML. Configured tile attribution is trusted application configuration.

## Tiles

The low-volume **web build** loads standard OSM tiles with visible linked attribution, browser caching, normal referrer behavior and no prefetch/offline downloading. This does not confer an unlimited production entitlement. Follow the current OSM Tile Usage Policy and move production to a licensed provider or your own infrastructure.

Native maps deliberately require `EXPO_PUBLIC_TILE_URL`. The WebView identifies BunkIn in its user agent, enables its normal cache and blocks mixed content. You must choose a provider that permits mobile WebView embedding and configure its exact attribution, authentication, caching and usage restrictions. Do not put privileged provider secrets into a public URL; use a scoped key or your own authenticated proxy.

A missing native provider displays a clear fallback rather than quietly scraping public community tiles. Android address entry can still be filled manually and real coordinates can be obtained via foreground GPS.

## Routing

`EXPO_PUBLIC_ROUTING_URL` points to an OSRM-compatible **owned/licensed service or proxy**. The adapter requests:

`/route/v1/driving/{fromLng},{fromLat};{toLng},{toLat}?overview=full&geometries=geojson`

The route's GeoJSON coordinate pairs are rendered by Leaflet. Before pickup a rider's target is the restaurant; after pickup it is the customer. There is no built-in spoken or turn-by-turn navigation. External `geo:` navigation is offered on Android, with an OSM directions web fallback. Compatible handlers can include OsmAnd or Organic Maps; their actual installed-app behavior still needs device acceptance testing. No public demo routing server is treated as production infrastructure.

Missing route configuration, no route, denied GPS, unavailable GPS and stale position data all have explicit states. Router travel duration is not automatically advertised as a reliable delivery ETA.

## Geocoding

`EXPO_PUBLIC_GEOCODING_URL` points to your compliant Nominatim-compatible proxy. Searches require an explicit button press (not autocomplete), at least three characters, at least 1.1 seconds between requests and a per-session result cache. The production proxy must enforce **aggregate** usage limits, identification, privacy policy and persistent caching across clients. A client-side throttle alone is not sufficient for public Nominatim compliance. Public Nominatim is not hardcoded.

Response shape: `[{display_name,lat,lon}]`. A missing geocoder offers manual address entry and map pin selection instead.

## GPS and privacy

`expo-location` 57.0.20 requests foreground permission only at the user's action. A real rider subscription uses balanced accuracy, a 15-second/25-meter cadence, cleanup on assignment change/unmount and stops when the application leaves the foreground. Demo GPS is displayed locally only and never sent as live delivery GPS. Background delivery tracking requires a separately reviewed foreground-service/background-permission implementation and is not claimed here.

Customers and owners must only receive authorized location data from their backend. The frontend cannot create that security boundary by hiding a button. Location messages are never generated from random coordinates or animated sample positions.

## References checked

- Expo SDK 57 WebView and Location reference pages.
- Installed `expo/bundledNativeModules.json` for SDK-compatible versions.
- OSM Foundation tile and Nominatim policies. Recheck current policies and your provider agreement before release.
