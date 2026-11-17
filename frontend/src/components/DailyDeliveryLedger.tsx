import { Ban, Clock3, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatIdr } from '../lib/utils/offlineCalculator';
import type { DeliveryLog, QueuedDeliveryRecord } from '../types/domain';
import { Modal } from './Modal';

interface DailyDeliveryLedgerProps {
  deliveries: DeliveryLog[];
  queuedDeliveries: QueuedDeliveryRecord[];
  isOnline: boolean;
  onVoidDelivery: (id: string, reason: string) => Promise<void>;
  onRetryQueued: (clientId: string) => Promise<void>;
  onDismissQueued: (clientId: string) => Promise<void>;
}

export function DailyDeliveryLedger({
  deliveries,
  queuedDeliveries,
  isOnline,
  onVoidDelivery,
  onRetryQueued,
  onDismissQueued,
}: DailyDeliveryLedgerProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'verified' | 'voided'>('all');
  const [voidTarget, setVoidTarget] = useState<DeliveryLog | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);

  const filteredDeliveries = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return deliveries.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (!q) return true;
      return (
        row.vehicle_vin.toLowerCase().includes(q) ||
        row.vehicle_plate.toLowerCase().includes(q) ||
        (row.driver_name || '').toLowerCase().includes(q) ||
        (row.origin_code || '').toLowerCase().includes(q) ||
        (row.destination_code || '').toLowerCase().includes(q)
      );
    });
  }, [deliveries, searchTerm, statusFilter]);

  const handleConfirmVoid = async () => {
    if (!voidTarget) return;
    if (voidReason.trim().length < 3) {
      setVoidError('Enter a descriptive void reason (minimum 3 characters).');
      return;
    }

    setVoiding(true);
    setVoidError(null);
    try {
      await onVoidDelivery(voidTarget.id, voidReason.trim());
      setVoidTarget(null);
      setVoidReason('');
    } catch (err) {
      setVoidError(
        err instanceof Error ? err.message : 'Failed to void delivery'
      );
    } finally {
      setVoiding(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search & Status Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/75 p-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            Daily Delivery Audit Ledger
          </h2>
          <p className="text-xs text-slate-400">
            Immutable PostgreSQL delivery log + IndexedDB offline sync queue
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              placeholder="Search VIN, plate, driver..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="min-h-[42px] w-56 rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <select
            aria-label="Filter delivery status"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as 'all' | 'verified' | 'voided')
            }
            className="min-h-[42px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="verified">Verified</option>
            <option value="voided">Voided</option>
          </select>
        </div>
      </div>

      {/* Pending Sync / IndexedDB Queued Rows */}
      {queuedDeliveries.length > 0 && (
        <section
          aria-label="Offline Sync Queue"
          className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4"
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-amber-200 tabular-nums">
                IndexedDB Offline Sync Queue ({queuedDeliveries.length})
              </h3>
            </div>
            <span className="text-xs text-amber-300/80">
              Auto-flushes to PostgreSQL when connectivity returns
            </span>
          </div>

          <div className="space-y-2">
            {queuedDeliveries.map((item) => (
              <div
                key={item.client_id}
                data-testid="queued-delivery-row"
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-slate-950/80 px-3.5 py-2.5 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-300">
                      {item.sync_status === 'failed'
                        ? 'Sync Error'
                        : item.sync_status === 'syncing'
                        ? 'Syncing...'
                        : 'Pending Sync'}
                    </span>
                    <span className="font-mono font-semibold text-slate-100">
                      {item.payload.vehicle_vin}
                    </span>
                    <span className="font-mono text-slate-400">
                      ({item.payload.vehicle_plate})
                    </span>
                  </div>
                  <p className="text-slate-300">
                    {item.preview.driver_code} {item.preview.driver_name} &bull;{' '}
                    {item.preview.origin_code} &rarr;{' '}
                    {item.preview.destination_code || item.preview.destination_name}{' '}
                    ({item.payload.route_type})
                  </p>
                  {item.error_message && (
                    <p className="text-rose-300">{item.error_message}</p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right tabular-nums">
                    <p className="font-semibold text-slate-100">
                      {item.preview.computed_distance_km.toFixed(2)} km
                    </p>
                    <p className="font-semibold text-emerald-400">
                      {formatIdr(item.preview.calculated_benefit_amount)}
                    </p>
                  </div>

                  {item.sync_status === 'failed' && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={!isOnline}
                        onClick={() => void onRetryQueued(item.client_id)}
                        className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-700 text-sky-300 hover:bg-slate-800"
                        title="Retry sync"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDismissQueued(item.client_id)}
                        className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-700 text-rose-300 hover:bg-slate-800"
                        title="Discard failed item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Server Delivery Logs Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/75">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800 text-left text-xs sm:text-sm">
            <thead className="bg-slate-950/70 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Vehicle VIN / Plate</th>
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3 text-right">Distance</th>
                <th className="px-4 py-3 text-right">Benefit (IDR)</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredDeliveries.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-sm text-slate-400"
                  >
                    No server delivery logs match the current filter.
                  </td>
                </tr>
              ) : (
                filteredDeliveries.map((row) => (
                  <tr
                    key={row.id}
                    className="transition hover:bg-slate-800/40"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-200 tabular-nums">
                      {row.delivery_date}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-100">
                        {row.driver_name || row.driver_code}
                      </p>
                      <p className="text-xs text-slate-400 tabular-nums">
                        {row.driver_code}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs font-semibold text-slate-100">
                        {row.vehicle_vin}
                      </p>
                      <p className="font-mono text-xs text-slate-400">
                        {row.vehicle_plate}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-100">
                        {row.origin_code} &rarr;{' '}
                        {row.destination_code || 'Ad-Hoc Pin'}
                      </p>
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          row.route_type === 'toll'
                            ? 'bg-sky-500/15 text-sky-300'
                            : 'bg-emerald-500/15 text-emerald-300'
                        }`}
                      >
                        {row.route_type}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-100 tabular-nums">
                      {row.computed_distance_km.toFixed(2)} km
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-emerald-400 tabular-nums">
                      {formatIdr(row.calculated_benefit_amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          row.status === 'verified'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : row.status === 'voided'
                            ? 'bg-rose-500/15 text-rose-300'
                            : 'bg-amber-500/15 text-amber-300'
                        }`}
                      >
                        {row.status}
                      </span>
                      {row.void_reason && (
                        <p className="mt-1 max-w-[180px] truncate text-[11px] text-rose-300/80">
                          {row.void_reason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.status !== 'voided' && (
                        <button
                          type="button"
                          disabled={!isOnline}
                          onClick={() => {
                            setVoidTarget(row);
                            setVoidReason('');
                            setVoidError(null);
                          }}
                          className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Ban className="h-3.5 w-3.5" />
                          <span>Void</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Accessible Void Confirmation Modal (zero window.confirm/prompt) */}
      <Modal
        isOpen={Boolean(voidTarget)}
        title="Void Delivery Audit Record"
        subtitle={
          voidTarget
            ? `${voidTarget.vehicle_vin} (${voidTarget.origin_code} → ${voidTarget.destination_code || 'Ad-Hoc'})`
            : undefined
        }
        onClose={() => setVoidTarget(null)}
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-slate-300">
            Financial delivery records are never hard-deleted. Voiding preserves the
            immutable audit trail and excludes this trip from driver payroll payouts.
          </p>

          <div>
            <label
              htmlFor="void-reason-input"
              className="mb-1.5 block text-xs font-medium text-slate-200"
            >
              Mandatory Void Reason
            </label>
            <textarea
              id="void-reason-input"
              rows={3}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Incorrect VIN or duplicate branch dispatch entry"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-rose-500 focus:outline-none"
            />
          </div>

          {voidError && (
            <p className="text-xs text-rose-300" role="alert">
              {voidError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setVoidTarget(null)}
              className="min-h-[44px] rounded-xl border border-slate-700 px-4 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={voiding}
              onClick={() => void handleConfirmVoid()}
              className="min-h-[44px] rounded-xl bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
            >
              {voiding ? 'Voiding...' : 'Confirm Void Record'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
