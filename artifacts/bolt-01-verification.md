# Bolt 01 Verification Gate Report

**Bolt:** 01 — Domain Schema & Zero-OpEx Spatial Infrastructure  
**Verified At:** 2026-11-17T07:49+07:00  
**Status:** PASSED (All Exit Criteria Verified)

---

## 1. Exit Criteria Checklist

| Exit Criterion | Status | Evidence |
| --- | --- | --- |
| `docker compose up` starts cleanly with zero external API keys configured | PASSED | All 5 containers (`dealership-postgres`, `dealership-osrm-toll`, `dealership-osrm-nontoll`, `dealership-backend`, `dealership-frontend`) running; `/api/health` returns `200 OK` |
| Dual OSRM profiles (`car-toll` and `car-nontoll`) built from local Jabodetabek OSM road extract | PASSED | `infra/init-map.sh` downloaded `infra/osrm-data/jabodetabek.osm` (`51M`) and compiled isolated MLD graphs in `infra/osrm-data/toll/` (`88280` blocks) and `infra/osrm-data/nontoll/` (`81744` blocks) |
| PostGIS schema (`01-schema.sql`) and seed (`02-seed.sql`) auto-executed on startup | PASSED | `shops = 12`, `drivers = 8`, `rate_cards = 1` (`Standard Jabodetabek Rate 2026`) |
| Automated OD matrix seed populates all 12×12 branch pairs with non-zero road distances | PASSED | `node infra/seed-od-matrix.mjs` populated `288` rows (`132` toll + `132` nontoll inter-branch routes with `distance_km > 0`, `0` zero-distance errors, plus `24` self-branch rows) |

---

## 2. Container & Healthcheck Verification

Command: `docker compose -f infra/docker-compose.yml ps`

```text
NAME                      IMAGE                                      COMMAND                  SERVICE        CREATED              STATUS                        PORTS
dealership-backend        infra-backend                              "docker-entrypoint.s…"   backend        About a minute ago   Up About a minute (healthy)   0.0.0.0:3001->3001/tcp, [::]:3001->3001/tcp
dealership-frontend       infra-frontend                             "/docker-entrypoint.…"   frontend       About a minute ago   Up About a minute             0.0.0.0:5173->5173/tcp, [::]:5173->5173/tcp
dealership-osrm-nontoll   ghcr.io/project-osrm/osrm-backend:latest   "osrm-routed --algor…"   osrm-nontoll   About a minute ago   Up About a minute             0.0.0.0:5001->5001/tcp, [::]:5001->5001/tcp
dealership-osrm-toll      ghcr.io/project-osrm/osrm-backend:latest   "osrm-routed --algor…"   osrm-toll      About a minute ago   Up About a minute             0.0.0.0:5050->5000/tcp, [::]:5050->5000/tcp
dealership-postgres       imresamu/postgis:16-3.4-alpine             "docker-entrypoint.s…"   postgres       About a minute ago   Up About a minute (healthy)   0.0.0.0:5433->5432/tcp, [::]:5433->5432/tcp
```

Health Endpoint (`GET http://localhost:3001/api/health` and `GET http://localhost:5173/api/health`):

```json
{"status":"ok","database":"connected","osrm":{"toll":"ready","nontoll":"ready"},"counts":{"shops":12,"drivers":8,"rate_cards":1,"od_distance_matrix":288}}
```

---

## 3. Database Seed & OD Distance Matrix Verification

### Table Counts
```text
     table_name     | row_count 
--------------------+-----------
 shops              |        12
 drivers            |         8
 rate_cards         |         1
 od_distance_matrix |       288
```

### Matrix Completeness & Non-Zero Assertion
```text
 route_type | total_rows | nonzero_interbranch_rows | zero_interbranch_rows | min_interbranch_km | max_km 
------------+------------+--------------------------+-----------------------+--------------------+--------
 toll       |        144 |                      132 |                     0 |               3.21 |  74.33
 nontoll    |        144 |                      132 |                     0 |               3.21 |  85.00
```

### Sample Branch Comparisons from `JKT-SUN` (Sunter Auto Flagship)
```text
 origin_code | dest_code | toll_km | toll_min | nontoll_km | nontoll_min | straight_line_km 
-------------+-----------+---------+----------+------------+-------------+------------------
 JKT-SUN     | BGR-PAJ   |   58.84 |    49.46 |      58.08 |       50.89 |            50.92
 JKT-SUN     | BKS-CKR   |   45.67 |    40.91 |      49.85 |       44.27 |            36.35
 JKT-SUN     | TNG-BSD   |   39.20 |    37.13 |      47.17 |       43.93 |            28.34
 JKT-SUN     | TNG-KRW   |   36.15 |    33.11 |      38.71 |       36.57 |            30.65
 JKT-SUN     | JKT-CBB   |   36.01 |    33.05 |      32.47 |       34.43 |            25.53
 JKT-SUN     | DPK-MRG   |   35.03 |    30.55 |      35.03 |       30.55 |            27.65
 JKT-SUN     | JKT-PIN   |   23.36 |    22.57 |      23.36 |       22.57 |            16.76
 JKT-SUN     | BKS-BRT   |   20.01 |    18.47 |      22.94 |       18.90 |            16.65
 JKT-SUN     | JKT-CAW   |   16.16 |    14.40 |      16.16 |       14.39 |            10.87
 JKT-SUN     | JKT-KBJ   |   15.99 |    16.93 |      17.21 |       19.06 |            12.94
 JKT-SUN     | JKT-KLG   |    3.93 |     5.19 |       3.93 |        5.19 |             1.99
```

### Dual Profile Road Verification (`toll` vs `nontoll` Steps)
- **`JKT-SUN` → `BGR-PAJ` (`car-toll`):** `58.84 km`, `49.46 min` via `Jalan Tol Jakarta–Bogor–Ciawi -> Jalan Tol Jagorawi -> Jalan Raya Pajajaran`
- **`JKT-SUN` → `BGR-PAJ` (`car-nontoll`):** `58.08 km`, `50.89 min` via `Jalan Mayor Jenderal Sutoyo -> Jalan Raya Bogor -> Jalan KS Tubun -> Jalan Raya Pajajaran`
- **`JKT-SUN` → `BKS-CKR` (`car-toll`):** `45.67 km`, `40.91 min` via `Jalan Tol Sunter–Pulo Gebang -> Jalan Tol Lingkar Luar Jakarta -> Jalan Tol Jakarta–Cikampek -> Jalan Raya Cibarusah`
- **`JKT-SUN` → `BKS-CKR` (`car-nontoll`):** `49.85 km`, `44.27 min` via `Jalan Yos Sudarso -> Jalan Perintis Kemerdekaan -> Jalan Bekasi Raya -> Jalan Sultan Agung -> Jalan Ir. H. Juanda`

Full seed & route comparison JSON exported to [bolt-01-od-matrix-sample.json](file:///Users/marcsalvadore/Software%20Projects/monitor-pengiriman-mobil/artifacts/bolt-01-od-matrix-sample.json).
