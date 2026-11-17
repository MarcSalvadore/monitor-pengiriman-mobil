# ANTIGRAVITY WORKSPACE RULES: ZERO-OPEX DEALERSHIP PWA

## 1. ZERO-OPEX ARCHITECTURE GUARDRAILS (CRITICAL)
- **NEVER** install or import paid mapping/routing SDKs (`@googlemaps/*`, `mapbox-gl` with access tokens, Here Maps, TomTom).
- **ALL** routing and distance calculations MUST resolve against the local Dockerized **OSRM** or **Valhalla** instance backed by OpenStreetMap (`java-latest.osm.pbf`).
- **ALL** map tiles MUST use free OpenStreetMap/Carto raster or vector tiles via **MapLibre GL JS** or **Leaflet**.

## 2. TYPOGRAPHY & DESIGN SYSTEM (INTER)
- **Primary Font:** `Inter` across all UI surfaces, tables, forms, and map overlays.
- **Self-Hosted Font Asset:** Bundle `Inter` locally via `@fontsource-variable/inter` (variable `.woff2`) so typography renders offline with zero external Google Fonts CDN calls and zero Flash of Unstyled Text (FOUT).
- **Numeric Precision:** Apply `font-variant-numeric: tabular-nums` (`tabular-nums` in Tailwind) on all distances (`km`), currency amounts (`IDR`), timestamps, and payroll tables so columns align vertically.

## 3. PROGRESSIVE WEB APP (PWA) BEST PRACTICES (MDN & MICROSOFT EDGE STANDARDS)
Every frontend component and build configuration MUST satisfy these PWA engineering standards:

### App Identity & Installability
- Provide a complete `manifest.webmanifest` with `name`, `short_name`, `description`, `start_url: "/"`, `display: "standalone"`, `orientation: "any"`, `background_color`, `theme_color`, and explicit `icons` (`192x192`, `512x512` standard + `maskable` purpose variants, plus Apple touch icons).
- Include `screenshots` (`wide` desktop + `narrow` mobile) in `manifest.webmanifest` to enable richer install UI prompts on Edge/Chrome.
- Implement a non-intrusive, user-triggered **"Install App"** button in the navigation header listening to `beforeinstallprompt` (never auto-prompt aggressively on page load).

### Offline Resilience & Caching Strategy (Workbox / Vite PWA)
- Use `vite-plugin-pwa` with Workbox configured for deterministic caching:
  - **App Shell & Static Assets (JS, CSS, Inter `.woff2`, SVG icons):** `CacheFirst` / precached at build time so the app opens instantaneously (<1s) even on poor dealership showroom Wi-Fi.
  - **Reference Data (`GET /api/shops`, `GET /api/drivers`, `GET /api/od-matrix`, `GET /api/rate-cards`):** `StaleWhileRevalidate` so supervisors can immediately log deliveries and view pre-computed branch distances even during temporary internet drops.
  - **Mutations (`POST /api/deliveries`):** Implement an **IndexedDB Offline Sync Queue** (Background Sync API with fallback retry on `online` event). If a supervisor logs a delivery while offline on the dealership lot, save it locally with a `"Pending Sync"` badge and auto-flush to PostgreSQL upon reconnection.
- Provide a clean, branded `offline.html` / offline fallback banner that clearly indicates connection state without showing a browser "No Internet" dinosaur screen.

### Native-Like UX & Ergonomics (Edge & MDN Guidelines)
- **No Raw Browser Dialogs:** Never use `window.alert()`, `window.confirm()`, or `window.prompt()`. Use accessible modal dialogs and toast notifications.
- **Safe Area & Viewport Discipline:** Set `viewport-fit=cover` and respect `env(safe-area-inset-*)` padding for notched mobile devices in standalone mode. Use `100dvh` instead of `100vh`.
- **Responsive Multi-Device Layout:**
  - Desktop (`>=1024px`): Persistent left sidebar navigation + multi-column data tables + split-pane delivery logger & live map preview.
  - Tablet/Mobile (`<1024px`): Bottom tab bar navigation (`Log Delivery`, `Daily Logs`, `Payroll`, `Branches`) with minimum `44x44px` touch targets for one-handed showroom lot usage.
- **Explicit Update Lifecycle:** When a new Service Worker version is detected (`onNeedRefresh`), display a subtle toast ("New update available — Refresh") rather than force-reloading mid-form entry.

## 4. VERIFICATION GATE ENFORCEMENT
- Before marking any Bolt complete, run automated verification via Antigravity's Browser Subagent:
  1. Confirm `manifest.webmanifest` and Service Worker register without console errors.
  2. Confirm `Inter` font loads locally (`tabular-nums` verified on currency/km columns).
  3. Toggle browser DevTools **Offline Mode** and verify the App Shell loads and queued deliveries persist in IndexedDB.