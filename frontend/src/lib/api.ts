import type {
  BenefitBreakdown,
  Coordinates,
  DeliveryLog,
  Driver,
  OdMatrixEntry,
  RateCard,
  RoutePreview,
  RouteType,
  Shop,
} from '../types/domain';
import type { CreateDeliveryPayload } from '../types/domain';

export class ApiHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const errBody = (await res.json()) as { error?: string };
      if (errBody.error) message = errBody.error;
    } catch {
      // Ignore parse failure
    }
    throw new ApiHttpError(res.status, message);
  }

  return (await res.json()) as T;
}

export async function fetchShops(): Promise<Shop[]> {
  const data = await fetchJson<{ shops: Shop[] }>('/api/shops');
  return data.shops;
}

export async function createShop(payload: {
  code: string;
  name: string;
  city: string;
  address: string;
  latitude: number;
  longitude: number;
}): Promise<{ shop: Shop }> {
  return fetchJson('/api/shops', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateShop(
  id: string,
  payload: Partial<Omit<Shop, 'id'>>
): Promise<{ shop: Shop }> {
  return fetchJson(`/api/shops/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function recomputeOdMatrix(): Promise<{
  recomputed_rows: number;
  duration_ms: number;
}> {
  return fetchJson('/api/shops/recompute-matrix', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function fetchDrivers(): Promise<Driver[]> {
  const data = await fetchJson<{ drivers: Driver[] }>('/api/drivers');
  return data.drivers;
}

export async function fetchRateCards(): Promise<RateCard[]> {
  const data = await fetchJson<{ rate_cards: RateCard[] }>('/api/rate-cards');
  return data.rate_cards;
}

export async function createRateCard(payload: {
  name: string;
  effective_from: string;
  effective_to?: string | null;
  min_km: number;
  max_km: number;
  base_fare: number;
  rate_per_km: number;
  flat_trip_allowance: number;
  toll_allowance: number;
}): Promise<{ rate_card: RateCard }> {
  return fetchJson('/api/rate-cards', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchOdMatrix(): Promise<OdMatrixEntry[]> {
  const data = await fetchJson<{ entries: OdMatrixEntry[] }>('/api/od-matrix');
  return data.entries;
}

export async function calculateRouteApi(payload: {
  origin_shop_id: string;
  destination_shop_id?: string;
  custom_coords?: Coordinates;
  route_type: RouteType;
}): Promise<RoutePreview> {
  return fetchJson<RoutePreview>('/api/routes/calculate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchDeliveries(params?: {
  status?: string;
  search?: string;
}): Promise<DeliveryLog[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.search) qs.set('search', params.search);
  const query = qs.toString();
  const data = await fetchJson<{ deliveries: DeliveryLog[] }>(
    `/api/deliveries${query ? `?${query}` : ''}`
  );
  return data.deliveries;
}

export async function submitDeliveryApi(payload: CreateDeliveryPayload): Promise<{
  delivery: DeliveryLog;
  benefit_breakdown: BenefitBreakdown;
  route: RoutePreview;
}> {
  return fetchJson('/api/deliveries', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function voidDeliveryApi(
  id: string,
  voidReason: string
): Promise<{ delivery: DeliveryLog }> {
  return fetchJson(`/api/deliveries/${id}/void`, {
    method: 'PATCH',
    body: JSON.stringify({ void_reason: voidReason }),
  });
}
