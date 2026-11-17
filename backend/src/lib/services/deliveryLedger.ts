import type pg from 'pg';
import {
  calculateRoute,
  HttpError,
  resolveShop,
  type CalculateRouteResult,
} from './odMatrix.js';
import {
  PayrollCalculator,
  type DriverBenefitBreakdown,
  type RateCardRecord,
} from './payroll.js';
import type { Coordinates, RouteType, RoutingOptions } from './routing.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DriverRow {
  id: string;
  employee_code: string;
  full_name: string;
  phone_number: string | null;
  base_shop_id: string | null;
  base_fixed_salary: number;
  is_active: boolean;
}

export interface DeliveryLogRow {
  id: string;
  delivery_date: string;
  driver_id: string;
  driver_code?: string;
  driver_name?: string;
  vehicle_vin: string;
  vehicle_plate: string;
  origin_shop_id: string;
  origin_code?: string;
  origin_name?: string;
  destination_shop_id: string | null;
  destination_code?: string | null;
  destination_name?: string | null;
  custom_destination_lat: number | null;
  custom_destination_lng: number | null;
  route_type: RouteType;
  computed_distance_km: number;
  applied_rate_card_id: string;
  applied_rate_card_name?: string;
  calculated_benefit_amount: number;
  supervisor_id: string;
  status: 'pending' | 'verified' | 'voided';
  void_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDeliveryInput {
  delivery_date?: string;
  driver_id: string;
  vehicle_vin: string;
  vehicle_plate: string;
  origin_shop_id: string;
  destination_shop_id?: string;
  custom_coords?: Coordinates;
  route_type: RouteType;
  supervisor_id: string;
}

export interface CreateDeliveryResult {
  delivery: DeliveryLogRow;
  benefit_breakdown: DriverBenefitBreakdown;
  route: CalculateRouteResult;
}

export interface CreateRateCardInput {
  name: string;
  effective_from: string;
  effective_to?: string | null;
  min_km: number;
  max_km: number;
  base_fare: number;
  rate_per_km: number;
  flat_trip_allowance: number;
  toll_allowance: number;
  is_active?: boolean;
}

export type UpdateRateCardInput = Partial<CreateRateCardInput>;

export interface DeliveryListFilters {
  start_date?: string;
  end_date?: string;
  driver_id?: string;
  shop_id?: string;
  status?: 'pending' | 'verified' | 'voided';
  search?: string;
}

function mapRateCard(row: Record<string, unknown>): RateCardRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    effective_from: String(row.effective_from),
    effective_to: row.effective_to ? String(row.effective_to) : null,
    min_km: Number(row.min_km),
    max_km: Number(row.max_km),
    base_fare: Number(row.base_fare),
    rate_per_km: Number(row.rate_per_km),
    flat_trip_allowance: Number(row.flat_trip_allowance),
    toll_allowance: Number(row.toll_allowance),
    is_active: Boolean(row.is_active),
    created_at: row.created_at ? String(row.created_at) : undefined,
  };
}

function mapDeliveryRow(row: Record<string, unknown>): DeliveryLogRow {
  return {
    id: String(row.id),
    delivery_date: String(row.delivery_date),
    driver_id: String(row.driver_id),
    driver_code: row.driver_code ? String(row.driver_code) : undefined,
    driver_name: row.driver_name ? String(row.driver_name) : undefined,
    vehicle_vin: String(row.vehicle_vin),
    vehicle_plate: String(row.vehicle_plate),
    origin_shop_id: String(row.origin_shop_id),
    origin_code: row.origin_code ? String(row.origin_code) : undefined,
    origin_name: row.origin_name ? String(row.origin_name) : undefined,
    destination_shop_id: row.destination_shop_id
      ? String(row.destination_shop_id)
      : null,
    destination_code: row.destination_code ? String(row.destination_code) : null,
    destination_name: row.destination_name ? String(row.destination_name) : null,
    custom_destination_lat:
      row.custom_destination_lat !== null &&
      row.custom_destination_lat !== undefined
        ? Number(row.custom_destination_lat)
        : null,
    custom_destination_lng:
      row.custom_destination_lng !== null &&
      row.custom_destination_lng !== undefined
        ? Number(row.custom_destination_lng)
        : null,
    route_type: row.route_type as RouteType,
    computed_distance_km: Number(row.computed_distance_km),
    applied_rate_card_id: String(row.applied_rate_card_id),
    applied_rate_card_name: row.applied_rate_card_name
      ? String(row.applied_rate_card_name)
      : undefined,
    calculated_benefit_amount: Number(row.calculated_benefit_amount),
    supervisor_id: String(row.supervisor_id),
    status: row.status as 'pending' | 'verified' | 'voided',
    void_reason: row.void_reason ? String(row.void_reason) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function resolveDriver(
  pool: pg.Pool,
  idOrCode: string
): Promise<DriverRow> {
  const query = UUID_REGEX.test(idOrCode)
    ? `SELECT id, employee_code, full_name, phone_number, base_shop_id, base_fixed_salary::float, is_active FROM drivers WHERE id = $1`
    : `SELECT id, employee_code, full_name, phone_number, base_shop_id, base_fixed_salary::float, is_active FROM drivers WHERE employee_code = $1`;

  const { rows } = await pool.query<DriverRow>(query, [idOrCode]);
  if (rows.length === 0) {
    throw new HttpError(404, `Driver not found: ${idOrCode}`);
  }
  if (!rows[0].is_active) {
    throw new HttpError(400, `Driver is inactive: ${rows[0].employee_code}`);
  }
  return rows[0];
}

export async function listRateCards(
  pool: pg.Pool,
  includeInactive = false
): Promise<RateCardRecord[]> {
  const whereClause = includeInactive ? '' : 'WHERE is_active = TRUE';
  const { rows } = await pool.query(
    `
    SELECT id, name, effective_from, effective_to, min_km, max_km,
           base_fare, rate_per_km, flat_trip_allowance, toll_allowance,
           is_active, created_at
    FROM rate_cards
    ${whereClause}
    ORDER BY effective_from DESC, max_km ASC, created_at DESC
    `
  );
  return rows.map(mapRateCard);
}

export async function createRateCard(
  pool: pg.Pool,
  input: CreateRateCardInput
): Promise<RateCardRecord> {
  const { rows } = await pool.query(
    `
    INSERT INTO rate_cards (
      name, effective_from, effective_to, min_km, max_km,
      base_fare, rate_per_km, flat_trip_allowance, toll_allowance, is_active
    )
    VALUES ($1, $2::date, $3::date, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id, name, effective_from, effective_to, min_km, max_km,
              base_fare, rate_per_km, flat_trip_allowance, toll_allowance,
              is_active, created_at
    `,
    [
      input.name,
      input.effective_from,
      input.effective_to ?? null,
      input.min_km,
      input.max_km,
      input.base_fare,
      input.rate_per_km,
      input.flat_trip_allowance,
      input.toll_allowance,
      input.is_active ?? true,
    ]
  );
  return mapRateCard(rows[0]);
}

export async function updateRateCard(
  pool: pg.Pool,
  id: string,
  input: UpdateRateCardInput
): Promise<RateCardRecord> {
  if (!UUID_REGEX.test(id)) {
    throw new HttpError(404, `Rate card not found: ${id}`);
  }

  const existingRes = await pool.query(
    `SELECT id, name, effective_from, effective_to, min_km, max_km,
            base_fare, rate_per_km, flat_trip_allowance, toll_allowance,
            is_active, created_at
     FROM rate_cards WHERE id = $1`,
    [id]
  );

  if (existingRes.rows.length === 0) {
    throw new HttpError(404, `Rate card not found: ${id}`);
  }

  const existing = mapRateCard(existingRes.rows[0]);
  const { rows } = await pool.query(
    `
    UPDATE rate_cards
    SET name = $1,
        effective_from = $2::date,
        effective_to = $3::date,
        min_km = $4,
        max_km = $5,
        base_fare = $6,
        rate_per_km = $7,
        flat_trip_allowance = $8,
        toll_allowance = $9,
        is_active = $10
    WHERE id = $11
    RETURNING id, name, effective_from, effective_to, min_km, max_km,
              base_fare, rate_per_km, flat_trip_allowance, toll_allowance,
              is_active, created_at
    `,
    [
      input.name ?? existing.name,
      input.effective_from ?? existing.effective_from,
      input.effective_to !== undefined ? input.effective_to : existing.effective_to,
      input.min_km ?? existing.min_km,
      input.max_km ?? existing.max_km,
      input.base_fare ?? existing.base_fare,
      input.rate_per_km ?? existing.rate_per_km,
      input.flat_trip_allowance ?? existing.flat_trip_allowance,
      input.toll_allowance ?? existing.toll_allowance,
      input.is_active ?? existing.is_active,
      id,
    ]
  );

  return mapRateCard(rows[0]);
}

export async function deleteRateCard(pool: pg.Pool, id: string): Promise<void> {
  if (!UUID_REGEX.test(id)) {
    throw new HttpError(404, `Rate card not found: ${id}`);
  }
  const { rowCount } = await pool.query('DELETE FROM rate_cards WHERE id = $1', [
    id,
  ]);
  if (!rowCount) {
    throw new HttpError(404, `Rate card not found: ${id}`);
  }
}

const DELIVERY_SELECT_SQL = `
  SELECT
    dl.id,
    dl.delivery_date,
    dl.driver_id,
    d.employee_code AS driver_code,
    d.full_name AS driver_name,
    dl.vehicle_vin,
    dl.vehicle_plate,
    dl.origin_shop_id,
    o.code AS origin_code,
    o.name AS origin_name,
    dl.destination_shop_id,
    dest.code AS destination_code,
    dest.name AS destination_name,
    ST_Y(dl.custom_destination_geom) AS custom_destination_lat,
    ST_X(dl.custom_destination_geom) AS custom_destination_lng,
    dl.route_type,
    dl.computed_distance_km,
    dl.applied_rate_card_id,
    rc.name AS applied_rate_card_name,
    dl.calculated_benefit_amount,
    dl.supervisor_id,
    dl.status,
    dl.void_reason,
    dl.created_at,
    dl.updated_at
  FROM delivery_logs dl
  JOIN drivers d ON d.id = dl.driver_id
  JOIN shops o ON o.id = dl.origin_shop_id
  LEFT JOIN shops dest ON dest.id = dl.destination_shop_id
  JOIN rate_cards rc ON rc.id = dl.applied_rate_card_id
`;

async function fetchEnrichedDeliveryById(
  pool: pg.Pool,
  id: string
): Promise<DeliveryLogRow | null> {
  const { rows } = await pool.query(
    `${DELIVERY_SELECT_SQL} WHERE dl.id = $1`,
    [id]
  );
  return rows.length > 0 ? mapDeliveryRow(rows[0]) : null;
}

export async function createDeliveryLog(
  pool: pg.Pool,
  input: CreateDeliveryInput,
  routingOptions?: RoutingOptions
): Promise<CreateDeliveryResult> {
  const driver = await resolveDriver(pool, input.driver_id);
  const originShop = await resolveShop(pool, input.origin_shop_id);
  const destShop = input.destination_shop_id
    ? await resolveShop(pool, input.destination_shop_id)
    : null;

  if (destShop && destShop.id === originShop.id) {
    throw new HttpError(
      400,
      'Origin and destination shops cannot be identical (0 km transfer is invalid)'
    );
  }

  const normalizedVin = input.vehicle_vin.trim().toUpperCase();
  const normalizedPlate = input.vehicle_plate.trim().toUpperCase();
  const deliveryDate =
    input.delivery_date ||
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

  // Prevent overlapping duplicate VIN transfer for the same driver within 60 minutes
  const overlapCheck = await pool.query<{ id: string }>(
    `
    SELECT id
    FROM delivery_logs
    WHERE driver_id = $1
      AND UPPER(vehicle_vin) = $2
      AND delivery_date = $3::date
      AND status <> 'voided'
      AND created_at >= (CURRENT_TIMESTAMP - INTERVAL '60 minutes')
    LIMIT 1
    `,
    [driver.id, normalizedVin, deliveryDate]
  );

  if (overlapCheck.rows.length > 0) {
    throw new HttpError(
      409,
      `Duplicate vehicle_vin (${normalizedVin}) transfer overlap for driver ${driver.employee_code} within 60 minutes`
    );
  }

  const route = await calculateRoute(
    pool,
    {
      origin_shop_id: originShop.id,
      destination_shop_id: destShop?.id,
      custom_coords: input.custom_coords,
      route_type: input.route_type,
    },
    routingOptions
  );

  if (route.distance_km <= 0) {
    throw new HttpError(
      400,
      'Computed delivery distance must be greater than 0 km'
    );
  }

  const activeRateCards = await listRateCards(pool, false);
  const evaluation = PayrollCalculator.evaluateDelivery({
    distanceKm: route.distance_km,
    routeType: input.route_type,
    deliveryDate,
    rateCards: activeRateCards,
  });

  const customLng = input.custom_coords ? input.custom_coords.lng : null;
  const customLat = input.custom_coords ? input.custom_coords.lat : null;

  const insertResult = await pool.query<{ id: string }>(
    `
    INSERT INTO delivery_logs (
      delivery_date,
      driver_id,
      vehicle_vin,
      vehicle_plate,
      origin_shop_id,
      destination_shop_id,
      custom_destination_geom,
      route_type,
      computed_distance_km,
      applied_rate_card_id,
      calculated_benefit_amount,
      supervisor_id,
      status
    )
    VALUES (
      $1::date,
      $2,
      $3,
      $4,
      $5,
      $6,
      CASE
        WHEN $7::double precision IS NOT NULL AND $8::double precision IS NOT NULL
        THEN ST_SetSRID(ST_MakePoint($7, $8), 4326)
        ELSE NULL
      END,
      $9::route_type_enum,
      $10,
      $11,
      $12,
      $13,
      'verified'
    )
    RETURNING id
    `,
    [
      deliveryDate,
      driver.id,
      normalizedVin,
      normalizedPlate,
      originShop.id,
      destShop?.id ?? null,
      customLng,
      customLat,
      input.route_type,
      route.distance_km,
      evaluation.appliedRateCard.id,
      evaluation.totalBenefit,
      input.supervisor_id.trim(),
    ]
  );

  const delivery = await fetchEnrichedDeliveryById(pool, insertResult.rows[0].id);
  if (!delivery) {
    throw new HttpError(500, 'Failed to read created delivery log');
  }

  return {
    delivery,
    benefit_breakdown: {
      variablePay: evaluation.variablePay,
      flatTripAllowance: evaluation.flatTripAllowance,
      baseBenefit: evaluation.baseBenefit,
      tollReimbursement: evaluation.tollReimbursement,
      totalBenefit: evaluation.totalBenefit,
    },
    route,
  };
}

export async function voidDeliveryLog(
  pool: pg.Pool,
  deliveryId: string,
  voidReason: string
): Promise<DeliveryLogRow> {
  if (!UUID_REGEX.test(deliveryId)) {
    throw new HttpError(404, `Delivery log not found: ${deliveryId}`);
  }

  const trimmedReason = voidReason.trim();
  if (trimmedReason.length < 3) {
    throw new HttpError(
      400,
      'A descriptive void_reason (minimum 3 characters) is required'
    );
  }

  const existing = await fetchEnrichedDeliveryById(pool, deliveryId);
  if (!existing) {
    throw new HttpError(404, `Delivery log not found: ${deliveryId}`);
  }

  if (existing.status === 'voided') {
    throw new HttpError(409, `Delivery log ${deliveryId} is already voided`);
  }

  await pool.query(
    `
    UPDATE delivery_logs
    SET status = 'voided',
        void_reason = $1
    WHERE id = $2
    `,
    [trimmedReason, deliveryId]
  );

  const updated = await fetchEnrichedDeliveryById(pool, deliveryId);
  if (!updated) {
    throw new HttpError(500, 'Failed to read voided delivery log');
  }
  return updated;
}

export async function listDeliveryLogs(
  pool: pg.Pool,
  filters: DeliveryListFilters
): Promise<DeliveryLogRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.start_date) {
    params.push(filters.start_date);
    conditions.push(`dl.delivery_date >= $${params.length}::date`);
  }
  if (filters.end_date) {
    params.push(filters.end_date);
    conditions.push(`dl.delivery_date <= $${params.length}::date`);
  }
  if (filters.driver_id) {
    const driver = await resolveDriver(pool, filters.driver_id);
    params.push(driver.id);
    conditions.push(`dl.driver_id = $${params.length}`);
  }
  if (filters.shop_id) {
    const shop = await resolveShop(pool, filters.shop_id);
    params.push(shop.id);
    conditions.push(
      `(dl.origin_shop_id = $${params.length} OR dl.destination_shop_id = $${params.length})`
    );
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`dl.status = $${params.length}::delivery_status_enum`);
  }
  if (filters.search) {
    params.push(`%${filters.search.trim()}%`);
    conditions.push(
      `(dl.vehicle_vin ILIKE $${params.length} OR dl.vehicle_plate ILIKE $${params.length} OR d.full_name ILIKE $${params.length})`
    );
  }

  const whereSql =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `${DELIVERY_SELECT_SQL} ${whereSql} ORDER BY dl.delivery_date DESC, dl.created_at DESC`,
    params
  );

  return rows.map(mapDeliveryRow);
}
