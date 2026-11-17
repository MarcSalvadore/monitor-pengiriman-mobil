import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { QueuedDeliveryRecord } from '../../types/domain';

interface FleetPayDbSchema extends DBSchema {
  deliveryQueue: {
    key: string;
    value: QueuedDeliveryRecord;
    indexes: { by_queued_at: string };
  };
  referenceCache: {
    key: string;
    value: {
      key: string;
      updated_at: string;
      data: unknown;
    };
  };
}

const DB_NAME = 'dealership_pwa_db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<FleetPayDbSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<FleetPayDbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<FleetPayDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('deliveryQueue')) {
          const queueStore = db.createObjectStore('deliveryQueue', {
            keyPath: 'client_id',
          });
          queueStore.createIndex('by_queued_at', 'queued_at');
        }
        if (!db.objectStoreNames.contains('referenceCache')) {
          db.createObjectStore('referenceCache', {
            keyPath: 'key',
          });
        }
      },
    });
  }
  return dbPromise;
}

export async function getQueuedDeliveries(): Promise<QueuedDeliveryRecord[]> {
  const db = await getDb();
  const items = await db.getAllFromIndex('deliveryQueue', 'by_queued_at');
  return items.sort((a, b) => b.queued_at.localeCompare(a.queued_at));
}

export async function enqueueDelivery(record: QueuedDeliveryRecord): Promise<void> {
  const db = await getDb();
  await db.put('deliveryQueue', record);
}

export async function updateQueuedDelivery(
  record: QueuedDeliveryRecord
): Promise<void> {
  const db = await getDb();
  await db.put('deliveryQueue', record);
}

export async function removeQueuedDelivery(clientId: string): Promise<void> {
  const db = await getDb();
  await db.delete('deliveryQueue', clientId);
}

export async function saveReferenceCache<T>(key: string, data: T): Promise<void> {
  const db = await getDb();
  await db.put('referenceCache', {
    key,
    updated_at: new Date().toISOString(),
    data,
  });
}

export async function loadReferenceCache<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const entry = await db.get('referenceCache', key);
  return entry ? (entry.data as T) : null;
}
