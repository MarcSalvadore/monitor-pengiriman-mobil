import { calculateDeliveryDistance } from '../utils/delivery.js';

export type RouteType = 'toll' | 'nontoll';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface GeoJsonLineString {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface RoadDistanceResult {
  distanceKm: number;
  estimatedDurationMin: number;
  polyline: GeoJsonLineString;
  fallbackUsed: boolean;
}

export interface RoutingOptions {
  timeoutMs?: number;
  tollBaseUrl?: string;
  nontollBaseUrl?: string;
}

interface OsrmRouteResponse {
  code: string;
  message?: string;
  routes?: Array<{
    distance: number;
    duration: number;
    geometry: GeoJsonLineString;
  }>;
}

export function getOsrmBaseUrl(
  routeType: RouteType,
  options?: RoutingOptions
): string {
  if (routeType === 'toll') {
    return (
      options?.tollBaseUrl ||
      process.env.OSRM_TOLL_URL ||
      'http://localhost:5050'
    );
  }
  return (
    options?.nontollBaseUrl ||
    process.env.OSRM_NONTOLL_URL ||
    'http://localhost:5001'
  );
}

/**
 * Queries the local Dockerized OSRM instance (`car-toll` or `car-nontoll`) with
 * a 3,000 ms timeout and falls back to Haversine distance if OSRM is unreachable.
 */
export async function getRoadDistance(
  origin: Coordinates,
  destination: Coordinates,
  routeType: RouteType = 'nontoll',
  options?: RoutingOptions
): Promise<RoadDistanceResult> {
  const timeoutMs = options?.timeoutMs ?? 3000;
  const baseUrl = getOsrmBaseUrl(routeType, options).replace(/\/$/, '');
  const url = `${baseUrl}/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`OSRM routing failed with HTTP ${res.status}`);
    }

    const data = (await res.json()) as OsrmRouteResponse;
    if (data.code === 'Ok' && Array.isArray(data.routes) && data.routes.length > 0) {
      const route = data.routes[0];
      return {
        distanceKm: Number((route.distance / 1000).toFixed(2)),
        estimatedDurationMin: Number((route.duration / 60).toFixed(2)),
        polyline: route.geometry,
        fallbackUsed: false,
      };
    }

    throw new Error(data.message || 'No route found');
  } catch {
    const fallbackKm = Number(
      calculateDeliveryDistance(
        origin.lat,
        origin.lng,
        destination.lat,
        destination.lng
      ).toFixed(2)
    );
    const estimatedDurationMin = Number(((fallbackKm / 35) * 60).toFixed(2));
    return {
      distanceKm: fallbackKm,
      estimatedDurationMin,
      polyline: {
        type: 'LineString',
        coordinates: [
          [origin.lng, origin.lat],
          [destination.lng, destination.lat],
        ],
      },
      fallbackUsed: true,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function checkOsrmHealth(
  routeType: RouteType,
  options?: RoutingOptions
): Promise<boolean> {
  const baseUrl = getOsrmBaseUrl(routeType, options).replace(/\/$/, '');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(
      `${baseUrl}/nearest/v1/driving/106.8765,-6.1462`,
      { signal: controller.signal }
    );
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
