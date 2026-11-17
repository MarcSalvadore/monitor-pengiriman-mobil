import { performance } from 'node:perf_hooks';
import type pg from 'pg';
import {
  getRoadDistance,
  type Coordinates,
  type GeoJsonLineString,
  type RouteType,
  type RoutingOptions,
} from './routing.js';

export class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export interface ShopRow {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string;
  latitude: number;
  longitude: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CalculateRouteInput {
  origin_shop_id: string;
  destination_shop_id?: string;
  custom_coords?: Coordinates;
  route_type: RouteType;
}

export interface CalculateRouteResult {
  origin_shop: Pick<ShopRow, 'id' | 'code' | 'name' | 'city' | 'latitude' | 'longitude'>;
  destination_shop: Pick<ShopRow, 'id' | 'code' | 'name' | 'city' | 'latitude' | 'longitude'> | null;
  custom_coords: Coordinates | null;
  route_type: RouteType;
  distance_km: number;
  estimated_duration_min: number;
  polyline: GeoJsonLineString | null;
  source: 'od_matrix' | 'osrm_live' | 'haversine_fallback';
  fallback_used: boolean;
  lookup_ms: number;
}

export interface RecomputeMatrixSummary {
  scope: 'full' | 'shop';
  shop_id: string | null;
  active_shops_count: number;
  recomputed_rows: number;
  inter_branch_rows: number;
  self_rows: number;
  fallback_count: number;
  duration_ms: number;
  updated_at: string;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapShopSummary(shop: ShopRow) {
  return {
    id: shop.id,
    code: shop.code,
    name: shop.name,
    city: shop.city,
    latitude: Number(shop.latitude),
    longitude: Number(shop.longitude),
  };
}

function parsePolyline(raw: string | null): GeoJsonLineString | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GeoJsonLineString;
  } catch {
    return null;
  }
}

export async function resolveShop(
  pool: pg.Pool,
  idOrCode: string
): Promise<ShopRow> {
  const query = UUID_REGEX.test(idOrCode)
    ? `SELECT id, code, name, city, address, latitude, longitude, is_active, created_at, updated_at
       FROM shops WHERE id = $1`
    : `SELECT id, code, name, city, address, latitude, longitude, is_active, created_at, updated_at
       FROM shops WHERE code = $1`;

  const { rows } = await pool.query<ShopRow>(query, [idOrCode]);
  if (rows.length === 0) {
    throw new HttpError(404, `Shop not found: ${idOrCode}`);
  }
  return rows[0];
}

export async function calculateRoute(
  pool: pg.Pool,
  input: CalculateRouteInput,
  routingOptions?: RoutingOptions
): Promise<CalculateRouteResult> {
  const originShop = await resolveShop(pool, input.origin_shop_id);

  if (input.destination_shop_id) {
    const destShop = await resolveShop(pool, input.destination_shop_id);
    const startMs = performance.now();

    if (originShop.id === destShop.id) {
      const lookupMs = Number((performance.now() - startMs).toFixed(3));
      return {
        origin_shop: mapShopSummary(originShop),
        destination_shop: mapShopSummary(destShop),
        custom_coords: null,
        route_type: input.route_type,
        distance_km: 0,
        estimated_duration_min: 0,
        polyline: {
          type: 'LineString',
          coordinates: [
            [Number(originShop.longitude), Number(originShop.latitude)],
            [Number(originShop.longitude), Number(originShop.latitude)],
          ],
        },
        source: 'od_matrix',
        fallback_used: false,
        lookup_ms: lookupMs,
      };
    }

    const { rows } = await pool.query<{
      distance_km: string;
      estimated_duration_min: string;
      route_polyline: string | null;
    }>(
      `
      SELECT distance_km, estimated_duration_min, route_polyline
      FROM od_distance_matrix
      WHERE origin_shop_id = $1
        AND destination_shop_id = $2
        AND route_type = $3::route_type_enum
      LIMIT 1
      `,
      [originShop.id, destShop.id, input.route_type]
    );

    if (rows.length > 0) {
      const lookupMs = Number((performance.now() - startMs).toFixed(3));
      const row = rows[0];
      return {
        origin_shop: mapShopSummary(originShop),
        destination_shop: mapShopSummary(destShop),
        custom_coords: null,
        route_type: input.route_type,
        distance_km: Number(row.distance_km),
        estimated_duration_min: Number(row.estimated_duration_min),
        polyline: parsePolyline(row.route_polyline),
        source: 'od_matrix',
        fallback_used: false,
        lookup_ms: lookupMs,
      };
    }

    // Cache miss in OD matrix: query local OSRM and cache if OSRM succeeded
    const live = await getRoadDistance(
      { lat: Number(originShop.latitude), lng: Number(originShop.longitude) },
      { lat: Number(destShop.latitude), lng: Number(destShop.longitude) },
      input.route_type,
      routingOptions
    );
    const lookupMs = Number((performance.now() - startMs).toFixed(3));

    if (!live.fallbackUsed) {
      await upsertOdMatrixEntry(pool, {
        originShopId: originShop.id,
        destinationShopId: destShop.id,
        routeType: input.route_type,
        distanceKm: live.distanceKm,
        estimatedDurationMin: live.estimatedDurationMin,
        routePolyline: JSON.stringify(live.polyline),
      });
    }

    return {
      origin_shop: mapShopSummary(originShop),
      destination_shop: mapShopSummary(destShop),
      custom_coords: null,
      route_type: input.route_type,
      distance_km: live.distanceKm,
      estimated_duration_min: live.estimatedDurationMin,
      polyline: live.polyline,
      source: live.fallbackUsed ? 'haversine_fallback' : 'osrm_live',
      fallback_used: live.fallbackUsed,
      lookup_ms: lookupMs,
    };
  }

  if (!input.custom_coords) {
    throw new HttpError(
      400,
      'Either destination_shop_id or custom_coords must be provided'
    );
  }

  const startMs = performance.now();
  const live = await getRoadDistance(
    { lat: Number(originShop.latitude), lng: Number(originShop.longitude) },
    input.custom_coords,
    input.route_type,
    routingOptions
  );
  const lookupMs = Number((performance.now() - startMs).toFixed(3));

  return {
    origin_shop: mapShopSummary(originShop),
    destination_shop: null,
    custom_coords: input.custom_coords,
    route_type: input.route_type,
    distance_km: live.distanceKm,
    estimated_duration_min: live.estimatedDurationMin,
    polyline: live.polyline,
    source: live.fallbackUsed ? 'haversine_fallback' : 'osrm_live',
    fallback_used: live.fallbackUsed,
    lookup_ms: lookupMs,
  };
}

async function upsertOdMatrixEntry(
  pool: pg.Pool,
  entry: {
    originShopId: string;
    destinationShopId: string;
    routeType: RouteType;
    distanceKm: number;
    estimatedDurationMin: number;
    routePolyline: string;
  }
): Promise<void> {
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
    [
      entry.originShopId,
      entry.destinationShopId,
      entry.routeType,
      entry.distanceKm,
      entry.estimatedDurationMin,
      entry.routePolyline,
    ]
  );
}

/**
 * Recomputes all origin-destination matrix rows for either the entire active
 * branch network or every pair involving a specific shop.
 */
export async function recomputeOdMatrix(
  pool: pg.Pool,
  options?: { shopId?: string; routingOptions?: RoutingOptions }
): Promise<RecomputeMatrixSummary> {
  const startMs = performance.now();
  const { rows: shops } = await pool.query<ShopRow>(`
    SELECT id, code, name, city, address, latitude, longitude, is_active, created_at, updated_at
    FROM shops
    WHERE is_active = TRUE
    ORDER BY code ASC
  `);

  const targetShopId = options?.shopId ?? null;
  if (targetShopId && !shops.some((s) => s.id === targetShopId)) {
    throw new HttpError(404, `Active shop not found for recompute: ${targetShopId}`);
  }

  let interBranchRows = 0;
  let selfRows = 0;
  let fallbackCount = 0;

  const pairs: Array<{ origin: ShopRow; dest: ShopRow }> = [];
  for (const origin of shops) {
    for (const dest of shops) {
      if (targetShopId && origin.id !== targetShopId && dest.id !== targetShopId) {
        continue;
      }
      pairs.push({ origin, dest });
    }
  }

  for (const routeType of ['toll', 'nontoll'] as const) {
    for (const { origin, dest } of pairs) {
      if (origin.id === dest.id) {
        await upsertOdMatrixEntry(pool, {
          originShopId: origin.id,
          destinationShopId: dest.id,
          routeType,
          distanceKm: 0,
          estimatedDurationMin: 0,
          routePolyline: JSON.stringify({
            type: 'LineString',
            coordinates: [
              [Number(origin.longitude), Number(origin.latitude)],
              [Number(origin.longitude), Number(origin.latitude)],
            ],
          }),
        });
        selfRows += 1;
        continue;
      }

      const route = await getRoadDistance(
        { lat: Number(origin.latitude), lng: Number(origin.longitude) },
        { lat: Number(dest.latitude), lng: Number(dest.longitude) },
        routeType,
        options?.routingOptions
      );

      if (route.fallbackUsed) {
        fallbackCount += 1;
      }

      await upsertOdMatrixEntry(pool, {
        originShopId: origin.id,
        destinationShopId: dest.id,
        routeType,
        distanceKm: route.distanceKm,
        estimatedDurationMin: route.estimatedDurationMin,
        routePolyline: JSON.stringify(route.polyline),
      });
      interBranchRows += 1;
    }
  }

  const durationMs = Number((performance.now() - startMs).toFixed(2));
  return {
    scope: targetShopId ? 'shop' : 'full',
    shop_id: targetShopId,
    active_shops_count: shops.length,
    recomputed_rows: interBranchRows + selfRows,
    inter_branch_rows: interBranchRows,
    self_rows: selfRows,
    fallback_count: fallbackCount,
    duration_ms: durationMs,
    updated_at: new Date().toISOString(),
  };
}
