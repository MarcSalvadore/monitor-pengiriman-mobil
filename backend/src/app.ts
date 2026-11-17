import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import type pg from 'pg';
import { z, ZodError } from 'zod';
import {
  calculateRoute,
  HttpError,
  recomputeOdMatrix,
  resolveShop,
  type ShopRow,
} from './lib/services/odMatrix.js';
import { checkOsrmHealth, type RoutingOptions } from './lib/services/routing.js';
import {
  createDeliveryLog,
  createRateCard,
  deleteRateCard,
  listDeliveryLogs,
  listRateCards,
  updateRateCard,
  voidDeliveryLog,
} from './lib/services/deliveryLedger.js';

const routeCalculateSchema = z
  .object({
    origin_shop_id: z.string().min(1, 'origin_shop_id is required'),
    destination_shop_id: z.string().min(1).optional(),
    custom_coords: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .optional(),
    route_type: z.enum(['toll', 'nontoll']).default('nontoll'),
  })
  .refine(
    (val) => Boolean(val.destination_shop_id) !== Boolean(val.custom_coords),
    {
      message:
        'Provide exactly one of destination_shop_id or custom_coords (not both)',
    }
  );

const createShopSchema = z.object({
  code: z.string().trim().min(2).max(50),
  name: z.string().trim().min(2).max(150),
  city: z.string().trim().min(2).max(100),
  address: z.string().trim().min(3),
  latitude: z.number().min(-11).max(6),
  longitude: z.number().min(95).max(141),
  is_active: z.boolean().optional().default(true),
});

const updateShopSchema = z
  .object({
    code: z.string().trim().min(2).max(50).optional(),
    name: z.string().trim().min(2).max(150).optional(),
    city: z.string().trim().min(2).max(100).optional(),
    address: z.string().trim().min(3).optional(),
    latitude: z.number().min(-11).max(6).optional(),
    longitude: z.number().min(95).max(141).optional(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (val) =>
      (val.latitude === undefined && val.longitude === undefined) ||
      (val.latitude !== undefined && val.longitude !== undefined),
    {
      message: 'Both latitude and longitude must be provided together when updating coordinates',
    }
  );

const recomputeMatrixSchema = z.object({
  shop_id: z.string().min(1).optional(),
});

const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted as YYYY-MM-DD');

const createRateCardSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    effective_from: dateStringSchema,
    effective_to: dateStringSchema.nullable().optional(),
    min_km: z.number().min(0).default(0),
    max_km: z.number().positive().default(999.99),
    base_fare: z.number().min(0),
    rate_per_km: z.number().min(0),
    flat_trip_allowance: z.number().min(0).default(0),
    toll_allowance: z.number().min(0).default(0),
    is_active: z.boolean().optional().default(true),
  })
  .refine((val) => val.max_km >= val.min_km, {
    message: 'max_km must be greater than or equal to min_km',
  })
  .refine(
    (val) => !val.effective_to || val.effective_to >= val.effective_from,
    {
      message: 'effective_to must be on or after effective_from',
    }
  );

const updateRateCardSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  effective_from: dateStringSchema.optional(),
  effective_to: dateStringSchema.nullable().optional(),
  min_km: z.number().min(0).optional(),
  max_km: z.number().positive().optional(),
  base_fare: z.number().min(0).optional(),
  rate_per_km: z.number().min(0).optional(),
  flat_trip_allowance: z.number().min(0).optional(),
  toll_allowance: z.number().min(0).optional(),
  is_active: z.boolean().optional(),
});

const createDeliverySchema = z
  .object({
    delivery_date: dateStringSchema.optional(),
    driver_id: z.string().min(1, 'driver_id is required'),
    vehicle_vin: z.string().trim().min(4).max(50),
    vehicle_plate: z.string().trim().min(3).max(30),
    origin_shop_id: z.string().min(1, 'origin_shop_id is required'),
    destination_shop_id: z.string().min(1).optional(),
    custom_coords: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .optional(),
    route_type: z.enum(['toll', 'nontoll']).default('nontoll'),
    supervisor_id: z.string().trim().min(2).max(100),
  })
  .refine(
    (val) => Boolean(val.destination_shop_id) !== Boolean(val.custom_coords),
    {
      message:
        'Provide exactly one of destination_shop_id or custom_coords (not both)',
    }
  );

const voidDeliverySchema = z.object({
  void_reason: z
    .string()
    .trim()
    .min(3, 'void_reason must be at least 3 characters'),
});

export interface AppOptions {
  routingOptions?: RoutingOptions;
}

export function createApp(pool: pg.Pool, options?: AppOptions) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', async (_req, res, next) => {
    try {
      const dbResult = await pool.query<{
        shops_count: string;
        drivers_count: string;
        rate_cards_count: string;
        od_matrix_count: string;
      }>(`
        SELECT
          (SELECT COUNT(*) FROM shops)::text AS shops_count,
          (SELECT COUNT(*) FROM drivers)::text AS drivers_count,
          (SELECT COUNT(*) FROM rate_cards)::text AS rate_cards_count,
          (SELECT COUNT(*) FROM od_distance_matrix)::text AS od_matrix_count
      `);

      const [osrmTollOk, osrmNonTollOk] = await Promise.all([
        checkOsrmHealth('toll', options?.routingOptions),
        checkOsrmHealth('nontoll', options?.routingOptions),
      ]);

      const counts = dbResult.rows[0];
      res.json({
        status: 'ok',
        database: 'connected',
        osrm: {
          toll: osrmTollOk ? 'ready' : 'unreachable',
          nontoll: osrmNonTollOk ? 'ready' : 'unreachable',
        },
        counts: {
          shops: Number(counts.shops_count),
          drivers: Number(counts.drivers_count),
          rate_cards: Number(counts.rate_cards_count),
          od_distance_matrix: Number(counts.od_matrix_count),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/shops', async (req, res, next) => {
    try {
      const includeInactive = req.query.include_inactive === 'true';
      const whereClause = includeInactive ? '' : 'WHERE is_active = TRUE';
      const { rows } = await pool.query<ShopRow>(`
        SELECT id, code, name, city, address, latitude, longitude, is_active, created_at, updated_at
        FROM shops
        ${whereClause}
        ORDER BY code ASC
      `);
      res.json({ shops: rows });
    } catch (error) {
      next(error);
    }
  });

  // Register static recompute route before parameterized /api/shops/:id routes
  app.post('/api/shops/recompute-matrix', async (req, res, next) => {
    try {
      const parsed = recomputeMatrixSchema.parse(req.body ?? {});
      let resolvedShopId: string | undefined;
      if (parsed.shop_id) {
        const shop = await resolveShop(pool, parsed.shop_id);
        resolvedShopId = shop.id;
      }

      const summary = await recomputeOdMatrix(pool, {
        shopId: resolvedShopId,
        routingOptions: options?.routingOptions,
      });
      res.json(summary);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/shops', async (req, res, next) => {
    try {
      const payload = createShopSchema.parse(req.body);
      const { rows } = await pool.query<ShopRow>(
        `
        INSERT INTO shops (code, name, city, address, geom, is_active)
        VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7)
        RETURNING id, code, name, city, address, latitude, longitude, is_active, created_at, updated_at
        `,
        [
          payload.code,
          payload.name,
          payload.city,
          payload.address,
          payload.longitude,
          payload.latitude,
          payload.is_active,
        ]
      );

      const createdShop = rows[0];
      let matrixSummary = null;
      if (createdShop.is_active) {
        matrixSummary = await recomputeOdMatrix(pool, {
          shopId: createdShop.id,
          routingOptions: options?.routingOptions,
        });
      }

      res.status(201).json({
        shop: createdShop,
        matrix_recompute: matrixSummary,
      });
    } catch (error) {
      next(error);
    }
  });

  const handleUpdateShop = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const shopParam = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;
      const existing = await resolveShop(pool, shopParam);
      const payload = updateShopSchema.parse(req.body);

      const nextCode = payload.code ?? existing.code;
      const nextName = payload.name ?? existing.name;
      const nextCity = payload.city ?? existing.city;
      const nextAddress = payload.address ?? existing.address;
      const nextLat = payload.latitude ?? Number(existing.latitude);
      const nextLng = payload.longitude ?? Number(existing.longitude);
      const nextActive = payload.is_active ?? existing.is_active;

      const coordsChanged =
        (payload.latitude !== undefined &&
          payload.latitude !== Number(existing.latitude)) ||
        (payload.longitude !== undefined &&
          payload.longitude !== Number(existing.longitude));
      const reactivated = !existing.is_active && nextActive;

      const { rows } = await pool.query<ShopRow>(
        `
        UPDATE shops
        SET code = $1,
            name = $2,
            city = $3,
            address = $4,
            geom = ST_SetSRID(ST_MakePoint($5, $6), 4326),
            is_active = $7
        WHERE id = $8
        RETURNING id, code, name, city, address, latitude, longitude, is_active, created_at, updated_at
        `,
        [
          nextCode,
          nextName,
          nextCity,
          nextAddress,
          nextLng,
          nextLat,
          nextActive,
          existing.id,
        ]
      );

      const updatedShop = rows[0];
      let matrixSummary = null;

      if (updatedShop.is_active && (coordsChanged || reactivated)) {
        matrixSummary = await recomputeOdMatrix(pool, {
          shopId: updatedShop.id,
          routingOptions: options?.routingOptions,
        });
      } else if (existing.is_active && !updatedShop.is_active) {
        await pool.query(
          `DELETE FROM od_distance_matrix WHERE origin_shop_id = $1 OR destination_shop_id = $1`,
          [updatedShop.id]
        );
      }

      res.json({
        shop: updatedShop,
        matrix_recompute: matrixSummary,
      });
    } catch (error) {
      next(error);
    }
  };

  app.patch('/api/shops/:id', handleUpdateShop);
  app.put('/api/shops/:id', handleUpdateShop);

  app.delete('/api/shops/:id', async (req, res, next) => {
    try {
      const shopParam = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;
      const existing = await resolveShop(pool, shopParam);
      await pool.query('DELETE FROM shops WHERE id = $1', [existing.id]);
      res.json({ deleted: true, id: existing.id, code: existing.code });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/drivers', async (_req, res, next) => {
    try {
      const { rows } = await pool.query(`
        SELECT d.id, d.employee_code, d.full_name, d.phone_number,
               d.base_shop_id, s.code AS base_shop_code, s.name AS base_shop_name,
               d.base_fixed_salary::float AS base_fixed_salary,
               d.is_active, d.created_at, d.updated_at
        FROM drivers d
        LEFT JOIN shops s ON s.id = d.base_shop_id
        WHERE d.is_active = TRUE
        ORDER BY d.employee_code ASC
      `);
      res.json({ drivers: rows });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/od-matrix', async (req, res, next) => {
    try {
      const includePolyline = req.query.include_polyline !== 'false';
      const conditions: string[] = [];
      const params: string[] = [];

      if (typeof req.query.origin_shop_id === 'string' && req.query.origin_shop_id) {
        const origin = await resolveShop(pool, req.query.origin_shop_id);
        params.push(origin.id);
        conditions.push(`m.origin_shop_id = $${params.length}`);
      }
      if (
        typeof req.query.destination_shop_id === 'string' &&
        req.query.destination_shop_id
      ) {
        const dest = await resolveShop(pool, req.query.destination_shop_id);
        params.push(dest.id);
        conditions.push(`m.destination_shop_id = $${params.length}`);
      }
      if (
        req.query.route_type === 'toll' ||
        req.query.route_type === 'nontoll'
      ) {
        params.push(req.query.route_type);
        conditions.push(`m.route_type = $${params.length}::route_type_enum`);
      }

      const whereSql =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const polylineSelect = includePolyline ? 'm.route_polyline,' : '';

      const { rows } = await pool.query(
        `
        SELECT m.id, m.origin_shop_id, o.code AS origin_code,
               m.destination_shop_id, d.code AS destination_code,
               m.route_type,
               m.distance_km::float AS distance_km,
               m.estimated_duration_min::float AS estimated_duration_min,
               ${polylineSelect}
               m.updated_at
        FROM od_distance_matrix m
        JOIN shops o ON o.id = m.origin_shop_id
        JOIN shops d ON d.id = m.destination_shop_id
        ${whereSql}
        ORDER BY o.code ASC, d.code ASC, m.route_type ASC
        `,
        params
      );

      res.json({ count: rows.length, entries: rows });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/routes/calculate', async (req, res, next) => {
    try {
      const payload = routeCalculateSchema.parse(req.body);
      const result = await calculateRoute(pool, payload, options?.routingOptions);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/rate-cards', async (req, res, next) => {
    try {
      const includeInactive = req.query.include_inactive === 'true';
      const rateCards = await listRateCards(pool, includeInactive);
      res.json({ rate_cards: rateCards });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/rate-cards', async (req, res, next) => {
    try {
      const payload = createRateCardSchema.parse(req.body);
      const rateCard = await createRateCard(pool, payload);
      res.status(201).json({ rate_card: rateCard });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/rate-cards/:id', async (req, res, next) => {
    try {
      const idParam = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;
      const payload = updateRateCardSchema.parse(req.body);
      const rateCard = await updateRateCard(pool, idParam, payload);
      res.json({ rate_card: rateCard });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/rate-cards/:id', async (req, res, next) => {
    try {
      const idParam = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;
      await deleteRateCard(pool, idParam);
      res.json({ deleted: true, id: idParam });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/deliveries', async (req, res, next) => {
    try {
      const statusQuery =
        req.query.status === 'pending' ||
        req.query.status === 'verified' ||
        req.query.status === 'voided'
          ? req.query.status
          : undefined;
      const deliveries = await listDeliveryLogs(pool, {
        start_date:
          typeof req.query.start_date === 'string'
            ? req.query.start_date
            : undefined,
        end_date:
          typeof req.query.end_date === 'string'
            ? req.query.end_date
            : undefined,
        driver_id:
          typeof req.query.driver_id === 'string'
            ? req.query.driver_id
            : undefined,
        shop_id:
          typeof req.query.shop_id === 'string' ? req.query.shop_id : undefined,
        status: statusQuery,
        search:
          typeof req.query.search === 'string' ? req.query.search : undefined,
      });
      res.json({ count: deliveries.length, deliveries });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/deliveries', async (req, res, next) => {
    try {
      const payload = createDeliverySchema.parse(req.body);
      const result = await createDeliveryLog(
        pool,
        payload,
        options?.routingOptions
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/deliveries/:id/void', async (req, res, next) => {
    try {
      const idParam = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;
      const payload = voidDeliverySchema.parse(req.body);
      const delivery = await voidDeliveryLog(
        pool,
        idParam,
        payload.void_reason
      );
      res.json({ delivery });
    } catch (error) {
      next(error);
    }
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: 'Validation error',
        details: err.issues,
      });
      return;
    }

    if (err instanceof HttpError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }

    const pgErr = err as { code?: string; message?: string };
    if (pgErr?.code === '23505') {
      res.status(409).json({ error: 'Duplicate resource already exists' });
      return;
    }
    if (pgErr?.code === '23503') {
      res.status(409).json({
        error: 'Resource cannot be deleted because it is referenced by audit records',
      });
      return;
    }

    res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  });

  return app;
}
