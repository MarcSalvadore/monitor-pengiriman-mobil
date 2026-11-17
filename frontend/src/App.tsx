import {
  Building2,
  Calculator,
  ClipboardList,
  PlusCircle,
  Truck,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { BranchesAndRatesView } from './components/BranchesAndRatesView';
import { DailyDeliveryLedger } from './components/DailyDeliveryLedger';
import { Modal } from './components/Modal';
import { OfflineSyncBanner } from './components/OfflineSyncBanner';
import { PayrollPreviewView } from './components/PayrollPreviewView';
import { QuickDeliveryLogger } from './components/QuickDeliveryLogger';
import { useOfflineDeliveryQueue } from './hooks/useOfflineDeliveryQueue';
import { usePwaLifecycle } from './hooks/usePwaLifecycle';
import {
  fetchDeliveries,
  fetchDrivers,
  fetchOdMatrix,
  fetchRateCards,
  fetchShops,
  voidDeliveryApi,
} from './lib/api';
import { loadReferenceCache, saveReferenceCache } from './lib/db/offlineQueue';
import type {
  DeliveryLog,
  Driver,
  OdMatrixEntry,
  RateCard,
  Shop,
} from './types/domain';

type NavTab = 'log' | 'ledger' | 'payroll' | 'branches';

interface ToastState {
  id: number;
  message: string;
  variant: 'success' | 'info' | 'warning' | 'error';
}

const NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  shortLabel: string;
  icon: typeof PlusCircle;
}> = [
  { id: 'log', label: 'Log Delivery', shortLabel: 'Log Delivery', icon: PlusCircle },
  { id: 'ledger', label: 'Daily Logs', shortLabel: 'Daily Logs', icon: ClipboardList },
  { id: 'payroll', label: 'Payroll', shortLabel: 'Payroll', icon: Calculator },
  { id: 'branches', label: 'Branches & Rates', shortLabel: 'Branches', icon: Building2 },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('log');
  const [shops, setShops] = useState<Shop[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [rateCards, setRateCards] = useState<RateCard[]>([]);
  const [odMatrix, setOdMatrix] = useState<OdMatrixEntry[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [installModalOpen, setInstallModalOpen] = useState(false);

  const showToast = useCallback(
    (message: string, variant: ToastState['variant'] = 'info') => {
      const id = Date.now();
      setToast({ id, message, variant });
      setTimeout(() => {
        setToast((curr) => (curr?.id === id ? null : curr));
      }, 4500);
    },
    []
  );

  const loadDeliveries = useCallback(async () => {
    try {
      const rows = await fetchDeliveries();
      setDeliveries(rows);
      await saveReferenceCache('deliveries', rows);
    } catch {
      const cached = await loadReferenceCache<DeliveryLog[]>('deliveries');
      if (cached) setDeliveries(cached);
    }
  }, []);

  const loadAllReferenceData = useCallback(async () => {
    // Hydrate from IndexedDB first so UI renders instantly offline or on slow Wi-Fi
    const [cachedShops, cachedDrivers, cachedRates, cachedMatrix, cachedDeliveries] =
      await Promise.all([
        loadReferenceCache<Shop[]>('shops'),
        loadReferenceCache<Driver[]>('drivers'),
        loadReferenceCache<RateCard[]>('rate_cards'),
        loadReferenceCache<OdMatrixEntry[]>('od_matrix'),
        loadReferenceCache<DeliveryLog[]>('deliveries'),
      ]);

    if (cachedShops) setShops(cachedShops);
    if (cachedDrivers) setDrivers(cachedDrivers);
    if (cachedRates) setRateCards(cachedRates);
    if (cachedMatrix) setOdMatrix(cachedMatrix);
    if (cachedDeliveries) setDeliveries(cachedDeliveries);

    if (cachedShops && cachedDrivers && cachedRates && cachedMatrix) {
      setLoading(false);
    }

    try {
      const [liveShops, liveDrivers, liveRates, liveMatrix, liveDeliveries] =
        await Promise.all([
          fetchShops(),
          fetchDrivers(),
          fetchRateCards(),
          fetchOdMatrix(),
          fetchDeliveries(),
        ]);

      setShops(liveShops);
      setDrivers(liveDrivers);
      setRateCards(liveRates);
      setOdMatrix(liveMatrix);
      setDeliveries(liveDeliveries);

      await Promise.all([
        saveReferenceCache('shops', liveShops),
        saveReferenceCache('drivers', liveDrivers),
        saveReferenceCache('rate_cards', liveRates),
        saveReferenceCache('od_matrix', liveMatrix),
        saveReferenceCache('deliveries', liveDeliveries),
      ]);
    } catch {
      // Keep cached data silently when offline
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllReferenceData();
  }, [loadAllReferenceData]);

  const {
    isOnline,
    queue,
    pendingCount,
    isSyncing,
    enqueueOrSubmitDelivery,
    flushQueue,
    dismissFailedItem,
    retryFailedItem,
  } = useOfflineDeliveryQueue({
    onSynced: loadDeliveries,
    onNotify: showToast,
  });

  const pwa = usePwaLifecycle();

  const handleInstallClick = async () => {
    if (pwa.canPromptInstall) {
      const outcome = await pwa.triggerInstall();
      if (outcome === 'accepted') {
        showToast('FleetPay PWA installed to your device.', 'success');
      }
      return;
    }
    setInstallModalOpen(true);
  };

  const handleVoidDelivery = async (id: string, reason: string) => {
    await voidDeliveryApi(id, reason);
    await loadDeliveries();
    showToast('Delivery record marked as voided in audit ledger.', 'info');
  };

  return (
    <div className="flex min-h-dvh bg-slate-950 text-slate-100">
      {/* Desktop Persistent Sidebar (>= 1024px) */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-950 lg:flex">
        <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-slate-100">
              FleetPay
            </p>
            <p className="text-[11px] text-slate-400">Jabodetabek Ops</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1.5 p-3" aria-label="Primary Navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`nav-${item.id}`}
                onClick={() => setActiveTab(item.id)}
                className={`flex min-h-[48px] w-full items-center justify-between rounded-xl px-3.5 text-sm font-medium transition ${
                  active
                    ? 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30'
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </span>
                {item.id === 'ledger' && pendingCount > 0 && (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-300 tabular-nums">
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 p-4 text-[11px] text-slate-500 tabular-nums">
          <p>{shops.length} Branches &bull; {odMatrix.length} Cached Routes</p>
          <p className="mt-1">Zero-OpEx Self-Hosted OSRM</p>
        </div>
      </aside>

      {/* Main Content Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineSyncBanner
          isOnline={isOnline}
          pendingCount={pendingCount}
          isSyncing={isSyncing}
          onSyncNow={() => void flushQueue()}
          canPromptInstall={pwa.canPromptInstall}
          isStandalone={pwa.isStandalone}
          onInstallClick={() => void handleInstallClick()}
          needRefresh={pwa.needRefresh}
          onApplyUpdate={() => void pwa.applyUpdate()}
          onDismissUpdate={pwa.dismissNeedRefresh}
        />

        <main className="flex-1 px-4 pb-24 pt-5 lg:px-6 lg:pb-8">
          {loading ? (
            <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/50 text-sm text-slate-400">
              Loading Jabodetabek branch network &amp; OD matrix...
            </div>
          ) : activeTab === 'log' ? (
            <QuickDeliveryLogger
              shops={shops}
              drivers={drivers}
              rateCards={rateCards}
              odMatrix={odMatrix}
              isOnline={isOnline}
              onSubmitDelivery={enqueueOrSubmitDelivery}
            />
          ) : activeTab === 'ledger' ? (
            <DailyDeliveryLedger
              deliveries={deliveries}
              queuedDeliveries={queue}
              isOnline={isOnline}
              onVoidDelivery={handleVoidDelivery}
              onRetryQueued={retryFailedItem}
              onDismissQueued={dismissFailedItem}
            />
          ) : activeTab === 'payroll' ? (
            <PayrollPreviewView drivers={drivers} deliveries={deliveries} />
          ) : (
            <BranchesAndRatesView
              shops={shops}
              rateCards={rateCards}
              isOnline={isOnline}
              onRefreshReferenceData={loadAllReferenceData}
              onNotify={showToast}
            />
          )}
        </main>
      </div>

      {/* Tablet / Mobile Bottom Tab Navigation (< 1024px, >=48px touch targets) */}
      <nav
        aria-label="Mobile Navigation"
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-slate-800 bg-slate-950/95 backdrop-blur lg:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`relative flex min-h-[56px] min-w-[48px] flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium transition ${
                active ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{item.shortLabel}</span>
              {item.id === 'ledger' && pendingCount > 0 && (
                <span className="absolute right-3 top-1.5 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-slate-950 tabular-nums">
                  {pendingCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Non-blocking Toast Feedback */}
      {toast && (
        <div
          role="status"
          data-testid="toast-notification"
          className={`fixed right-4 top-20 z-50 max-w-sm rounded-xl border px-4 py-3 text-xs font-medium shadow-2xl ${
            toast.variant === 'success'
              ? 'border-emerald-500/40 bg-slate-900 text-emerald-200'
              : toast.variant === 'warning'
              ? 'border-amber-500/40 bg-slate-900 text-amber-200'
              : toast.variant === 'error'
              ? 'border-rose-500/40 bg-slate-900 text-rose-200'
              : 'border-sky-500/40 bg-slate-900 text-sky-200'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Install PWA Info Modal when native prompt isn't triggered yet */}
      <Modal
        isOpen={installModalOpen}
        title="Install FleetPay PWA"
        subtitle="Offline-capable Dealership Operations App"
        onClose={() => setInstallModalOpen(false)}
      >
        <div className="space-y-3 text-xs leading-relaxed text-slate-300">
          <p>
            FleetPay includes a precached Workbox Service Worker and local
            IndexedDB queue for basement dealership lots.
          </p>
          <ul className="list-disc space-y-1.5 pl-4 text-slate-400">
            <li>
              <strong className="text-slate-200">Microsoft Edge / Chrome Desktop:</strong>{' '}
              Click the install icon in the address bar or open browser menu &rarr;{' '}
              <em>Apps &rarr; Install FleetPay</em>.
            </li>
            <li>
              <strong className="text-slate-200">iOS / iPadOS Safari:</strong>{' '}
              Tap <em>Share &rarr; Add to Home Screen</em>.
            </li>
          </ul>
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => setInstallModalOpen(false)}
              className="min-h-[44px] rounded-xl bg-sky-500 px-4 text-xs font-semibold text-slate-950"
            >
              Got It
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
