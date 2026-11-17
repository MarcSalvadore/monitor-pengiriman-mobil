Below is the comprehensive **System Architecture and Component Design Specification** for your Jabodetabek Automotive Dealership Delivery & Payroll PWA. It adapts the proven architecture from your previous project (`flower-shop-commerce`) while upgrading it for zero-OpEx self-hosted routing, multi-branch operations, immutable payroll auditing, and PWA offline resilience.

---

## 1. High-Level Architecture & Connectivity

The application follows a **Decoupled Client-Server PWA Architecture**, containerized via Docker for zero external service dependencies and zero monthly OpEx.

```
┌────────────────────────────────────────────────────────────────────────┐
│ CLIENT TIER: Supervisor Progressive Web App (PWA)                      │
│ (React + Vite + Tailwind CSS + MapLibre/Leaflet + IndexedDB Queue)     │
├───────────────────────────────────┬────────────────────────────────────┤
│ Service Worker (Workbox)          │ Offline Queue (IDB)                │
│ • App Shell Pre-caching (CacheFirst)│ • Queued Delivery POSTs (Sync)    │
│ • Reference Data (StaleWhileReval)│ • Auto-replay on 'online' event    │
└────────────────┬──────────────────┴─────────────────┬──────────────────┘
                 │ HTTP / REST                        │ Offline Mutation Sync
                 ▼                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ APPLICATION TIER: Backend API Server (Node.js / Express or FastAPI)    │
├────────────────────────────────────────────────────────────────────────┤
│ • Authentication & RBAC (Supervisor vs. Admin / Finance)               │
│ • Deterministic Payroll Calculator (Tiered IDR Rate Cards)             │
│ • OD Matrix Lookup / Real-time OSRM Proxy                              │
└──────┬──────────────────────┬──────────────────────┬───────────────────┘
       │                      │                      │
       ▼                      ▼                      ▼
┌──────────────┐       ┌──────────────┐       ┌──────────────────────────┐
│ POSTGRESQL + │       │ LOCAL OSRM   │       │ LOCAL OSRM               │
│ POSTGIS DB   │       │ TOLL ROUTER  │       │ NON-TOLL ROUTER          │
│ • 10+ Shops  │       │ (Port 5000)  │       │ (Port 5001)              │
│ • Rate Cards │       └──────────────┘       └──────────────────────────┘
│ • Audit Logs │              ▲                       ▲
└──────────────┘              └───────────────────────┘
                                         │
                         Geofabrik Java Island OSM Extract (.osm.pbf)

```

---

## 2. Component Usage & Data Flow Matrix

| Component Layer | Component Name | Role & Usage | Data Source / Destination |
| --- | --- | --- | --- |
| **Frontend UI** | `DeliveryMap` / `PickupMap` | Interactive Leaflet map (with locally bundled marker icons) for selecting delivery coordinates or adjusting shop pins.

 | Nominatim API (online) or cached tile store / manual pin drop (offline). |
| **Frontend UI** | `QuickDeliveryForm` | 3-click supervisor form (Driver $\rightarrow$ Origin Shop $\rightarrow$ Destination Shop + Toll/Non-Toll toggle). | Fetches cached shops & drivers (`StaleWhileRevalidate`). |
| **Frontend UI** | `OfflineSyncBanner` | Real-time status indicator showing network connectivity and pending IndexedDB sync queue count. | Local browser `navigator.onLine` & IndexedDB store. |
| **Backend Core** | `PayrollCalculator` | Pure, deterministic calculation engine porting the base + tiered surcharge math with database-backed rate cards.

 | Reads active `rate_cards` and `od_distance_matrix`. |
| **Backend Core** | `RoutingService` | Interrogates local Docker OSRM endpoints (`car-toll` vs. `car-nontoll`) with a 3-second timeout and Haversine fallback.

 | Queries Docker OSRM containers (`http://osrm-toll:5000` / `http://osrm-nontoll:5001`). |
| **Persistence** | `PostgreSQL + PostGIS` | Immutable storage for audit logs, geofenced branch coordinates, and versioned payroll rate tables. | Raw disk volumes in Docker Compose. |

---

## 3. Core Logic Port (Adapted from `flower-shop-commerce`)

Porting and refactoring the proven modules from `DELIVERY_FEE_DOCUMENTATION.md` guarantees robustness while fixing client-side trust vulnerabilities:

### A. Distance & Routing Module (`src/lib/services/routing.ts`)

```ts
import { calculateDeliveryDistance } from '@/lib/utils/delivery'; // Haversine fallback from doc[cite: 1]

export async function getRoadDistance(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  routeType: 'toll' | 'nontoll' = 'nontoll'
): Promise<{ distanceKm: number; polyline?: string }> {
  const port = routeType === 'toll' ? 5000 : 5001;
  const url = `http://localhost:${port}/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout from reference doc[cite: 1]

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error('OSRM routing failed');
    const data = await res.json();

    if (data.routes && data.routes.length > 0) {
      return {
        distanceKm: Number((data.routes[0].distance / 1000).toFixed(2)),
        polyline: data.routes[0].geometry,
      };
    }
    throw new Error('No route found');
  } catch (error) {
    // Fallback to Haversine formula if local OSRM times out or is unreachable[cite: 1]
    const fallbackKm = calculateDeliveryDistance(
      destination.lat,
      destination.lng,
      origin.lat,
      origin.lng
    );
    return { distanceKm: Number(fallbackKm.toFixed(2)) };
  }
}

```

### B. Deterministic Payroll Calculation Engine (`src/lib/services/payroll.ts`)

```ts
export interface RateCard {
  min_km: number;
  max_km: number;
  base_fare: number;
  rate_per_km: number;
  flat_trip_allowance: number;
  toll_allowance: number;
}

export function computeDriverBenefit(
  distanceKm: number,
  routeType: 'toll' | 'nontoll',
  rateCard: RateCard
): { baseBenefit: number; tollReimbursement: number; totalBenefit: number } {
  // Tiered rate calculation formula adapted from reference documentation[cite: 1]
  let variablePay = rateCard.base_fare;
  if (distanceKm > rateCard.min_km) {
    variablePay += Math.round((distanceKm - rateCard.min_km) * rateCard.rate_per_km);
  }

  const tollReimbursement = routeType === 'toll' ? rateCard.toll_allowance : 0;
  const totalBenefit = variablePay + rateCard.flat_trip_allowance + tollReimbursement;

  return {
    baseBenefit: variablePay + rateCard.flat_trip_allowance,
    tollReimbursement,
    totalBenefit,
  };
}

```

---

## 4. PWA Offline Sync Workflow

1. **Online Mode:** Supervisor logs a vehicle transfer $\rightarrow$ API request hits `POST /api/deliveries` $\rightarrow$ Server calculates distance and benefit server-side and writes to PostgreSQL.
2. **Offline Mode (Showroom / Basement Lot):** `navigator.onLine === false` $\rightarrow$ Request is intercepted by the frontend PWA layer $\rightarrow$ Saved locally into **IndexedDB (`deliveryQueue`)** $\rightarrow$ UI displays a badge: `"Queued Offline (1 pending)"`.
3. **Reconnection:** Browser fires `window.addEventListener('online', ...)` $\rightarrow$ Service worker / app client replays all queued IndexedDB payloads to `POST /api/deliveries` $\rightarrow$ Queue clears, and success toast confirms server synchronization.