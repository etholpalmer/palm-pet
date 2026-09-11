// IndexedDB adapter. Shell, not a unit: this is the only file that touches storage.
//
// A6: append-only is enforced by `add()`, never `put()`. `event_id` is the key path, so a
// duplicate id throws a ConstraintError instead of silently overwriting history. D6 asks
// for triggers; IndexedDB has none, and this is the closest the platform allows.

const DB_NAME = 'palmpet';
const DB_VERSION = 1;
const STORE = 'events';

let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // event_id as keyPath is what makes add() a duplicate guard rather than a
        // convention (A6). No autoIncrement: ids are UUIDv4, minted in the shell (B18).
        db.createObjectStore(STORE, { keyPath: 'event_id' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

/** Append one event. Throws if its event_id already exists — history is never rewritten. */
export async function append(event) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(event);
    tx.oncomplete = () => resolve(event);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Every event, in storage order. The fold imposes its own order (B51); this does not. */
export async function allEvents() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** navigator.storage.persist() — checklist item 12. Best-effort; never blocks anything. */
export async function requestPersistence() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; }
  catch { return false; }
}
