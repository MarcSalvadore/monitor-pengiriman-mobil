# Delivery Fee Calculation Documentation

This document details the end-to-end delivery fee calculation process in `flower-shop-commerce`, covering its dependencies, system architecture, methods/modules, and pricing algorithms.

---

## 1. Dependencies

### NPM Packages (`package.json`)
| Package | Version | Role in Delivery Flow |
| :--- | :--- | :--- |
| `leaflet` | `^1.9.4` | Interactive map rendering, markers, and coordinate picking. |
| `react-leaflet` | `^5.0.0` | React bindings (`MapContainer`, `TileLayer`, `Marker`, `Popup`, `useMapEvents`, `useMap`). |
| `pg` | `^8.22.0` | PostgreSQL client used to read `store_settings`, `products`, and persist `orders.shipping_fee`. |
| `midtrans-client` | `^1.4.3` | Payment gateway SDK; receives `shipping_fee` as a distinct line item in Snap transactions. |
| `next` | `16.2.9` | Server Actions (`'use server'`), App Router API routes (`/api/checkout`), and dynamic client imports (`ssr: false`). |

### External Services & APIs
1. **OpenStreetMap Tile Server** (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`): Renders map tiles in `DeliveryMap` and `PickupMap`.
2. **Nominatim Reverse Geocoding API** (`https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lng}`): Resolves pinned `(lat, lng)` coordinates into street/district/city/province strings (debounced 500 ms on the storefront).
3. **OSRM Public Routing API** (`https://router.project-osrm.org/route/v1/driving/{originLng},{originLat};{customerLng},{customerLat}?overview=false`): Calculates real-road driving distance in meters with a **3,000 ms** timeout (`AbortSignal.timeout(3000)`).
4. **Leaflet CDN Marker Assets** (`https://unpkg.com/leaflet@1.7.1/dist/images/...`): Marker icon images loaded via CDN to avoid Next.js bundling issues.

### Database Schema (`src/lib/db/schema.sql`)
- **`store_settings`** (singleton configuration row):
  - `pickup_latitude` (`DOUBLE PRECISION`, default `-6.225016`)
  - `pickup_longitude` (`DOUBLE PRECISION`, default `106.900447`)
  - `pickup_address` (`TEXT`)
  - `bike_rush_hour_fare` (`INTEGER`, default `0`)
  - `bike_other_condition_fare` (`INTEGER`, default `0`)
  - `car_rush_hour_fare` (`INTEGER`, default `0`)
  - `car_other_condition_fare` (`INTEGER`, default `0`)
- **`products`**:
  - `is_addon` (`BOOLEAN`, default `false`) — excluded from bulky-order main-item count.
  - `required_vehicle` (`VARCHAR(50)`, `'bike' | 'car'`, default `'bike'`).
- **`orders`**:
  - `latitude` (`DOUBLE PRECISION`), `longitude` (`DOUBLE PRECISION`)
  - `delivery_method` (`VARCHAR(50)`, `'pickup' | 'courier'`, default `'courier'`)
  - `shipping_courier` (`VARCHAR(100)`)
  - `shipping_fee` (`DECIMAL(15, 2)`, default `0`)

---

## 2. Architecture & Data Flow

The delivery fee system spans four layers: **Admin Configuration**, **Storefront Client**, **Server Calculation**, and **Checkout Persistence & Payment**.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. ADMIN CONFIGURATION (/dashboard/settings)                            │
│    SettingsForm.tsx + PickupMap.tsx                                     │
│    └─> updateStoreSettings() ──> PostgreSQL (store_settings)            │
│        Stores dispatch origin (lat/lng) & rush/condition fare buffers   │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. STOREFRONT CHECKOUT CLIENT (/checkout)                               │
│    DeliveryMap.tsx (Leaflet, ssr: false)                                │
│    ├─ User drags pin / clicks map / uses browser geolocation            │
│    ├─ Nominatim API reverse-geocodes coordinates (500ms debounce)       │
│    └─ CheckoutPage triggers estimateDeliveryRates() on changes to:      │
│       (latitude, longitude, needsCar, deliveryMethod)                   │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. SERVER ACTION (src/lib/actions/storefront.ts)                        │
│    estimateDeliveryRates(customerCoords, storeCoords, needsCar)         │
│    ├─ Reads store_settings (origin coords + fare buffers)               │
│    ├─ Calls OSRM API (3s timeout) for driving distance                  │
│    │    └─ On failure/timeout: calculateDeliveryDistance() (Haversine)  │
│    ├─ Checks checkIsSurgeActive() (Asia/Jakarta 06-09 & 16-19 WIB)      │
│    └─ Computes Motorcycle & Car CourierRate[] and returns to client     │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. CHECKOUT SUBMISSION & PAYMENT                                        │
│    CheckoutButton.tsx ──> POST /api/checkout                            │
│    ├─ Validates bulky-order rule (totalMainItems >= 3 cannot use bike)  │
│    ├─ Validates serverCalculatedSubtotal + shippingFee === totalAmount  │
│    ├─ Inserts order (shipping_courier, shipping_fee, lat/lng)           │
│    └─ Appends shipping_fee item to Midtrans Snap transaction_details    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Methods & Modules

### Utility Functions (`src/lib/utils/delivery.ts`)
- **`STORE_LAT` / `STORE_LNG`**: Default East Jakarta coordinates (`-6.225016`, `106.900447`).
- **`calculateDeliveryDistance(lat, lng, originLat = STORE_LAT, originLng = STORE_LNG): number`**: Computes great-circle distance in kilometers using the Haversine formula.
- **`checkIsSurgeActive(): boolean`**: Evaluates current time in `Asia/Jakarta` (WIB / UTC+7) and returns `true` during peak rush hours (`06:00–09:00` and `16:00–19:00`).
- **`CourierRate` interface**:
  ```ts
  export interface CourierRate {
    courier_name: string;   // 'Motorcycle Delivery' | 'Car Delivery'
    service_type: string;   // 'Instant'
    price: number;          // Total fee in IDR
    isSurgeActive: boolean; // Whether rush hour buffer was applied
    distance: number;       // Distance in km (rounded to 2 decimal places)
  }
  ```

### Server Actions
- **`estimateDeliveryRates(customerCoords, storeCoords, needsCar = false)`** (`src/lib/actions/storefront.ts`): Orchestrates origin resolution, OSRM/Haversine distance calculation, surge detection, and per-vehicle rate computation.
- **`getStoreSettings()` / `updateStoreSettings(data)`** (`src/lib/actions/settings.ts`): Reads and updates dispatch origin coordinates and fare buffers in `store_settings`.
- **`processCheckout(data)`** (`src/lib/actions/checkout.ts`): Server-action checkout alternative with the same bulky-order validation, total check, order insertion, and Midtrans Snap payload construction.

### Frontend Components
- **`DeliveryMap`** (`src/components/storefront/DeliveryMap.tsx`): Dynamically imported (`ssr: false`) Leaflet map defaulting to Jakarta (`-6.2088, 106.8456`). Supports map click, marker drag, and browser geolocation snap; reverse-geocodes via Nominatim with a 500 ms debounce.
- **`CheckoutPage`** (`src/app/(storefront)/checkout/page.tsx`):
  - Computes `totalMainItems` (sum of quantities where `!item.is_addon`) and `needsCar = totalMainItems >= 3`.
  - Automatically re-fetches `estimateDeliveryRates` whenever `latitude`, `longitude`, `needsCar`, or `deliveryMethod` changes.
  - Forces `shippingFee = 0` when `deliveryMethod === 'pickup'`.
- **`CheckoutButton`** (`src/app/(storefront)/checkout/CheckoutButton.tsx`): Validates coordinates/address for courier orders and submits `shippingFee` and `shippingCourier` to `POST /api/checkout`.
- **`SettingsForm`** (`src/app/(admin)/dashboard/settings/SettingsForm.tsx`) & **`PickupMap`** (`src/components/admin/PickupMap.tsx`): Admin UI for updating dispatch origin coordinates and configuring the four margin-protection fare buffers.

### API Route
- **`POST /api/checkout`** (`src/app/api/checkout/route.ts`): Active checkout endpoint used by `CheckoutButton`. Validates cart items against DB prices, enforces the bulky-order car requirement, verifies `serverCalculatedSubtotal + shippingPrice === totalAmount`, persists the order, and creates the Midtrans Snap token with `shipping_fee` as an item detail.

---

## 4. Calculation Algorithm

### Step 1: Origin & Destination Resolution
- **Destination**: `(customerCoords.lat, customerCoords.lng)` from `DeliveryMap`.
- **Origin**:
  1. Uses `storeCoords` passed from client state (`storeSettings.pickup_latitude`, `storeSettings.pickup_longitude`) if present.
  2. Falls back to `settings.pickup_latitude` / `settings.pickup_longitude` from `getStoreSettings()`.
  3. Falls back to `STORE_LAT` (`-6.225016`) / `STORE_LNG` (`106.900447`).

### Step 2: Distance Calculation (OSRM + Haversine Fallback)
1. **Primary (OSRM Driving Route)**:
   - Requests `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${customerCoords.lng},${customerCoords.lat}?overview=false` with a **3,000 ms** timeout.
   - If `routes[0].distance` is returned, converts meters to kilometers:
     $$\text{distanceInKm} = \frac{\text{routes}[0].\text{distance}}{1000}$$
2. **Fallback (Haversine Formula)** — executed if OSRM times out, returns non-OK HTTP status, returns no routes, or throws a network error:
   - Earth radius $R = 6371\text{ km}$:
     $$\Delta\text{lat} = (\text{lat} - \text{originLat}) \times \frac{\pi}{180}, \quad \Delta\text{lng} = (\text{lng} - \text{originLng}) \times \frac{\pi}{180}$$
     $$a = \sin^2\left(\frac{\Delta\text{lat}}{2}\right) + \cos\left(\text{originLat}\cdot\frac{\pi}{180}\right)\cdot\cos\left(\text{lat}\cdot\frac{\pi}{180}\right)\cdot\sin^2\left(\frac{\Delta\text{lng}}{2}\right)$$
     $$c = 2 \cdot \operatorname{atan2}\left(\sqrt{a}, \sqrt{1 - a}\right)$$
     $$\text{distanceInKm} = R \cdot c$$
- Returned `distance` in `CourierRate` is rounded to 2 decimal places (`Number(distanceInKm.toFixed(2))`).

### Step 3: Bulky Order Vehicle Eligibility
- `totalMainItems` = sum of `quantity` for all cart items where `is_addon === false`.
- If `totalMainItems >= 3`, `needsCar = true`:
  - Only **Car Delivery** is returned by `estimateDeliveryRates`.
  - Storefront hides Motorcycle Delivery and displays a bulky-order upgrade notice.
  - Both `POST /api/checkout` and `processCheckout` reject any non-pickup order with `totalMainItems >= 3` that selects a `bike` or `motorcycle` courier (`HTTP 400`).

### Step 4: Rush Hour / Surge Detection
- Current server timestamp is converted to `Asia/Jakarta` (`UTC+7`):
  $$\text{isSurge} = (6 \le \text{hour} < 9) \lor (16 \le \text{hour} < 19)$$
- When `isSurge` is `true`, the vehicle's configured `*_rush_hour_fare` is added; otherwise `0`.

### Step 5: Vehicle Pricing Formulas (IDR)

#### Motorcycle Delivery (`CourierRate.courier_name = 'Motorcycle Delivery'`)
- **Base fare**: `Rp 12,000` for the first `4 km`.
- **Distance surcharge**: If `distanceInKm > 4`, add `Math.round((distanceInKm - 4) * 2500)`.
- **Total price**:
  $$\text{price}_{\text{bike}} = \text{rawMotorcycleCost} + (\text{isSurge} \;?\; \text{bike\_rush\_hour\_fare} : 0) + \text{bike\_other\_condition\_fare}$$

#### Car Delivery (`CourierRate.courier_name = 'Car Delivery'`)
- **Base fare**: `Rp 35,000` for the first `5 km`.
- **Distance surcharge**: If `distanceInKm > 5`, add `Math.round((distanceInKm - 5) * 6000)`.
- **Total price**:
  $$\text{price}_{\text{car}} = \text{rawCarCost} + (\text{isSurge} \;?\; \text{car\_rush\_hour\_fare} : 0) + \text{car\_other\_condition\_fare}$$

### Step 6: Store Pick-up Override & Checkout Total
- On the storefront (`CheckoutPage`), if `deliveryMethod === 'pickup'`, `shippingFee` is unconditionally `0`.
- Otherwise, `shippingFee = selectedRate ? selectedRate.price : 0`.
- On `POST /api/checkout`:
  - `serverCalculatedSubtotal` is computed strictly from database product prices.
  - `shippingPrice = Math.round(Number(data.shippingFee || 0))` is added to `serverCalculatedSubtotal` and verified against `data.totalAmount`.
  - If `shippingFee > 0`, a line item with `id: 'shipping_fee'`, `quantity: 1`, `price: shippingPrice`, and `name: "${shippingCourier || 'Courier'} Shipping Fee"` (truncated to 50 chars) is sent to Midtrans Snap.

---

## 5. Implementation Notes & Caveats

- **Client-Supplied `shippingFee` at Checkout**: `POST /api/checkout` (and `processCheckout`) recomputes product subtotals from PostgreSQL, but trusts `data.shippingFee` from the client payload rather than re-running `estimateDeliveryRates` server-side during checkout submission.
- **OSRM Public Endpoint**: `estimateDeliveryRates` relies on the public demo server `router.project-osrm.org`, which is mitigated by the 3-second `AbortSignal.timeout(3000)` and automatic Haversine fallback.
- **Timezone Conversion in `checkIsSurgeActive`**: Uses `new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jakarta" }))` on the server to determine WIB hour of day.
