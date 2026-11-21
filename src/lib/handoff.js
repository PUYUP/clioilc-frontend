// Unlock a new `clioilc login` from this browser (backend docs/encryption.md,
// "Login without the passphrase"): seal the data key to the CLI's one-time
// X25519 key with HPKE (DHKEM(X25519, HKDF-SHA256) / HKDF-SHA256 /
// AES-256-GCM, base mode, the user code in `info`). The server only relays
// it. The key check must match what the terminal shows, or the server could
// have swapped in its own key.
import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";

const suite = new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
const fromB64 = (/** @type {string} */ s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64 = (/** @type {Uint8Array} */ b) => btoa(String.fromCharCode(...b));

/** `XXXX-XXXX-XXXX-XXXX`: 64 bits of SHA-256("clioilc:v1:device-key" || public key). @param {string} pubB64 */
export async function keyCheck(pubB64) {
  const pub = fromB64(pubB64);
  const label = new TextEncoder().encode("clioilc:v1:device-key");
  const data = new Uint8Array(label.length + pub.length);
  data.set(label);
  data.set(pub, label.length);
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const hex = Array.from(d.subarray(0, 8), (x) => x.toString(16).padStart(2, "0").toUpperCase()).join("");
  return hex.match(/.{4}/g)?.join("-") ?? hex;
}

/**
 * The data key sealed for the CLI: { e2e_enc, e2e_ct } (base64) for the approve call.
 * @param {string} pubB64 @param {Uint8Array} dek @param {string} userCode
 */
export async function sealForDevice(pubB64, dek, userCode) {
  const recipientPublicKey = await suite.kem.deserializePublicKey(fromB64(pubB64).buffer);
  const sender = await suite.createSenderContext({
    recipientPublicKey,
    info: new TextEncoder().encode(`clioilc:v1:device-dek:${userCode}`).buffer,
  });
  const ct = new Uint8Array(await sender.seal(new Uint8Array(dek).buffer));
  return { e2e_enc: b64(new Uint8Array(sender.enc)), e2e_ct: b64(ct) };
}
