import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiHttpError, submitDeliveryApi } from '../lib/api';
import {
  enqueueDelivery,
  getQueuedDeliveries,
  removeQueuedDelivery,
  updateQueuedDelivery,
} from '../lib/db/offlineQueue';
import type {
  CreateDeliveryPayload,
  DeliveryLog,
  QueuedDeliveryRecord,
} from '../types/domain';

interface UseOfflineDeliveryQueueOptions {
  onSynced?: () => Promise<void> | void;
  onNotify?: (message: string, variant: 'success' | 'info' | 'warning' | 'error') => void;
}

function isNetworkFailure(err: unknown): boolean {
  if (err instanceof ApiHttpError) return false;
  return err instanceof TypeError || !navigator.onLine;
}

export function useOfflineDeliveryQueue(options?: UseOfflineDeliveryQueueOptions) {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [queue, setQueue] = useState<QueuedDeliveryRecord[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncingRef = useRef(false);

  const onSyncedRef = useRef(options?.onSynced);
  const onNotifyRef = useRef(options?.onNotify);
  onSyncedRef.current = options?.onSynced;
  onNotifyRef.current = options?.onNotify;

  const refreshQueue = useCallback(async () => {
    const items = await getQueuedDeliveries();
    setQueue(items);
    return items;
  }, []);

  const flushQueue = useCallback(async (): Promise<number> => {
    if (syncingRef.current || !navigator.onLine) return 0;

    const currentItems = await getQueuedDeliveries();
    const pendingItems = currentItems.filter(
      (item) => item.sync_status !== 'failed'
    );
    if (pendingItems.length === 0) return 0;

    syncingRef.current = true;
    setIsSyncing(true);
    let syncedCount = 0;

    try {
      for (const item of [...pendingItems].reverse()) {
        await updateQueuedDelivery({ ...item, sync_status: 'syncing' });
        try {
          await submitDeliveryApi(item.payload);
          await removeQueuedDelivery(item.client_id);
          syncedCount += 1;
        } catch (err) {
          if (isNetworkFailure(err)) {
            await updateQueuedDelivery({
              ...item,
              sync_status: 'queued_offline',
            });
            setIsOnline(false);
            break;
          }

          await updateQueuedDelivery({
            ...item,
            sync_status: 'failed',
            error_message:
              err instanceof Error ? err.message : 'Server rejected queued entry',
          });
        }
      }

      await refreshQueue();
      if (syncedCount > 0) {
        onNotifyRef.current?.(
          `Synced ${syncedCount} offline ${syncedCount === 1 ? 'delivery' : 'deliveries'} to PostgreSQL.`,
          'success'
        );
        await onSyncedRef.current?.();
      }
      return syncedCount;
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, [refreshQueue]);

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void flushQueue();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [flushQueue]);

  const enqueueOrSubmitDelivery = useCallback(
    async (
      payload: CreateDeliveryPayload,
      preview: QueuedDeliveryRecord['preview']
    ): Promise<
      | { mode: 'online'; delivery: DeliveryLog }
      | { mode: 'queued_offline'; queuedRecord: QueuedDeliveryRecord }
    > => {
      const saveOffline = async () => {
        const queuedRecord: QueuedDeliveryRecord = {
          client_id:
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          payload,
          preview,
          queued_at: new Date().toISOString(),
          sync_status: 'queued_offline',
        };
        await enqueueDelivery(queuedRecord);
        await refreshQueue();
        onNotifyRef.current?.(
          `Saved offline to IndexedDB queue (${preview.origin_code} → ${preview.destination_code || 'Ad-Hoc Pin'}). Will auto-sync when online.`,
          'warning'
        );
        return { mode: 'queued_offline' as const, queuedRecord };
      };

      if (!navigator.onLine) {
        setIsOnline(false);
        return saveOffline();
      }

      try {
        const res = await submitDeliveryApi(payload);
        onNotifyRef.current?.(
          `Delivery logged & verified (${res.delivery.computed_distance_km.toFixed(2)} km).`,
          'success'
        );
        await onSyncedRef.current?.();
        return { mode: 'online', delivery: res.delivery };
      } catch (err) {
        if (isNetworkFailure(err)) {
          setIsOnline(false);
          return saveOffline();
        }
        throw err;
      }
    },
    [refreshQueue]
  );

  const dismissFailedItem = useCallback(
    async (clientId: string) => {
      await removeQueuedDelivery(clientId);
      await refreshQueue();
    },
    [refreshQueue]
  );

  const retryFailedItem = useCallback(
    async (clientId: string) => {
      const items = await getQueuedDeliveries();
      const target = items.find((i) => i.client_id === clientId);
      if (!target) return;
      await updateQueuedDelivery({
        ...target,
        sync_status: 'queued_offline',
        error_message: undefined,
      });
      await refreshQueue();
      await flushQueue();
    },
    [flushQueue, refreshQueue]
  );

  return {
    isOnline,
    queue,
    pendingCount: queue.length,
    isSyncing,
    enqueueOrSubmitDelivery,
    flushQueue,
    dismissFailedItem,
    retryFailedItem,
  };
}
