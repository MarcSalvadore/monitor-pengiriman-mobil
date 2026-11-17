import { CloudOff, Download, RefreshCw, Wifi } from 'lucide-react';

interface OfflineSyncBannerProps {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  onSyncNow: () => void;
  canPromptInstall: boolean;
  isStandalone: boolean;
  onInstallClick: () => void;
  needRefresh: boolean;
  onApplyUpdate: () => void;
  onDismissUpdate: () => void;
}

export function OfflineSyncBanner({
  isOnline,
  pendingCount,
  isSyncing,
  onSyncNow,
  canPromptInstall,
  isStandalone,
  onInstallClick,
  needRefresh,
  onApplyUpdate,
  onDismissUpdate,
}: OfflineSyncBannerProps) {
  return (
    <>
      <header className="safe-top sticky top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400 lg:hidden">
              <span className="text-sm font-bold">FP</span>
            </div>
            <div>
              <h1 className="text-sm font-semibold text-slate-100 sm:text-base">
                Jabodetabek Dealership Fleet &amp; Payroll
              </h1>
              <p className="text-xs text-slate-400">
                Zero-OpEx Self-Hosted OSRM Routing &bull; IDR Compensation Ledger
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Network Status Indicator */}
            <div
              data-testid="network-status-pill"
              className={`inline-flex min-h-[38px] items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
                isOnline
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/40 bg-amber-500/15 text-amber-200'
              }`}
            >
              {isOnline ? (
                <>
                  <Wifi className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Online &bull; OSRM Active</span>
                </>
              ) : (
                <>
                  <CloudOff className="h-3.5 w-3.5 text-amber-400" />
                  <span>Offline Mode &bull; Cached OD Matrix</span>
                </>
              )}
            </div>

            {/* Queued Offline Count Pill */}
            {pendingCount > 0 && (
              <button
                type="button"
                data-testid="queued-offline-pill"
                onClick={onSyncNow}
                disabled={!isOnline || isSyncing}
                className="inline-flex min-h-[38px] items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-75 tabular-nums"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`}
                />
                <span>
                  {isSyncing
                    ? 'Syncing Queue...'
                    : `Queued Offline (${pendingCount} pending)`}
                </span>
              </button>
            )}

            {/* Install App Button (non-intrusive header trigger) */}
            {!isStandalone && (
              <button
                type="button"
                data-testid="install-app-btn"
                onClick={onInstallClick}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-sky-500/50 hover:bg-slate-800 hover:text-sky-200"
              >
                <Download className="h-3.5 w-3.5 text-sky-400" />
                <span>{canPromptInstall ? 'Install App' : 'Install PWA'}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Service Worker Explicit Update Banner */}
      {needRefresh && (
        <div
          role="status"
          className="fixed bottom-20 right-4 z-50 flex items-center gap-3 rounded-xl border border-sky-500/40 bg-slate-900 px-4 py-3 shadow-2xl lg:bottom-5"
        >
          <span className="text-xs font-medium text-slate-100">
            New app update available — Refresh to load latest build
          </span>
          <button
            type="button"
            onClick={onApplyUpdate}
            className="min-h-[36px] rounded-lg bg-sky-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-sky-400"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={onDismissUpdate}
            className="min-h-[36px] rounded-lg px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
          >
            Later
          </button>
        </div>
      )}
    </>
  );
}
