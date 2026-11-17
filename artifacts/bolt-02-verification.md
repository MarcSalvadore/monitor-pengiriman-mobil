# Bolt 02 Verification Gate Report

**Bolt:** 02 — Routing Service & OD Matrix Pre-Computation Engine  
**Verified At:** 2026-11-17T18:30+07:00  
**Status:** PASSED (All Exit Criteria Verified)

---

## 1. Exit Criteria Checklist

| Exit Criterion | Status | Evidence |
| --- | --- | --- |
| `POST /api/routes/calculate` serves sub-10ms OD matrix lookups for registered branches | PASSED | `JKT-SUN -> BGR-PAJ` returned `distance_km: 58.89` (`toll`, `lookup_ms: 1.169`) and `58.08` (`nontoll`, `lookup_ms: 0.647`) from `od_distance_matrix` |
| Ad-hoc `custom_coords` routes live against local OSRM with 3,000 ms timeout and Haversine fallback | PASSED | `JKT-SUN` → SCBD (`-6.2297, 106.8095`) returned `source: "osrm_live"`, `16.35 km`; simulated timeout triggered `fallbackUsed: true` Haversine fallback |
| `POST /api/shops/recompute-matrix` and automatic recompute on shop create/update | PASSED | Full recompute updated `288` rows (`264` inter-branch + `24` self) in `681.77 ms` with `fallback_count: 0`; `POST /api/shops` & `PATCH /api/shops/:id` auto-recomputed `50` pair rows |
| Jakarta (`Sunter`) → Bogor (`Pajajaran`) returns realistic road distance (~55–65 km, NOT ~50 km straight-line) | PASSED | `toll = 58.89 km` (`828` polyline points), `nontoll = 58.08 km` (`1673` polyline points), geodesic Haversine = `50.92 km` |
| `toll` vs. `nontoll` toggles return distinct, accurate distances & geometries | PASSED | Verified distinct distances & geometries on `JKT-SUN -> BGR-PAJ`, `JKT-SUN -> BKS-CKR`, `JKT-SUN -> TNG-BSD`, and `JKT-PIN -> TNG-KRW` |

---

## 2. Automated Test Suite (`Vitest` + `Supertest`)

Command: `cd backend && npm run test:report`  
Result: **1 test file passed, 8 / 8 tests passed (804 ms test duration)**  
JSON Output: [bolt-02-test-results.json](file:///Users/marcsalvadore/Software%20Projects/monitor-pengiriman-mobil/artifacts/bolt-02-test-results.json)

| # | Test Case | Status | Duration |
| --- | --- | --- | --- |
| 1 | `computes Haversine geodesic distance accurately as fallback reference` | PASSED | 0.96 ms |
| 2 | `queries local OSRM toll & nontoll directly and returns distinct polylines` | PASSED | 115.99 ms |
| 3 | `falls back to Haversine distance when local OSRM exceeds timeout` | PASSED | 111.97 ms |
| 4 | `returns 55-65 km road distance for Sunter -> Bogor Pajajaran via OD matrix (NOT ~50 km straight-line)` | PASSED | 67.62 ms |
| 5 | `returns distinct toll vs nontoll distances across major Jabodetabek corridors` | PASSED | 25.49 ms |
| 6 | `calculates real-time OSRM road route for ad-hoc custom_coords customer deliveries` | PASSED | 12.25 ms |
| 7 | `recomputes OD matrix automatically on shop creation and coordinate updates` | PASSED | 465.38 ms |
| 8 | `rejects malformed requests with HTTP 400 and unknown shops with HTTP 404` | PASSED | 3.18 ms |

---

## 3. Live Containerized API Verification (`http://localhost:3001`)

- **`GET /api/health`:**
  ```json
  {"status":"ok","database":"connected","osrm":{"toll":"ready","nontoll":"ready"},"counts":{"shops":12,"drivers":8,"rate_cards":1,"od_distance_matrix":288}}
  ```
- **`POST /api/routes/calculate` (`JKT-SUN` → `BGR-PAJ`, `toll`):**
  ```json
  {"origin":"JKT-SUN","dest":"BGR-PAJ","route_type":"toll","distance_km":58.89,"duration_min":52.49,"source":"od_matrix","fallback_used":false,"lookup_ms":1.169,"polyline_points":828}
  ```
- **`POST /api/routes/calculate` (`JKT-SUN` → `BGR-PAJ`, `nontoll`):**
  ```json
  {"origin":"JKT-SUN","dest":"BGR-PAJ","route_type":"nontoll","distance_km":58.08,"duration_min":50.89,"source":"od_matrix","fallback_used":false,"lookup_ms":0.647,"polyline_points":1673}
  ```
- **`POST /api/routes/calculate` (`JKT-SUN` → ad-hoc SCBD `{-6.2297, 106.8095}`, `toll`):**
  ```json
  {"origin":"JKT-SUN","custom_coords":{"lat":-6.2297,"lng":106.8095},"route_type":"toll","distance_km":16.35,"duration_min":21.4,"source":"osrm_live","fallback_used":false,"lookup_ms":11.42,"polyline_points":642}
  ```
- **`POST /api/shops/recompute-matrix` (`{}`):**
  ```json
  {"scope":"full","shop_id":null,"active_shops_count":12,"recomputed_rows":288,"inter_branch_rows":264,"self_rows":24,"fallback_count":0,"duration_ms":681.77}
  ```
