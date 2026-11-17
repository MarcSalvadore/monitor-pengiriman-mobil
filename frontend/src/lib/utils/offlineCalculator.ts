import type {
  BenefitBreakdown,
  Coordinates,
  GeoJsonLineString,
  OdMatrixEntry,
  RateCard,
  RoutePreview,
  RouteType,
  Shop,
} from '../../types/domain';

const EARTH_RADIUS_KM = 6371;

export function formatIdr(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

export function getTodayWibDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

export function calculateHaversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((EARTH_RADIUS_KM * c).toFixed(2));
}

export function computeBenefitClient(
  distanceKm: number,
  routeType: RouteType,
  deliveryDate: string,
  rateCards: RateCard[]
): BenefitBreakdown | null {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || rateCards.length === 0) {
    return null;
  }

  const eligible = rateCards.filter((card) => {
    if (!card.is_active) return false;
    if (card.effective_from > deliveryDate) return false;
    if (card.effective_to && card.effective_to < deliveryDate) return false;
    return distanceKm <= Number(card.max_km);
  });

  if (eligible.length === 0) return null;

  eligible.sort((a, b) => {
    const dateDiff = b.effective_from.localeCompare(a.effective_from);
    if (dateDiff !== 0) return dateDiff;
    return Number(a.max_km) - Number(b.max_km);
  });

  const card = eligible[0];
  let variablePay = Number(card.base_fare);
  if (distanceKm > Number(card.min_km)) {
    variablePay += Math.round(
      (distanceKm - Number(card.min_km)) * Number(card.rate_per_km)
    );
  }

  const flatTripAllowance = Number(card.flat_trip_allowance);
  const baseBenefit = variablePay + flatTripAllowance;
  const tollReimbursement =
    routeType === 'toll' ? Number(card.toll_allowance) : 0;

  return {
    variablePay,
    flatTripAllowance,
    baseBenefit,
    tollReimbursement,
    totalBenefit: baseBenefit + tollReimbursement,
    appliedRateCardName: card.name,
  };
}

export function resolveOfflineRoutePreview(
  originShop: Shop,
  destShop: Shop | null,
  customCoords: Coordinates | null,
  routeType: RouteType,
  odMatrix: OdMatrixEntry[]
): RoutePreview | null {
  if (destShop) {
    if (originShop.id === destShop.id) {
      return {
        distance_km: 0,
        estimated_duration_min: 0,
        polyline: null,
        source: 'offline_cache',
        fallback_used: false,
      };
    }

    const match = odMatrix.find(
      (entry) =>
        entry.origin_shop_id === originShop.id &&
        entry.destination_shop_id === destShop.id &&
        entry.route_type === routeType
    );

    if (match) {
      let parsedPolyline: GeoJsonLineString | null = null;
      if (match.route_polyline) {
        try {
          parsedPolyline = JSON.parse(match.route_polyline) as GeoJsonLineString;
        } catch {
          parsedPolyline = null;
        }
      }

      return {
        distance_km: Number(match.distance_km),
        estimated_duration_min: Number(match.estimated_duration_min),
        polyline: parsedPolyline,
        source: 'offline_cache',
        fallback_used: false,
      };
    }

    const fallbackKm = calculateHaversineKm(
      originShop.latitude,
      originShop.longitude,
      destShop.latitude,
      destShop.longitude
    );
    return {
      distance_km: fallbackKm,
      estimated_duration_min: Number(((fallbackKm / 35) * 60).toFixed(2)),
      polyline: {
        type: 'LineString',
        coordinates: [
          [originShop.longitude, originShop.latitude],
          [destShop.longitude, destShop.latitude],
        ],
      },
      source: 'haversine_fallback',
      fallback_used: true,
    };
  }

  if (customCoords) {
    const fallbackKm = calculateHaversineKm(
      originShop.latitude,
      originShop.longitude,
      customCoords.lat,
      customCoords.lng
    );
    return {
      distance_km: fallbackKm,
      estimated_duration_min: Number(((fallbackKm / 35) * 60).toFixed(2)),
      polyline: {
        type: 'LineString',
        coordinates: [
          [originShop.longitude, originShop.latitude],
          [customCoords.lng, customCoords.lat],
        ],
      },
      source: 'haversine_fallback',
      fallback_used: true,
    };
  }

  return null;
}
