// Unlock the E2E data key with a passkey (Touch ID, Face ID, Windows Hello)
// instead of the passphrase (backend docs/encryption.md, "Passkeys").
//
// WebAuthn's PRF extension gives a secret that only the passkey can
// produce, on the device, after the user is verified. HKDF turns it into a
// key that wraps the data key; the server stores only that wrapped copy.
// A passkey synced between devices (e.g. iCloud Keychain) unlocks new
// devices too, so the passphrase is needed only at setup and for recovery.
import { api } from "./api.js";
import { open, seal } from "./e2e-v2.js";

/** @typedef {{ id: number, credential_id: string, prf_salt: string, wrapped_key: string, label: string, created_at: string }} Passkey */

const b64 = (/** @type {Uint8Array} */ b) => btoa(String.fromCharCode(...b));
const fromB64 = (/** @type {string} */ s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
/** @param {string} s */
const fromB64url = (s) => fromB64(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
const ctxPasskey = (/** @type {string} */ credentialId) => `clioilc:v1:dek-passkey:${credentialId}`;

/** WebAuthn is there at all (PRF support is only known when a passkey answers). */
export const passkeysAvailable = () => typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;

/** PRF output -> the 32-byte key that wraps the data key. @param {ArrayBuffer | Uint8Array} prf */
async function kekFrom(prf) {
  const bytes = new Uint8Array(prf instanceof Uint8Array ? prf : new Uint8Array(prf)); // own ArrayBuffer
  const ikm = await crypto.subtle.importKey("raw", bytes, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("clioilc:v1:passkey-kek") },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

/** @returns {Promise<Passkey[]>} */
export async function listPasskeys() {
  try {
    return (await api("/api/v1/users/keyring/passkeys/")).passkeys;
  } catch {
    return [];
  }
}

/** @param {any} cred */
const prfOf = (cred) => cred?.getClientExtensionResults?.().prf;

/**
 * Create a passkey on this device and store the data key wrapped for it.
 * `raw`: the data key bytes (from a passphrase unlock just now).
 * @param {Uint8Array<ArrayBuffer>} raw @param {{ username: string }} user @param {string} label
 */
export async function addPasskey(raw, user, label) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const cred = /** @type {PublicKeyCredential | null} */ (
    await navigator.credentials.create({
      publicKey: {
        rp: { id: location.hostname, name: "clioilc" },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: user.username, displayName: user.username },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        extensions: /** @type {any} */ ({ prf: { eval: { first: salt } } }),
      },
    })
  );
  if (!cred) throw new Error("No passkey was created.");
  let out = prfOf(cred)?.results?.first;
  if (!out) {
    if (prfOf(cred)?.enabled === false) throw new Error("This passkey cannot derive keys (no PRF support). Try the device's built-in passkeys.");
    // Some authenticators only evaluate PRF when the passkey is used.
    out = await evaluate([{ credential_id: cred.id, prf_salt: b64(salt) }]).then((r) => r.prf);
  }
  const kek = await kekFrom(out);
  const wrapped = await seal(kek, raw, ctxPasskey(cred.id));
  kek.fill(0);
  return /** @type {Passkey} */ (
    await api("/api/v1/users/keyring/passkeys/", {
      method: "POST",
      body: { credential_id: cred.id, prf_salt: b64(salt), wrapped_key: b64(wrapped), label },
    })
  );
}

/**
 * Ask one of the listed passkeys for its PRF output.
 * @param {{ credential_id: string, prf_salt: string }[]} list
 * @returns {Promise<{ id: string, prf: ArrayBuffer }>}
 */
async function evaluate(list) {
  const assertion = /** @type {PublicKeyCredential | null} */ (
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname,
        allowCredentials: list.map((p) => ({ type: "public-key", id: fromB64url(p.credential_id) })),
        userVerification: "required",
        extensions: /** @type {any} */ ({
          prf: { evalByCredential: Object.fromEntries(list.map((p) => [p.credential_id, { first: fromB64(p.prf_salt) }])) },
        }),
      },
    })
  );
  const prf = prfOf(assertion)?.results?.first;
  if (!assertion || !prf) throw new Error("The passkey did not give a key (no PRF support).");
  return { id: assertion.id, prf };
}

/**
 * Unlock with a passkey: returns the data key bytes, for the caller to turn
 * into the session key and forget.
 * @param {Passkey[]} list
 */
export async function unlockWithPasskey(list) {
  const { id, prf } = await evaluate(list);
  const p = list.find((x) => x.credential_id === id);
  if (!p) throw new Error("Unknown passkey.");
  const kek = await kekFrom(prf);
  try {
    return await open(kek, fromB64(p.wrapped_key), ctxPasskey(p.credential_id));
  } finally {
    kek.fill(0);
  }
}

/** @param {number} id */
export const deletePasskey = (id) => api(`/api/v1/users/keyring/passkeys/${id}/`, { method: "DELETE" });
