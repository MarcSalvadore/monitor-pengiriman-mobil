import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import {
  PayrollCalculator,
  type RateCardRecord,
} from '../src/lib/services/payroll.js';

const pool = createPool();
const app = createApp(pool);

const TEST_SUPERVISOR = 'SUP-BOLT03-TEST';

const TIER_1_CARD: RateCardRecord = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Tier 1 Short Haul (<= 15 km)',
  effective_from: '2026-01-01',
  effective_to: '2026-06-30',
  min_km: 5,
  max_km: 15.0,
  base_fare: 35000,
  rate_per_km: 6000,
  flat_trip_allowance: 25000,
  toll_allowance: 45000,
  is_active: true,
};

const TIER_2_CARD: RateCardRecord = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Tier 2 Long Haul (> 15 km)',
  effective_from: '2026-01-01',
  effective_to: '2026-06-30',
  min_km: 15,
  max_km: 999.99,
  base_fare: 100000,
  rate_per_km: 8000,
  flat_trip_allowance: 30000,
  toll_allowance: 50000,
  is_active: true,
};

const NEW_MIDYEAR_CARD: RateCardRecord = {
  id: '33333333-3333-3333-3333-333333333333',
  name: 'H2 2026 Updated Rate',
  effective_from: '2026-07-01',
  effective_to: null,
  min_km: 5,
  max_km: 999.99,
  base_fare: 40000,
  rate_per_km: 6500,
  flat_trip_allowance: 25000,
  toll_allowance: 50000,
  is_active: true,
};

describe('Bolt 03: PayrollCalculator Unit Boundary Tests', () => {
  it('rejects 0 km and negative distances', () => {
    expect(() =>
      PayrollCalculator.computeDriverBenefit(0, 'nontoll', TIER_1_CARD)
    ).toThrow(/greater than 0 km/i);

    expect(() =>
      PayrollCalculator.computeDriverBenefit(-3.5, 'toll', TIER_1_CARD)
    ).toThrow(/greater than 0 km/i);
  });

  it('handles min_km threshold (5.00 km vs 5.01 km) and toll allowance accurately', () => {
    const atThresholdNonToll = PayrollCalculator.computeDriverBenefit(
      5.0,
      'nontoll',
      TIER_1_CARD
    );
    expect(atThresholdNonToll).toEqual({
      variablePay: 35000,
      flatTripAllowance: 25000,
      baseBenefit: 60000,
      tollReimbursement: 0,
      totalBenefit: 60000,
    });

    const overThresholdToll = PayrollCalculator.computeDriverBenefit(
      5.01,
      'toll',
      TIER_1_CARD
    );
    expect(overThresholdToll).toEqual({
      variablePay: 35060,
      flatTripAllowance: 25000,
      baseBenefit: 60060,
      tollReimbursement: 45000,
      totalBenefit: 105060,
    });
  });

  it('transitions cleanly across tier boundaries (15.00 km vs 15.01 km)', () => {
    const cards = [TIER_1_CARD, TIER_2_CARD];

    const at15 = PayrollCalculator.evaluateDelivery({
      distanceKm: 15.0,
      routeType: 'nontoll',
      deliveryDate: '2026-03-15',
      rateCards: cards,
    });
    expect(at15.appliedRateCard.id).toBe(TIER_1_CARD.id);
    // 35000 + (15 - 5)*6000 + 25000 = 120000
    expect(at15.totalBenefit).toBe(120000);

    const at1501 = PayrollCalculator.evaluateDelivery({
      distanceKm: 15.01,
      routeType: 'nontoll',
      deliveryDate: '2026-03-15',
      rateCards: cards,
    });
    expect(at1501.appliedRateCard.id).toBe(TIER_2_CARD.id);
    // 100000 + round(0.01 * 8000) + 30000 = 130080
    expect(at1501.totalBenefit).toBe(130080);
  });

  it('handles rate-card effective_from and effective_to date transitions', () => {
    const cards = [TIER_1_CARD, TIER_2_CARD, NEW_MIDYEAR_CARD];

    expect(() =>
      PayrollCalculator.evaluateDelivery({
        distanceKm: 10,
        routeType: 'nontoll',
        deliveryDate: '2025-12-31',
        rateCards: cards,
      })
    ).toThrow(/No active rate card/i);

    const lastDayH1 = PayrollCalculator.evaluateDelivery({
      distanceKm: 10,
      routeType: 'toll',
      deliveryDate: '2026-06-30',
      rateCards: cards,
    });
    expect(lastDayH1.appliedRateCard.id).toBe(TIER_1_CARD.id);
    expect(lastDayH1.totalBenefit).toBe(35000 + 5 * 6000 + 25000 + 45000);

    const firstDayH2 = PayrollCalculator.evaluateDelivery({
      distanceKm: 10,
      routeType: 'toll',
      deliveryDate: '2026-07-01',
      rateCards: cards,
    });
    expect(firstDayH2.appliedRateCard.id).toBe(NEW_MIDYEAR_CARD.id);
    expect(firstDayH2.totalBenefit).toBe(40000 + 5 * 6500 + 25000 + 50000);
  });
});

describe('Bolt 03: Immutable Delivery Ledger & Voiding Integration Tests', () => {
  afterAll(async () => {
    await pool.query(
      `DELETE FROM delivery_logs WHERE supervisor_id = $1`,
      [TEST_SUPERVISOR]
    );
    await pool.query(
      `DELETE FROM rate_cards WHERE name LIKE 'Test Bolt03%'`
    );
    await pool.end();
  });

  it('rejects 0 km same-shop transfer with HTTP 400', async () => {
    const res = await request(app)
      .post('/api/deliveries')
      .send({
        delivery_date: '2026-11-17',
        driver_id: 'DRV-001',
        vehicle_vin: 'MHFAB32026ZERO001',
        vehicle_plate: 'B 1000 TST',
        origin_shop_id: 'JKT-SUN',
        destination_shop_id: 'JKT-SUN',
        route_type: 'nontoll',
        supervisor_id: TEST_SUPERVISOR,
      })
      .expect(400);

    expect(res.body.error).toMatch(/0 km|identical/i);
  });

  it('snapshots distance, rate card, and IDR payout immutably and rejects duplicate VIN overlap', async () => {
    // 1. Create inter-branch toll delivery JKT-SUN -> BGR-PAJ (58.89 km)
    const createRes = await request(app)
      .post('/api/deliveries')
      .send({
        delivery_date: '2026-11-17',
        driver_id: 'DRV-001',
        vehicle_vin: 'mhfAb32026bOLt001',
        vehicle_plate: 'b 1234 klm',
        origin_shop_id: 'JKT-SUN',
        destination_shop_id: 'BGR-PAJ',
        route_type: 'toll',
        supervisor_id: TEST_SUPERVISOR,
      })
      .expect(201);

    const deliveryId = createRes.body.delivery.id as string;
    expect(createRes.body.delivery.status).toBe('verified');
    expect(createRes.body.delivery.vehicle_vin).toBe('MHFAB32026BOLT001');
    expect(createRes.body.delivery.vehicle_plate).toBe('B 1234 KLM');
    expect(createRes.body.delivery.computed_distance_km).toBe(58.89);
    // 35000 + round((58.89 - 5) * 6000) + 25000 + 45000 = 428340
    expect(createRes.body.delivery.calculated_benefit_amount).toBe(428340);
    expect(createRes.body.benefit_breakdown.totalBenefit).toBe(428340);

    // 2. Reject duplicate VIN transfer overlap for same driver within 60 minutes
    await request(app)
      .post('/api/deliveries')
      .send({
        delivery_date: '2026-11-17',
        driver_id: 'DRV-001',
        vehicle_vin: 'MHFAB32026BOLT001',
        vehicle_plate: 'B 1234 KLM',
        origin_shop_id: 'JKT-SUN',
        destination_shop_id: 'BGR-PAJ',
        route_type: 'toll',
        supervisor_id: TEST_SUPERVISOR,
      })
      .expect(409);

    // 3. Create a newer rate card effective 2026-11-01 and verify old log stays immutable
    const newCardRes = await request(app)
      .post('/api/rate-cards')
      .send({
        name: 'Test Bolt03 Premium Nov 2026',
        effective_from: '2026-11-01',
        effective_to: null,
        min_km: 5,
        max_km: 999.99,
        base_fare: 90000,
        rate_per_km: 12000,
        flat_trip_allowance: 30000,
        toll_allowance: 50000,
      })
      .expect(201);

    const newCardId = newCardRes.body.rate_card.id as string;

    // Historical log must still equal 428340
    const listBeforeVoid = await request(app)
      .get(`/api/deliveries?search=MHFAB32026BOLT001`)
      .expect(200);
    expect(listBeforeVoid.body.deliveries[0].calculated_benefit_amount).toBe(
      428340
    );

    // New delivery uses the newer effective rate card
    const newDeliveryRes = await request(app)
      .post('/api/deliveries')
      .send({
        delivery_date: '2026-11-17',
        driver_id: 'DRV-002',
        vehicle_vin: 'MHFAB32026BOLT003',
        vehicle_plate: 'B 9999 XYZ',
        origin_shop_id: 'JKT-SUN',
        custom_coords: { lat: -6.2297, lng: 106.8095 },
        route_type: 'nontoll',
        supervisor_id: TEST_SUPERVISOR,
      })
      .expect(201);

    expect(newDeliveryRes.body.delivery.applied_rate_card_id).toBe(newCardId);
    expect(newDeliveryRes.body.delivery.custom_destination_lat).toBeCloseTo(
      -6.2297,
      4
    );

    // Referenced rate card cannot be deleted (audit protection)
    await request(app).delete(`/api/rate-cards/${newCardId}`).expect(409);

    // 4. Voiding workflow: require mandatory void_reason and allow re-logging once voided
    await request(app)
      .patch(`/api/deliveries/${deliveryId}/void`)
      .send({ void_reason: '' })
      .expect(400);

    const voidRes = await request(app)
      .patch(`/api/deliveries/${deliveryId}/void`)
      .send({ void_reason: 'Duplicate entry corrected by branch supervisor' })
      .expect(200);

    expect(voidRes.body.delivery.status).toBe('voided');
    expect(voidRes.body.delivery.void_reason).toBe(
      'Duplicate entry corrected by branch supervisor'
    );
    expect(voidRes.body.delivery.calculated_benefit_amount).toBe(428340);

    // Already-voided delivery cannot be voided twice
    await request(app)
      .patch(`/api/deliveries/${deliveryId}/void`)
      .send({ void_reason: 'Second attempt' })
      .expect(409);

    // Re-logging the VIN after voiding the erroneous record succeeds using the new active card
    const relogRes = await request(app)
      .post('/api/deliveries')
      .send({
        delivery_date: '2026-11-17',
        driver_id: 'DRV-001',
        vehicle_vin: 'MHFAB32026BOLT001',
        vehicle_plate: 'B 1234 KLM',
        origin_shop_id: 'JKT-SUN',
        destination_shop_id: 'BGR-PAJ',
        route_type: 'toll',
        supervisor_id: TEST_SUPERVISOR,
      })
      .expect(201);

    expect(relogRes.body.delivery.applied_rate_card_id).toBe(newCardId);
    // 90000 + round((58.89 - 5) * 12000) + 30000 + 50000 = 816680
    expect(relogRes.body.delivery.calculated_benefit_amount).toBe(816680);
  });
});
