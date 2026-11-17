import http from 'node:http';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { getRoadDistance } from '../src/lib/services/routing.js';
import { calculateDeliveryDistance } from '../src/lib/utils/delivery.js';

const pool = createPool();
const app = createApp(pool);

const SUNTER = { lat: -6.1462, lng: 106.8765 };
const BOGOR_PAJAJARAN = { lat: -6.6014, lng: 106.8072 };
const PONDOK_INDAH = { lat: -6.2655, lng: 106.7831 };
const KARAWACI = { lat: -6.2195, lng: 106.6094 };

describe('Bolt 02: Spatial Routing Service & OD Matrix Engine', () => {
  afterAll(async () => {
    await pool.query(`DELETE FROM shops WHERE code = 'TEST-KMG'`);
    await pool.end();
  });

  it('computes Haversine geodesic distance accurately as fallback reference', () => {
    const straightLineKm = calculateDeliveryDistance(
      SUNTER.lat,
      SUNTER.lng,
      BOGOR_PAJAJARAN.lat,
      BOGOR_PAJAJARAN.lng
    );
    expect(straightLineKm).toBeGreaterThan(48);
    expect(straightLineKm).toBeLessThan(52);
  });

  it('queries local OSRM toll & nontoll directly and returns distinct polylines', async () => {
    const [toll, nontoll] = await Promise.all([
      getRoadDistance(PONDOK_INDAH, KARAWACI, 'toll'),
      getRoadDistance(PONDOK_INDAH, KARAWACI, 'nontoll'),
    ]);

    expect(toll.fallbackUsed).toBe(false);
    expect(nontoll.fallbackUsed).toBe(false);
    expect(toll.distanceKm).toBeGreaterThan(20);
    expect(nontoll.distanceKm).toBeGreaterThan(20);
    expect(toll.distanceKm).not.toBe(nontoll.distanceKm);
    expect(toll.polyline.type).toBe('LineString');
    expect(toll.polyline.coordinates.length).toBeGreaterThan(10);
  });

  it('falls back to Haversine distance when local OSRM exceeds timeout', async () => {
    const slowServer = http.createServer((_req, res) => {
      // Intentionally delay longer than timeoutMs to trigger AbortController
      setTimeout(() => {
        res.writeHead(200);
        res.end('{}');
      }, 600);
    });

    await new Promise<void>((resolve) => slowServer.listen(0, '127.0.0.1', resolve));
    const address = slowServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind test HTTP server');
    }

    try {
      const result = await getRoadDistance(SUNTER, BOGOR_PAJAJARAN, 'toll', {
        timeoutMs: 100,
        tollBaseUrl: `http://127.0.0.1:${address.port}`,
      });

      const expectedHaversine = Number(
        calculateDeliveryDistance(
          SUNTER.lat,
          SUNTER.lng,
          BOGOR_PAJAJARAN.lat,
          BOGOR_PAJAJARAN.lng
        ).toFixed(2)
      );

      expect(result.fallbackUsed).toBe(true);
      expect(result.distanceKm).toBe(expectedHaversine);
      expect(result.polyline.coordinates).toEqual([
        [SUNTER.lng, SUNTER.lat],
        [BOGOR_PAJAJARAN.lng, BOGOR_PAJAJARAN.lat],
      ]);
    } finally {
      await new Promise<void>((resolve) => slowServer.close(() => resolve()));
    }
  });

  it('returns 55-65 km road distance for Sunter -> Bogor Pajajaran via OD matrix (NOT ~50 km straight-line)', async () => {
    const tollRes = await request(app)
      .post('/api/routes/calculate')
      .send({
        origin_shop_id: 'JKT-SUN',
        destination_shop_id: 'BGR-PAJ',
        route_type: 'toll',
      })
      .expect(200);

    const nontollRes = await request(app)
      .post('/api/routes/calculate')
      .send({
        origin_shop_id: 'JKT-SUN',
        destination_shop_id: 'BGR-PAJ',
        route_type: 'nontoll',
      })
      .expect(200);

    expect(tollRes.body.source).toBe('od_matrix');
    expect(tollRes.body.fallback_used).toBe(false);
    expect(tollRes.body.distance_km).toBeGreaterThanOrEqual(55);
    expect(tollRes.body.distance_km).toBeLessThanOrEqual(65);
    expect(tollRes.body.polyline?.type).toBe('LineString');
    expect(tollRes.body.polyline?.coordinates.length).toBeGreaterThan(20);

    expect(nontollRes.body.source).toBe('od_matrix');
    expect(nontollRes.body.fallback_used).toBe(false);
    expect(nontollRes.body.distance_km).toBeGreaterThanOrEqual(55);
    expect(nontollRes.body.distance_km).toBeLessThanOrEqual(65);

    // Toll and nontoll profiles must differ in road distance and geometry
    expect(tollRes.body.distance_km).not.toBe(nontollRes.body.distance_km);
    expect(JSON.stringify(tollRes.body.polyline)).not.toBe(
      JSON.stringify(nontollRes.body.polyline)
    );
  });

  it('returns distinct toll vs nontoll distances across major Jabodetabek corridors', async () => {
    const corridors = [
      ['JKT-SUN', 'BKS-CKR'],
      ['JKT-SUN', 'TNG-BSD'],
      ['JKT-PIN', 'TNG-KRW'],
    ];

    for (const [origin, dest] of corridors) {
      const [tollRes, nontollRes] = await Promise.all([
        request(app).post('/api/routes/calculate').send({
          origin_shop_id: origin,
          destination_shop_id: dest,
          route_type: 'toll',
        }),
        request(app).post('/api/routes/calculate').send({
          origin_shop_id: origin,
          destination_shop_id: dest,
          route_type: 'nontoll',
        }),
      ]);

      expect(tollRes.status).toBe(200);
      expect(nontollRes.status).toBe(200);
      expect(tollRes.body.distance_km).not.toBe(nontollRes.body.distance_km);
      expect(tollRes.body.distance_km).toBeGreaterThan(0);
      expect(nontollRes.body.distance_km).toBeGreaterThan(0);
    }
  });

  it('calculates real-time OSRM road route for ad-hoc custom_coords customer deliveries', async () => {
    const customCoords = { lat: -6.2297, lng: 106.8095 }; // SCBD Sudirman
    const [tollRes, nontollRes] = await Promise.all([
      request(app).post('/api/routes/calculate').send({
        origin_shop_id: 'JKT-SUN',
        custom_coords: customCoords,
        route_type: 'toll',
      }),
      request(app).post('/api/routes/calculate').send({
        origin_shop_id: 'JKT-SUN',
        custom_coords: customCoords,
        route_type: 'nontoll',
      }),
    ]);

    expect(tollRes.status).toBe(200);
    expect(nontollRes.status).toBe(200);
    expect(tollRes.body.source).toBe('osrm_live');
    expect(nontollRes.body.source).toBe('osrm_live');
    expect(tollRes.body.destination_shop).toBeNull();
    expect(tollRes.body.distance_km).toBeGreaterThan(10);
    expect(nontollRes.body.distance_km).toBeGreaterThan(10);
    expect(tollRes.body.polyline?.type).toBe('LineString');
  });

  it('recomputes OD matrix automatically on shop creation and coordinate updates', async () => {
    const createRes = await request(app)
      .post('/api/shops')
      .send({
        code: 'TEST-KMG',
        name: 'Kemang Test Showroom',
        city: 'Jakarta Selatan',
        address: 'Jl. Kemang Raya No. 10, Jakarta Selatan',
        latitude: -6.2608,
        longitude: 106.8148,
      })
      .expect(201);

    const createdId = createRes.body.shop.id as string;
    // With 13 active shops: 12 outbound + 12 inbound + 1 self = 25 pairs * 2 profiles = 50 rows
    expect(createRes.body.matrix_recompute.scope).toBe('shop');
    expect(createRes.body.matrix_recompute.recomputed_rows).toBe(50);
    expect(createRes.body.matrix_recompute.fallback_count).toBe(0);

    const routeBefore = await request(app)
      .post('/api/routes/calculate')
      .send({
        origin_shop_id: 'JKT-SUN',
        destination_shop_id: createdId,
        route_type: 'nontoll',
      })
      .expect(200);
    expect(routeBefore.body.source).toBe('od_matrix');
    expect(routeBefore.body.distance_km).toBeGreaterThan(15);

    // Move shop coordinates south toward Ragunan and verify automatic matrix recomputation
    const patchRes = await request(app)
      .patch(`/api/shops/${createdId}`)
      .send({
        latitude: -6.3012,
        longitude: 106.8205,
      })
      .expect(200);

    expect(patchRes.body.matrix_recompute.recomputed_rows).toBe(50);

    const routeAfter = await request(app)
      .post('/api/routes/calculate')
      .send({
        origin_shop_id: 'JKT-SUN',
        destination_shop_id: createdId,
        route_type: 'nontoll',
      })
      .expect(200);
    expect(routeAfter.body.distance_km).not.toBe(routeBefore.body.distance_km);

    // Explicit POST /api/shops/recompute-matrix check
    const manualRecompute = await request(app)
      .post('/api/shops/recompute-matrix')
      .send({ shop_id: 'TEST-KMG' })
      .expect(200);
    expect(manualRecompute.body.recomputed_rows).toBe(50);

    await request(app).delete(`/api/shops/${createdId}`).expect(200);

    const matrixCount = await request(app)
      .get('/api/od-matrix?include_polyline=false')
      .expect(200);
    expect(matrixCount.body.count).toBe(288);
  });

  it('rejects malformed requests with HTTP 400 and unknown shops with HTTP 404', async () => {
    await request(app)
      .post('/api/routes/calculate')
      .send({
        origin_shop_id: 'JKT-SUN',
        destination_shop_id: 'BGR-PAJ',
        custom_coords: { lat: -6.2, lng: 106.8 },
        route_type: 'toll',
      })
      .expect(400);

    await request(app)
      .post('/api/routes/calculate')
      .send({
        origin_shop_id: 'NON-EXISTENT',
        destination_shop_id: 'BGR-PAJ',
        route_type: 'toll',
      })
      .expect(404);
  });
});
