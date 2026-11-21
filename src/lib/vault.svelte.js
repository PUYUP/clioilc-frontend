// E2E data key for this browser (backend docs/encryption.md, "Browser").
//
// The key is a non-extractable CryptoKey: script can decrypt with it, never
// read its bytes. By default it lives in this tab's memory only. "Remember
// on this device" also keeps it in IndexedDB (a CryptoKey can be stored
// there without becoming readable) for 30 days, for the signed-in user only;
// Lock and Sign out forget it. Anyone using this browser profile meanwhile
// can open the data, like `auth.json` on a laptop with the CLI.
import { api } from "./api.js";
import { unlock, unlockWith } from "./e2e.js";

export const REMEMBER_DAYS = 30;
const DB = "clioilc-vault";
const STORE = "keys";

export const vault = $state({
  /** @type {CryptoKey | null} */
  dataKey: null,
  /** When this device stops remembering the key, if it does. @type {Date | null} */
  rememberedUntil: null,
  busy: false,
  /** @type {string | null} */
  error: null,
});

/**
 * Unlock with the passphrase. Returns the raw key bytes for one follow-up
 * (passkey enrolment, approving a CLI); callers must not keep them.
 * @param {string} passphrase @param {{ remember?: boolean, userId?: number }} [o]
 */
export async function unlockVault(passphrase, o = {}) {
  vault.busy = true;
  vault.error = null;
  try {
    const keyring = await api("/api/v1/users/keyring/");
    const { dataKey, raw } = await unlock(keyring, passphrase);
    await setKey(dataKey, o);
    return raw;
  } catch {
    // A wrong passphrase fails the GCM tag check; don't tell it apart.
    vault.error = "Wrong passphrase.";
    return null;
  } finally {
    vault.busy = false;
  }
}

/** Unlock with key bytes obtained another way (a passkey). @param {Uint8Array<ArrayBuffer>} raw @param {{ remember?: boolean, userId?: number }} [o] */
export async function unlockVaultWith(raw, o = {}) {
  const keyring = await api("/api/v1/users/keyring/");
  const { dataKey } = await unlockWith(keyring, raw);
  await setKey(dataKey, o);
}

/** @param {CryptoKey} dataKey @param {{ remember?: boolean, userId?: number }} o */
async function setKey(dataKey, o) {
  vault.dataKey = dataKey;
  if (o.remember && o.userId != null) {
    const until = new Date(Date.now() + REMEMBER_DAYS * 86400e3);
    try {
      await put({ userId: o.userId, key: dataKey, until: until.getTime() });
      vault.rememberedUntil = until;
    } catch {
      vault.rememberedUntil = null; // private mode: memory only
    }
  }
}

/** On page load: the remembered key of this user, unless expired. @param {number} userId */
export async function restoreVault(userId) {
  if (vault.dataKey) return;
  try {
    const row = await get();
    if (!row) return;
    if (row.userId !== userId || row.until < Date.now() || !(row.key instanceof CryptoKey)) {
      await forget();
      return;
    }
    vault.dataKey = row.key;
    vault.rememberedUntil = new Date(row.until);
  } catch {
    /* no IndexedDB: unlock per tab */
  }
}

/** Lock: forget the key here and on this device. */
export async function lockVault() {
  vault.dataKey = null;
  vault.rememberedUntil = null;
  await forget().catch(() => {});
}

// --- IndexedDB: one row, the remembered key -------------------------------------------

/** @returns {Promise<IDBDatabase>} */
function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
/** @param {"readonly" | "readwrite"} mode @param {(s: IDBObjectStore) => IDBRequest} f */
async function tx(mode, f) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = f(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).finally(() => d.close());
}
/** @param {{ userId: number, key: CryptoKey, until: number }} row */
const put = (row) => tx("readwrite", (s) => s.put(row, "dek"));
/** @returns {Promise<{ userId: number, key: CryptoKey, until: number } | undefined>} */
const get = () => /** @type {any} */ (tx("readonly", (s) => s.get("dek")));
const forget = () => tx("readwrite", (s) => s.delete("dek"));

/** Thrown when end-to-end data needs the passphrase and no key is unlocked. */
export class LockedError extends Error {}
