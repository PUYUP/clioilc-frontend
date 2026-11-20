// E2E data key for this browser tab. Kept in memory only: a reload asks for
// the passphrase again. See backend docs/encryption.md.
import { api } from "./api.js";
import { unlock } from "./e2e.js";

export const vault = $state({
  /** @type {Uint8Array<ArrayBuffer> | null} */
  dataKey: null,
  busy: false,
  /** @type {string | null} */
  error: null,
});

/** @param {string} passphrase */
export async function unlockVault(passphrase) {
  vault.busy = true;
  vault.error = null;
  try {
    const keyring = await api("/api/v1/users/keyring/");
    vault.dataKey = (await unlock(keyring, passphrase)).dataKey;
  } catch {
    // A wrong passphrase fails the GCM tag check; don't tell it apart.
    vault.error = "Wrong passphrase.";
  } finally {
    vault.busy = false;
  }
}

export function lockVault() {
  vault.dataKey = null;
}

/** Thrown when end-to-end data needs the passphrase and no key is unlocked. */
export class LockedError extends Error {}
