"use client";

/**
 * Minimal IndexedDB-backed store for badge payloads.
 *
 * Why IndexedDB and not localStorage? Badges are keyed by `registrationId`
 * and we want per-record access, quotas that scale beyond 5 MB, and async
 * reads that don't block the main thread. Service workers can't read
 * localStorage either, so IndexedDB is the right layer.
 *
 * Why hand-rolled instead of `idb` (already in node_modules via Firebase)?
 * Keeping this standalone removes any implicit-dependency risk at build
 * time — the surface area is tiny (one store, one key) and this file owns
 * the whole contract.
 *
 * The store intentionally holds only the fields needed to render a QR
 * badge offline; nothing sensitive beyond what the participant already
 * has access to, and no HMAC secret (verification happens staff-side).
 */

const DB_NAME = "teranga";
const DB_VERSION = 1;
const STORE_NAME = "badges";

export interface CachedBadge {
  registrationId: string;
  qrCodeValue: string;
  eventId: string;
  eventTitle: string;
  holderName: string;
  ticketTypeName: string;
  cachedAt: string;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "registrationId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveBadge(badge: CachedBadge): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(badge);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // IndexedDB unavailable (private mode, quota, etc.) — caller treats as non-fatal.
  }
}

export async function loadBadge(registrationId: string): Promise<CachedBadge | null> {
  if (!isBrowser()) return null;
  try {
    const db = await openDb();
    const result = await new Promise<CachedBadge | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(registrationId);
      req.onsuccess = () => resolve((req.result as CachedBadge | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function hasCachedBadge(registrationId: string): Promise<boolean> {
  const badge = await loadBadge(registrationId);
  return badge !== null;
}
