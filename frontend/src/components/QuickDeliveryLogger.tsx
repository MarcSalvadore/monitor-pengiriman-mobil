import { ArrowRight, CheckCircle2, Clock, MapPin, Route as RouteIcon, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiHttpError, calculateRouteApi } from '../lib/api';
import {
  computeBenefitClient,
  formatIdr,
  getTodayWibDate,
  resolveOfflineRoutePreview,
} from '../lib/utils/offlineCalculator';
import type {
  Coordinates,
  CreateDeliveryPayload,
  Driver,
  OdMatrixEntry,
  QueuedDeliveryRecord,
  RateCard,
  RoutePreview,
  RouteType,
  Shop,
} from '../types/domain';
import { DeliveryMap } from './DeliveryMap';

interface QuickDeliveryLoggerProps {
  shops: Shop[];
  drivers: Driver[];
  rateCards: RateCard[];
  odMatrix: OdMatrixEntry[];
  isOnline: boolean;
  onSubmitDelivery: (
    payload: CreateDeliveryPayload,
    preview: QueuedDeliveryRecord['preview']
  ) => Promise<unknown>;
}

export function QuickDeliveryLogger({
  shops,
  drivers,
  rateCards,
  odMatrix,
  isOnline,
  onSubmitDelivery,
}: QuickDeliveryLoggerProps) {
  const [driverId, setDriverId] = useState('');
  const [originShopId, setOriginShopId] = useState('');
  const [destinationShopId, setDestinationShopId] = useState('');
  const [adHocMode, setAdHocMode] = useState(false);
  const [customCoords, setCustomCoords] = useState<Coordinates>({
    lat: -6.2297,
    lng: 106.8095,
  });
  const [routeType, setRouteType] = useState<RouteType>('toll');
  const [deliveryDate, setDeliveryDate] = useState(getTodayWibDate);
  const [vehicleVin, setVehicleVin] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [supervisorId, setSupervisorId] = useState('SUP-JKT-01');

  const [routePreview, setRoutePreview] = useState<RoutePreview | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!driverId && drivers.length > 0) {
      setDriverId(drivers[0].id);
    }
  }, [driverId, drivers]);

  useEffect(() => {
    if (shops.length > 0 && !originShopId) {
      const sunter = shops.find((s) => s.code === 'JKT-SUN') || shops[0];
      setOriginShopId(sunter.id);
      const bogor =
        shops.find((s) => s.code === 'BGR-PAJ') ||
        shops.find((s) => s.id !== sunter.id);
      if (bogor) setDestinationShopId(bogor.id);
    }
  }, [originShopId, shops]);

  const originShop = useMemo(
    () => shops.find((s) => s.id === originShopId) || null,
    [originShopId, shops]
  );
  const destShop = useMemo(
    () =>
      !adHocMode ? shops.find((s) => s.id === destinationShopId) || null : null,
    [adHocMode, destinationShopId, shops]
  );
  const selectedDriver = useMemo(
    () => drivers.find((d) => d.id === driverId) || null,
    [driverId, drivers]
  );

  const isSameShop = Boolean(
    !adHocMode && originShop && destShop && originShop.id === destShop.id
  );

  // Instant offline/cached route preview + online OSRM enrichment
  useEffect(() => {
    if (!originShop) {
      setRoutePreview(null);
      return;
    }
    if (!adHocMode && !destShop) {
      setRoutePreview(null);
      return;
    }

    const offlinePreview = resolveOfflineRoutePreview(
      originShop,
      destShop,
      adHocMode ? customCoords : null,
      routeType,
      odMatrix
    );
    setRoutePreview(offlinePreview);

    if (!isOnline || isSameShop) return;

    let cancelled = false;
    setRouteLoading(true);
    calculateRouteApi({
      origin_shop_id: originShop.id,
      destination_shop_id: !adHocMode && destShop ? destShop.id : undefined,
      custom_coords: adHocMode ? customCoords : undefined,
      route_type: routeType,
    })
      .then((res) => {
        if (!cancelled) setRoutePreview(res);
      })
      .catch(() => {
        // Retain deterministic offline OD matrix / Haversine preview when network fails
      })
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [originShop, destShop, adHocMode, customCoords, routeType, odMatrix, isOnline, isSameShop]);

  const benefitPreview = useMemo(() => {
    if (!routePreview || routePreview.distance_km <= 0) return null;
    return computeBenefitClient(
      routePreview.distance_km,
      routeType,
      deliveryDate,
      rateCards
    );
  }, [routePreview, routeType, deliveryDate, rateCards]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!selectedDriver || !originShop) {
      setFormError('Select a driver and origin dealership branch.');
      return;
    }
    if (isSameShop) {
      setFormError('Origin and destination branches cannot be identical (0 km).');
      return;
    }
    if (!adHocMode && !destShop) {
      setFormError('Select a destination dealership branch or switch to Ad-Hoc Pin.');
      return;
    }
    if (vehicleVin.trim().length < 4 || vehiclePlate.trim().length < 3) {
      setFormError('Enter a valid Vehicle VIN (min 4 chars) and License Plate.');
      return;
    }
    if (!routePreview || !benefitPreview) {
      setFormError('Unable to resolve distance or active IDR rate card.');
      return;
    }

    const payload: CreateDeliveryPayload = {
      delivery_date: deliveryDate,
      driver_id: selectedDriver.id,
      vehicle_vin: vehicleVin.trim().toUpperCase(),
      vehicle_plate: vehiclePlate.trim().toUpperCase(),
      origin_shop_id: originShop.id,
      destination_shop_id: !adHocMode && destShop ? destShop.id : undefined,
      custom_coords: adHocMode ? customCoords : undefined,
      route_type: routeType,
      supervisor_id: supervisorId.trim() || 'SUP-JKT-01',
    };

    const preview: QueuedDeliveryRecord['preview'] = {
      driver_code: selectedDriver.employee_code,
      driver_name: selectedDriver.full_name,
      origin_code: originShop.code,
      origin_name: originShop.name,
      destination_code: destShop ? destShop.code : null,
      destination_name: destShop
        ? destShop.name
        : `Pin (${customCoords.lat.toFixed(4)}, ${customCoords.lng.toFixed(4)})`,
      computed_distance_km: routePreview.distance_km,
      calculated_benefit_amount: benefitPreview.totalBenefit,
      applied_rate_card_name: benefitPreview.appliedRateCardName,
    };

    setSubmitting(true);
    try {
      await onSubmitDelivery(payload, preview);
      setVehicleVin('');
      setVehiclePlate('');
    } catch (err) {
      if (err instanceof ApiHttpError) {
        setFormError(err.message);
      } else {
        setFormError(
          err instanceof Error ? err.message : 'Failed to log delivery'
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      {/* Left Split Pane: 3-Click Supervisor Delivery Form */}
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/75 p-4 sm:p-5 lg:col-span-5"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Quick Delivery Logger
            </h2>
            <p className="text-xs text-slate-400">
              3-click branch transfer &bull; Works offline via cached OD matrix
            </p>
          </div>
          <span className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-medium text-sky-300 tabular-nums">
            {deliveryDate}
          </span>
        </div>

        {/* Step 1: Driver Selection */}
        <div>
          <label
            htmlFor="driver-select"
            className="mb-1.5 block text-xs font-medium text-slate-300"
          >
            1. Assigned Driver
          </label>
          <select
            id="driver-select"
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
            className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
          >
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.employee_code} — {d.full_name} ({d.base_shop_code || 'Fleet'})
              </option>
            ))}
          </select>
        </div>

        {/* Step 2: Origin & Destination Mode */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="origin-select"
              className="mb-1.5 block text-xs font-medium text-slate-300"
            >
              2. Origin Branch
            </label>
            <select
              id="origin-select"
              value={originShopId}
              onChange={(e) => setOriginShopId(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="dest-select"
                className="text-xs font-medium text-slate-300"
              >
                3. Destination
              </label>
              <button
                type="button"
                onClick={() => setAdHocMode((prev) => !prev)}
                className="text-xs font-medium text-sky-400 hover:text-sky-300"
              >
                {adHocMode ? 'Use Branch List' : 'Ad-Hoc Map Pin'}
              </button>
            </div>

            {!adHocMode ? (
              <select
                id="dest-select"
                value={destinationShopId}
                onChange={(e) => setDestinationShopId(e.target.value)}
                className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              >
                {shops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex min-h-[44px] items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 text-xs text-amber-200 tabular-nums">
                <MapPin className="h-4 w-4 shrink-0 text-amber-400" />
                <span>
                  {customCoords.lat.toFixed(4)}, {customCoords.lng.toFixed(4)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Route Type Toggle: Toll vs Non-Toll */}
        <div>
          <span className="mb-1.5 block text-xs font-medium text-slate-300">
            Route Corridor Profile
          </span>
          <div className="grid grid-cols-2 gap-2">
            {(['toll', 'nontoll'] as const).map((mode) => {
              const active = routeType === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  data-testid={`route-toggle-${mode}`}
                  onClick={() => setRouteType(mode)}
                  className={`flex min-h-[46px] items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition ${
                    active
                      ? mode === 'toll'
                        ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                        : 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                      : 'border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  <RouteIcon className="h-4 w-4" />
                  <span>{mode === 'toll' ? 'Toll Highway' : 'Non-Toll Arterial'}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Vehicle Identification & Date */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="vin-input"
              className="mb-1.5 block text-xs font-medium text-slate-300"
            >
              Vehicle VIN / Chassis No.
            </label>
            <input
              id="vin-input"
              type="text"
              required
              placeholder="e.g. MHFAB32026001234"
              value={vehicleVin}
              onChange={(e) => setVehicleVin(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3 font-mono text-sm uppercase text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="plate-input"
              className="mb-1.5 block text-xs font-medium text-slate-300"
            >
              License Plate
            </label>
            <input
              id="plate-input"
              type="text"
              required
              placeholder="e.g. B 1234 JKT"
              value={vehiclePlate}
              onChange={(e) => setVehiclePlate(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3 font-mono text-sm uppercase text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="delivery-date-input"
              className="mb-1.5 block text-xs font-medium text-slate-300"
            >
              Delivery Date
            </label>
            <input
              id="delivery-date-input"
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="supervisor-input"
              className="mb-1.5 block text-xs font-medium text-slate-300"
            >
              Supervisor ID
            </label>
            <input
              id="supervisor-input"
              type="text"
              value={supervisorId}
              onChange={(e) => setSupervisorId(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Deterministic Distance & IDR Benefit Preview Card */}
        <div
          data-testid="payout-preview-card"
          className="rounded-xl border border-slate-800 bg-slate-950/90 p-3.5"
        >
          <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1.5 font-medium text-slate-300">
              {originShop?.code || '---'}
              <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
              {adHocMode ? 'AD-HOC PIN' : destShop?.code || '---'}
            </span>
            <span>
              {routeLoading
                ? 'Refreshing OSRM...'
                : routePreview?.source === 'od_matrix'
                ? 'OD Matrix (<10ms)'
                : routePreview?.source === 'offline_cache'
                ? 'Cached OD Matrix'
                : routePreview?.source === 'osrm_live'
                ? 'Live Local OSRM'
                : 'Haversine Fallback'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 border-b border-slate-800 pb-3">
            <div>
              <p className="text-[11px] text-slate-400">Road Distance</p>
              <p
                data-testid="preview-distance-km"
                className="text-base font-bold text-slate-100 tabular-nums"
              >
                {routePreview ? `${routePreview.distance_km.toFixed(2)} km` : '—'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">Est. Duration</p>
              <p className="flex items-center gap-1 text-base font-semibold text-slate-200 tabular-nums">
                <Clock className="h-3.5 w-3.5 text-slate-400" />
                {routePreview
                  ? `${Math.round(routePreview.estimated_duration_min)} min`
                  : '—'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-slate-400">Driver Benefit</p>
              <p
                data-testid="preview-benefit-idr"
                className="text-base font-bold text-emerald-400 tabular-nums"
              >
                {benefitPreview ? formatIdr(benefitPreview.totalBenefit) : '—'}
              </p>
            </div>
          </div>

          {benefitPreview && (
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 tabular-nums">
              <span>
                Base+Km: {formatIdr(benefitPreview.variablePay)} &bull; Trip:{' '}
                {formatIdr(benefitPreview.flatTripAllowance)} &bull; Toll:{' '}
                {formatIdr(benefitPreview.tollReimbursement)}
              </span>
              <span className="text-slate-500">
                {benefitPreview.appliedRateCardName}
              </span>
            </div>
          )}
        </div>

        {formError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200"
          >
            {formError}
          </div>
        )}

        <button
          type="submit"
          data-testid="submit-delivery-btn"
          disabled={submitting || isSameShop}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isOnline ? (
            <ShieldCheck className="h-4 w-4" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          <span>
            {submitting
              ? 'Recording Delivery...'
              : isOnline
              ? 'Log & Verify Delivery'
              : 'Save to Offline Sync Queue'}
          </span>
        </button>
      </form>

      {/* Right Split Pane: Live Bundled Leaflet Route Map */}
      <div className="flex min-h-[380px] flex-col gap-3 lg:col-span-7 lg:min-h-[600px]">
        <DeliveryMap
          shops={shops}
          originShop={originShop}
          destShop={destShop}
          customCoords={adHocMode ? customCoords : null}
          adHocMode={adHocMode}
          routeType={routeType}
          polyline={routePreview?.polyline || null}
          onPickCustomCoords={(coords) => setCustomCoords(coords)}
        />
      </div>
    </div>
  );
}
