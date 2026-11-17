import { HttpError } from './odMatrix.js';
import type { RouteType } from './routing.js';

export interface RateCardRecord {
  id: string;
  name: string;
  effective_from: string;
  effective_to: string | null;
  min_km: number;
  max_km: number;
  base_fare: number;
  rate_per_km: number;
  flat_trip_allowance: number;
  toll_allowance: number;
  is_active?: boolean;
  created_at?: string;
}

export interface DriverBenefitBreakdown {
  variablePay: number;
  flatTripAllowance: number;
  baseBenefit: number;
  tollReimbursement: number;
  totalBenefit: number;
}

export interface BenefitCalculationResult extends DriverBenefitBreakdown {
  appliedRateCard: RateCardRecord;
  distanceKm: number;
  routeType: RouteType;
  deliveryDate: string;
}

export interface EvaluateDeliveryInput {
  distanceKm: number;
  routeType: RouteType;
  deliveryDate: string;
  rateCards: RateCardRecord[];
}

function assertPositiveDistance(distanceKm: number): void {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    throw new HttpError(
      400,
      'Delivery distance must be greater than 0 km (same-shop transfers are not permitted)'
    );
  }
}

/**
 * Pure deterministic driver benefit formula ported from docs/ARCHITECTURE.md.
 * Rounds variable excess-km pay to nearest whole IDR and adds flat allowances.
 */
export function computeDriverBenefit(
  distanceKm: number,
  routeType: RouteType,
  rateCard: Pick<
    RateCardRecord,
    'min_km' | 'base_fare' | 'rate_per_km' | 'flat_trip_allowance' | 'toll_allowance'
  >
): DriverBenefitBreakdown {
  assertPositiveDistance(distanceKm);

  const minKm = Number(rateCard.min_km);
  const baseFare = Number(rateCard.base_fare);
  const ratePerKm = Number(rateCard.rate_per_km);
  const flatTripAllowance = Number(rateCard.flat_trip_allowance);
  const tollAllowance = Number(rateCard.toll_allowance);

  let variablePay = baseFare;
  if (distanceKm > minKm) {
    variablePay += Math.round((distanceKm - minKm) * ratePerKm);
  }

  const baseBenefit = variablePay + flatTripAllowance;
  const tollReimbursement = routeType === 'toll' ? tollAllowance : 0;
  const totalBenefit = baseBenefit + tollReimbursement;

  return {
    variablePay,
    flatTripAllowance,
    baseBenefit,
    tollReimbursement,
    totalBenefit,
  };
}

/**
 * Selects the applicable active rate card for a given distance and delivery date.
 * Prefers the newest effective_from cohort and tightest max_km tier boundary.
 */
export function selectApplicableRateCard(
  distanceKm: number,
  deliveryDate: string,
  rateCards: RateCardRecord[]
): RateCardRecord {
  assertPositiveDistance(distanceKm);

  const eligible = rateCards.filter((card) => {
    if (card.is_active === false) return false;
    if (card.effective_from > deliveryDate) return false;
    if (card.effective_to && card.effective_to < deliveryDate) return false;
    return distanceKm <= Number(card.max_km);
  });

  if (eligible.length === 0) {
    throw new HttpError(
      422,
      `No active rate card covers distance ${distanceKm} km on ${deliveryDate}`
    );
  }

  eligible.sort((a, b) => {
    const dateOrder = b.effective_from.localeCompare(a.effective_from);
    if (dateOrder !== 0) return dateOrder;

    const maxKmOrder = Number(a.max_km) - Number(b.max_km);
    if (maxKmOrder !== 0) return maxKmOrder;

    return (b.created_at || '').localeCompare(a.created_at || '');
  });

  return eligible[0];
}

export function evaluateDelivery(
  input: EvaluateDeliveryInput
): BenefitCalculationResult {
  const appliedRateCard = selectApplicableRateCard(
    input.distanceKm,
    input.deliveryDate,
    input.rateCards
  );
  const breakdown = computeDriverBenefit(
    input.distanceKm,
    input.routeType,
    appliedRateCard
  );

  return {
    appliedRateCard,
    distanceKm: input.distanceKm,
    routeType: input.routeType,
    deliveryDate: input.deliveryDate,
    ...breakdown,
  };
}

export const PayrollCalculator = {
  computeDriverBenefit,
  selectApplicableRateCard,
  evaluateDelivery,
};
