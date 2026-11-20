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

/** Opens a `seal` blob: 0x01 || nonce(12) || AES-256-GCM ciphertext+tag.
 * @param {Uint8Array<ArrayBuffer>} rawKey @param {Uint8Array<ArrayBuffer>} blob @param {string} aad */
export async function open(rawKey, blob, aad) {
  if (blob[0] !== VERSION) throw new Error("unknown ciphertext version");
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: blob.subarray(1, 13), additionalData: enc.encode(aad) },
    key,
    blob.subarray(13),
  );
  return new Uint8Array(plain);
}

/** Keyring from GET /api/v1/users/keyring/ -> { dataKey, salt }. Throws on a wrong passphrase. */
/** @param {Keyring} keyring @param {string} passphrase */
export async function unlock(keyring, passphrase) {
  const kek = await deriveKey(passphrase, keyring.kdf);
  const dataKey = await open(kek, fromB64(keyring.wrapped_key), "clioilc:v1:dek");
  const salt = await open(dataKey, fromB64(keyring.salt), "clioilc:v1:salt");
  return { dataKey, salt };
}

/** One `private` item from /activity/ -> its `data` object. */
/** @param {Uint8Array<ArrayBuffer>} dataKey @param {{ kind: string, id: string, ciphertext: string }} item */
export async function decryptRecord(dataKey, item) {
  const plain = await open(dataKey, fromB64(item.ciphertext), `clioilc:v1:${item.kind}:${item.id}`);
  return JSON.parse(new TextDecoder().decode(plain));
}
