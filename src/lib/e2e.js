// clioilc E2E format v1 — browser (WebCrypto) + hash-wasm for Argon2id.
import { argon2id } from "hash-wasm";

const VERSION = 1;
const enc = new TextEncoder();
/** @param {string} s */
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * @typedef {{ algorithm: string, salt: string, memory_kib: number, iterations: number, parallelism: number }} Kdf
 * @typedef {{ kdf: Kdf, wrapped_key: string, salt: string }} Keyring
 */

/** Passphrase -> 32-byte key, with the account's `kdf` parameters.
 * @param {string} passphrase @param {Kdf} kdf @returns {Promise<Uint8Array<ArrayBuffer>>} */
export async function deriveKey(passphrase, kdf) {
  if (kdf.algorithm !== "argon2id") throw new Error(`unsupported KDF ${kdf.algorithm}`);
  const key = await argon2id({
    password: passphrase,
    salt: fromB64(kdf.salt),
    iterations: kdf.iterations,
    memorySize: kdf.memory_kib,
    parallelism: kdf.parallelism,
    hashLength: 32,
    outputType: "binary",
  });
  return new Uint8Array(key); // own ArrayBuffer, as WebCrypto expects
}

/**
 * A key for AES-GCM: an existing CryptoKey (the data key is kept as a
 * non-extractable one), or raw bytes imported for one operation.
 * @typedef {Uint8Array<ArrayBuffer> | CryptoKey} AnyKey
 * @param {AnyKey} k @param {KeyUsage} usage @returns {Promise<CryptoKey>}
 */
export const aesKey = (k, usage) =>
  k instanceof Uint8Array ? crypto.subtle.importKey("raw", k, "AES-GCM", false, [usage]) : Promise.resolve(k);

/** Raw data key -> non-extractable CryptoKey: script (even injected) can use it, never read it.
 * @param {Uint8Array<ArrayBuffer>} raw */
export const dataKeyFrom = (raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);

/** Opens a `seal` blob: 0x01 || nonce(12) || AES-256-GCM ciphertext+tag.
 * @param {AnyKey} rawKey @param {Uint8Array<ArrayBuffer>} blob @param {string} aad */
export async function open(rawKey, blob, aad) {
  if (blob[0] !== VERSION) throw new Error("unknown ciphertext version");
  const key = await aesKey(rawKey, "decrypt");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: blob.subarray(1, 13), additionalData: enc.encode(aad) },
    key,
    blob.subarray(13),
  );
  return new Uint8Array(plain);
}

/**
 * Keyring from GET /api/v1/users/keyring/ -> { dataKey, raw, salt }. `raw` is
 * the data key's bytes, for the caller to wrap (passkey, new CLI) and then
 * forget. Throws on a wrong passphrase.
 * @param {Keyring} keyring @param {string} passphrase
 */
export async function unlock(keyring, passphrase) {
  const kek = await deriveKey(passphrase, keyring.kdf);
  return unlockWith(keyring, await open(kek, fromB64(keyring.wrapped_key), "clioilc:v1:dek"));
}

/** Check a candidate data key against the keyring (it must open the salt). @param {Keyring} keyring @param {Uint8Array<ArrayBuffer>} raw */
export async function unlockWith(keyring, raw) {
  const salt = await open(raw, fromB64(keyring.salt), "clioilc:v1:salt");
  return { dataKey: await dataKeyFrom(raw), raw, salt };
}

/** One `private` item from /activity/ -> its `data` object. */
/** @param {AnyKey} dataKey @param {{ kind: string, id: string, ciphertext: string }} item */
export async function decryptRecord(dataKey, item) {
  const plain = await open(dataKey, fromB64(item.ciphertext), `clioilc:v1:${item.kind}:${item.id}`);
  return JSON.parse(new TextDecoder().decode(plain));
}
