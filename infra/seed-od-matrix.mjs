#!/usr/bin/env node
import { createRequire } from 'node:module';

async function loadPg() {
  try {
    return await import('pg');
  } catch {
    const require = createRequire(new URL('../backend/package.json', import.meta.url));
    return require('pg');
  }
}

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5433/dealership_db';

const OSRM_ENDPOINTS = {
  toll: process.env.OSRM_TOLL_URL || 'http://localhost:5050',
  nontoll: process.env.OSRM_NONTOLL_URL || 'http://localhost:5001',
};

async function fetchOsrmRoute(baseUrl, origin, destination) {
  const url = `${baseUrl}/route/v1/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=full&geometries=geojson`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    const data = await res.json();
    if (data.code !== 'Ok' || !Array.isArray(data.routes) || data.routes.length === 0) {
      throw new Error(`OSRM error (${data.code || 'unknown'}): ${data.message || 'no routes'} for ${origin.code} -> ${destination.code}`);
    }
    const route = data.routes[0];
    return {
      distanceKm: Number((route.distance / 1000).toFixed(2)),
      durationMin: Number((route.duration / 60).toFixed(2)),
      polyline: JSON.stringify(route.geometry),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function main() {
  const pgModule = await loadPg();
  const Pool = pgModule.Pool || pgModule.default?.Pool;
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    const { rows: shops } = await pool.query(`
      SELECT id, code, name, city, latitude, longitude
      FROM shops
      WHERE is_active = TRUE
      ORDER BY code ASC
    `);

    if (shops.length === 0) {
      throw new Error('No active shops found in PostgreSQL. Verify 02-seed.sql executed.');
    }

    console.log(`Found ${shops.length} active Jabodetabek branches. Computing ${shops.length}x${shops.length}x2 OD matrix...`);

    let interBranchCount = 0;
    let selfPairCount = 0;
    const failures = [];
    const sampleRoutes = [];

    for (const routeType of ['toll', 'nontoll']) {
      const baseUrl = OSRM_ENDPOINTS[routeType];
      console.log(`\nQuerying OSRM (${routeType}) at ${baseUrl}...`);

      for (const origin of shops) {
        for (const dest of shops) {
          let distanceKm = 0;
          let durationMin = 0;
          let polyline;

          if (origin.id === dest.id) {
            polyline = JSON.stringify({
              type: 'LineString',
              coordinates: [
                [origin.longitude, origin.latitude],
                [origin.longitude, origin.latitude],
              ],
            });
            selfPairCount += 1;
          } else {
            try {
              const route = await fetchOsrmRoute(baseUrl, origin, dest);
              if (route.distanceKm <= 0) {
                throw new Error(`Non-positive road distance (${route.distanceKm} km)`);
              }
              distanceKm = route.distanceKm;
              durationMin = route.durationMin;
              polyline = route.polyline;
              interBranchCount += 1;

              if (
                (origin.code === 'JKT-SUN' && dest.code === 'BGR-PAJ') ||
                (origin.code === 'JKT-SUN' && dest.code === 'BKS-CKR') ||
                (origin.code === 'JKT-PIN' && dest.code === 'TNG-KRW')
              ) {
                sampleRoutes.push({
                  origin: origin.code,
                  destination: dest.code,
                  route_type: routeType,
                  distance_km: distanceKm,
                  estimated_duration_min: durationMin,
                });
              }
            } catch (err) {
              failures.push({
                origin: origin.code,
                destination: dest.code,
                routeType,
                error: err instanceof Error ? err.message : String(err),
              });
              continue;
            }
          }

          await pool.query(
            `
            INSERT INTO od_distance_matrix (
              origin_shop_id,
              destination_shop_id,
              route_type,
              distance_km,
              estimated_duration_min,
              route_polyline
            )
            VALUES ($1, $2, $3::route_type_enum, $4, $5, $6)
            ON CONFLICT (origin_shop_id, destination_shop_id, route_type)
            DO UPDATE SET
              distance_km = EXCLUDED.distance_km,
              estimated_duration_min = EXCLUDED.estimated_duration_min,
              route_polyline = EXCLUDED.route_polyline,
              updated_at = CURRENT_TIMESTAMP
            `,
            [origin.id, dest.id, routeType, distanceKm, durationMin, polyline]
          );
        }
      }
    }

    console.log('\n=== OD Matrix Seed Summary ===');
    console.log(`Inter-branch routes populated: ${interBranchCount}`);
    console.log(`Self-branch entries populated: ${selfPairCount}`);
    console.log(`Total matrix rows upserted:    ${interBranchCount + selfPairCount}`);
    console.log('\nSample route comparisons:');
    console.table(sampleRoutes);

    if (failures.length > 0) {
      console.error(`\nEncountered ${failures.length} routing failures:`);
      console.error(JSON.stringify(failures.slice(0, 10), null, 2));
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('OD matrix seed failed:', err);
  process.exit(1);
});
