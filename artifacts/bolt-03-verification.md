# Bolt 03 Verification Gate Report

**Bolt:** 03 — Deterministic Compensation & Audit Ledger Engine  
**Verified At:** 2026-11-17T18:49+07:00  
**Status:** PASSED (All Exit Criteria Verified)

---

## 1. Exit Criteria Checklist

| Exit Criterion | Status | Evidence |
| --- | --- | --- |
| Deterministic `PayrollCalculator` module evaluating `computed_distance_km` + `route_type` + `delivery_date` against active `rate_cards` | PASSED | Implemented `computeDriverBenefit`, `selectApplicableRateCard`, and `evaluateDelivery` in `backend/src/lib/services/payroll.ts` |
| Boundary tests covering `0 km` error, tier boundaries (`15.00 km` vs `15.01 km`), and effective date transitions | PASSED | `6 / 6` tests in `backend/tests/payroll-deliveries.test.ts` passed (`5.00 vs 5.01 km`, `15.00 vs 15.01 km`, `2025-12-31 / 2026-06-30 / 2026-07-01`) |
| `POST /api/deliveries` rejects same-shop `0 km` transfers & duplicate `vehicle_vin` overlaps, and snapshots distance, rate card, and IDR payout | PASSED | `JKT-SUN -> BGR-PAJ` (`toll`) snapshotted `58.89 km` and `Rp 428,340` (`variablePay 358,340 + flatTripAllowance 25,000 + tollReimbursement 45,000`), unaffected by subsequent rate card additions |
| `PATCH /api/deliveries/:id/void` enforces mandatory `void_reason` and preserves immutable audit rows | PASSED | Empty `void_reason` rejected with `HTTP 400`; valid void updated `status = 'voided'` without row deletion; double-void rejected with `HTTP 409` |

---

## 2. Automated Test Suite (`Vitest` + `Supertest`)

Command: `cd backend && npm run build && npx vitest run --reporter=verbose --reporter=json --outputFile=../artifacts/bolt-03-test-results.json`  
Result: **2 test files passed, 14 / 14 tests passed (1.63 s total duration)**  
JSON Output: [bolt-03-test-results.json](file:///Users/marcsalvadore/Software%20Projects/monitor-pengiriman-mobil/artifacts/bolt-03-test-results.json)

| Test Suite | Test Case | Status | Duration |
| --- | --- | --- | --- |
| `payroll-deliveries.test.ts` | `rejects 0 km and negative distances` | PASSED | 1.17 ms |
| `payroll-deliveries.test.ts` | `handles min_km threshold (5.00 km vs 5.01 km) and toll allowance accurately` | PASSED | 0.46 ms |
| `payroll-deliveries.test.ts` | `transitions cleanly across tier boundaries (15.00 km vs 15.01 km)` | PASSED | 27.51 ms |
| `payroll-deliveries.test.ts` | `handles rate-card effective_from and effective_to date transitions` | PASSED | 0.45 ms |
| `payroll-deliveries.test.ts` | `rejects 0 km same-shop transfer with HTTP 400` | PASSED | 100.20 ms |
| `payroll-deliveries.test.ts` | `snapshots distance, rate card, and IDR payout immutably and rejects duplicate VIN overlap` | PASSED | 142.40 ms |
| `routing.test.ts` (Regression) | All 8 Bolt 02 spatial routing & OD matrix recomputation tests | PASSED | 766 ms |

---

## 3. Live Containerized API Verification (`http://localhost:3001`)

- **`GET /api/rate-cards`:**
  ```json
  {"rate_cards":[{"id":"8a4af1bb-eb41-479d-91dd-1053750cb161","name":"Standard Jabodetabek Rate 2026","effective_from":"2026-01-01","effective_to":null,"min_km":5,"max_km":999.99,"base_fare":35000,"rate_per_km":6000,"flat_trip_allowance":25000,"toll_allowance":45000,"is_active":true}]}
  ```
- **Same-shop `0 km` transfer guard (`POST /api/deliveries`, `JKT-SUN` → `JKT-SUN`):**
  ```text
  {"error":"Origin and destination shops cannot be identical (0 km transfer is invalid)"} [HTTP 400]
  ```
- **Server-side Snapshot Calculation (`POST /api/deliveries`, `JKT-SUN` → `BGR-PAJ`, `toll`):**
  ```json
  {"id":"5e4c7553-6c0e-401e-8e4b-0961190a0f82","distance_km":58.89,"benefit_idr":428340,"breakdown":{"variablePay":358340,"flatTripAllowance":25000,"baseBenefit":383340,"tollReimbursement":45000,"totalBenefit":428340},"status":"verified"}
  ```
- **Void Audit Workflow (`PATCH /api/deliveries/:id/void`):**
  ```json
  {"id":"5e4c7553-6c0e-401e-8e4b-0961190a0f82","status":"voided","void_reason":"Live container smoke test cleanup"}
  ```
  *(Smoke test delivery row removed afterward to preserve clean baseline seed state.)*
