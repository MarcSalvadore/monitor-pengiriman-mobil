import { Building2, Plus, RefreshCw } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { createRateCard, createShop, recomputeOdMatrix } from '../lib/api';
import { formatIdr, getTodayWibDate } from '../lib/utils/offlineCalculator';
import type { RateCard, Shop } from '../types/domain';
import { Modal } from './Modal';

interface BranchesAndRatesViewProps {
  shops: Shop[];
  rateCards: RateCard[];
  isOnline: boolean;
  onRefreshReferenceData: () => Promise<void>;
  onNotify: (message: string, variant: 'success' | 'info' | 'warning' | 'error') => void;
}

export function BranchesAndRatesView({
  shops,
  rateCards,
  isOnline,
  onRefreshReferenceData,
  onNotify,
}: BranchesAndRatesViewProps) {
  const [recomputing, setRecomputing] = useState(false);
  const [shopModalOpen, setShopModalOpen] = useState(false);
  const [rateModalOpen, setRateModalOpen] = useState(false);

  const [shopForm, setShopForm] = useState({
    code: '',
    name: '',
    city: '',
    address: '',
    latitude: '-6.2088',
    longitude: '106.8456',
  });

  const [rateForm, setRateForm] = useState({
    name: '',
    effective_from: getTodayWibDate(),
    min_km: '5',
    max_km: '999.99',
    base_fare: '35000',
    rate_per_km: '6000',
    flat_trip_allowance: '25000',
    toll_allowance: '45000',
  });

  const handleRecompute = async () => {
    setRecomputing(true);
    try {
      const res = await recomputeOdMatrix();
      await onRefreshReferenceData();
      onNotify(
        `Recomputed ${res.recomputed_rows} OD matrix routes in ${res.duration_ms} ms.`,
        'success'
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Matrix recomputation failed',
        'error'
      );
    } finally {
      setRecomputing(false);
    }
  };

  const handleAddShop = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await createShop({
        code: shopForm.code.trim().toUpperCase(),
        name: shopForm.name.trim(),
        city: shopForm.city.trim(),
        address: shopForm.address.trim(),
        latitude: Number(shopForm.latitude),
        longitude: Number(shopForm.longitude),
      });
      await onRefreshReferenceData();
      setShopModalOpen(false);
      setShopForm({
        code: '',
        name: '',
        city: '',
        address: '',
        latitude: '-6.2088',
        longitude: '106.8456',
      });
      onNotify('Added dealership branch & updated OD distance matrix.', 'success');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to create branch',
        'error'
      );
    }
  };

  const handleAddRateCard = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await createRateCard({
        name: rateForm.name.trim(),
        effective_from: rateForm.effective_from,
        effective_to: null,
        min_km: Number(rateForm.min_km),
        max_km: Number(rateForm.max_km),
        base_fare: Number(rateForm.base_fare),
        rate_per_km: Number(rateForm.rate_per_km),
        flat_trip_allowance: Number(rateForm.flat_trip_allowance),
        toll_allowance: Number(rateForm.toll_allowance),
      });
      await onRefreshReferenceData();
      setRateModalOpen(false);
      onNotify('Created versioned IDR rate card.', 'success');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to create rate card',
        'error'
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Dealership Branches Section */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/75 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Jabodetabek Dealership Registry ({shops.length})
              </h2>
              <p className="text-xs text-slate-400">
                PostGIS WGS84 coordinates &bull; Auto-syncs with local OSRM matrix
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!isOnline || recomputing}
              onClick={() => void handleRecompute()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${recomputing ? 'animate-spin' : ''}`} />
              <span>{recomputing ? 'Recomputing...' : 'Recompute OD Matrix'}</span>
            </button>
            <button
              type="button"
              disabled={!isOnline}
              onClick={() => setShopModalOpen(true)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-sky-500 px-3.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              <span>Add Branch</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shops.map((shop) => (
            <div
              key={shop.id}
              className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="inline-block rounded-md bg-sky-500/15 px-2 py-0.5 font-mono text-xs font-bold text-sky-300">
                    {shop.code}
                  </span>
                  <h3 className="mt-1.5 text-sm font-semibold text-slate-100">
                    {shop.name}
                  </h3>
                  <p className="text-xs text-slate-400">{shop.city}</p>
                </div>
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                  {shop.latitude.toFixed(4)}, {shop.longitude.toFixed(4)}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                {shop.address}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Versioned IDR Rate Cards Section */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/75 p-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Versioned IDR Rate Cards
            </h2>
            <p className="text-xs text-slate-400">
              Tiered distance thresholds &bull; Snapshotted immutably onto delivery logs
            </p>
          </div>
          <button
            type="button"
            disabled={!isOnline}
            onClick={() => setRateModalOpen(true)}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            <span>Add Rate Card</span>
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/75">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-left text-xs sm:text-sm">
              <thead className="bg-slate-950/70 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3">Rate Card Name</th>
                  <th className="px-4 py-3">Effective Window</th>
                  <th className="px-4 py-3 text-right">Tier (km)</th>
                  <th className="px-4 py-3 text-right">Base Fare</th>
                  <th className="px-4 py-3 text-right">Per Km</th>
                  <th className="px-4 py-3 text-right">Trip Allowance</th>
                  <th className="px-4 py-3 text-right">Toll Allowance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 tabular-nums">
                {rateCards.map((card) => (
                  <tr key={card.id} className="hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-medium text-slate-100">
                      {card.name}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {card.effective_from} &rarr; {card.effective_to || 'Active'}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {card.min_km.toFixed(2)} – {card.max_km.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-100">
                      {formatIdr(card.base_fare)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-100">
                      {formatIdr(card.rate_per_km)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-200">
                      {formatIdr(card.flat_trip_allowance)}
                    </td>
                    <td className="px-4 py-3 text-right text-sky-300">
                      {formatIdr(card.toll_allowance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Add Branch Modal */}
      <Modal
        isOpen={shopModalOpen}
        title="Register Dealership Branch"
        onClose={() => setShopModalOpen(false)}
      >
        <form onSubmit={handleAddShop} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              required
              placeholder="Code (e.g. JKT-KMG)"
              value={shopForm.code}
              onChange={(e) => setShopForm({ ...shopForm, code: e.target.value })}
              className="min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100"
            />
            <input
              required
              placeholder="City"
              value={shopForm.city}
              onChange={(e) => setShopForm({ ...shopForm, city: e.target.value })}
              className="min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100"
            />
          </div>
          <input
            required
            placeholder="Branch Name"
            value={shopForm.name}
            onChange={(e) => setShopForm({ ...shopForm, name: e.target.value })}
            className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100"
          />
          <input
            required
            placeholder="Street Address"
            value={shopForm.address}
            onChange={(e) => setShopForm({ ...shopForm, address: e.target.value })}
            className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100"
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              required
              type="number"
              step="any"
              placeholder="Latitude"
              value={shopForm.latitude}
              onChange={(e) => setShopForm({ ...shopForm, latitude: e.target.value })}
              className="min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 tabular-nums"
            />
            <input
              required
              type="number"
              step="any"
              placeholder="Longitude"
              value={shopForm.longitude}
              onChange={(e) => setShopForm({ ...shopForm, longitude: e.target.value })}
              className="min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 tabular-nums"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShopModalOpen(false)}
              className="min-h-[44px] rounded-xl border border-slate-700 px-4 text-xs text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="min-h-[44px] rounded-xl bg-sky-500 px-4 text-xs font-semibold text-slate-950"
            >
              Save Branch
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Rate Card Modal */}
      <Modal
        isOpen={rateModalOpen}
        title="Add Versioned IDR Rate Card"
        onClose={() => setRateModalOpen(false)}
      >
        <form onSubmit={handleAddRateCard} className="space-y-3">
          <input
            required
            placeholder="Rate Card Name"
            value={rateForm.name}
            onChange={(e) => setRateForm({ ...rateForm, name: e.target.value })}
            className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100"
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              required
              type="date"
              value={rateForm.effective_from}
              onChange={(e) =>
                setRateForm({ ...rateForm, effective_from: e.target.value })
              }
              className="min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 tabular-nums"
            />
            <input
              required
              type="number"
              step="0.01"
              placeholder="Min km"
              value={rateForm.min_km}
              onChange={(e) => setRateForm({ ...rateForm, min_km: e.target.value })}
              className="min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 tabular-nums"
            />
            <input
              required
              type="number"
              step="0.01"
              placeholder="Max km"
              value={rateForm.max_km}
              onChange={(e) => setRateForm({ ...rateForm, max_km: e.target.value })}
              className="min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 tabular-nums"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              required
              type="number"
              placeholder="Base Fare (IDR)"
              value={rateForm.base_fare}
              onChange={(e) => setRateForm({ ...rateForm, base_fare: e.target.value })}
              className="min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 tabular-nums"
            />
            <input
              required
              type="number"
              placeholder="Rate per Km (IDR)"
              value={rateForm.rate_per_km}
              onChange={(e) =>
                setRateForm({ ...rateForm, rate_per_km: e.target.value })
              }
              className="min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 tabular-nums"
            />
            <input
              required
              type="number"
              placeholder="Trip Allowance (IDR)"
              value={rateForm.flat_trip_allowance}
              onChange={(e) =>
                setRateForm({ ...rateForm, flat_trip_allowance: e.target.value })
              }
              className="min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 tabular-nums"
            />
            <input
              required
              type="number"
              placeholder="Toll Allowance (IDR)"
              value={rateForm.toll_allowance}
              onChange={(e) =>
                setRateForm({ ...rateForm, toll_allowance: e.target.value })
              }
              className="min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 tabular-nums"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setRateModalOpen(false)}
              className="min-h-[44px] rounded-xl border border-slate-700 px-4 text-xs text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="min-h-[44px] rounded-xl bg-emerald-500 px-4 text-xs font-semibold text-slate-950"
            >
              Save Rate Card
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
