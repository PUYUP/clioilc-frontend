// clioilc E2E format v2: team keys (backend docs/e2e-teams.md, "Format v2").
// Must match the reference implementation (backend apps/core/e2e_v2.py) on
// src/lib/__fixtures__/e2e-v2.json.
//
// - Wrapping a key to a person: HPKE base mode, X-Wing (ML-KEM-768 + X25519)
//   / HKDF-SHA256 / AES-256-GCM; blob 0x02 || enc(1120) || ct; context in `info`.
// - Grant signatures: Ed25519 over a length-prefixed message.
// - Content (names, team records, the identity secret): v1 `seal`.
import { Aes256Gcm, CipherSuite, HkdfSha256 } from "@hpke/core";
import { XWing } from "@hpke/hybridkem-x-wing";
import { ed25519 } from "@noble/curves/ed25519.js";
import { ml_kem768_x25519 } from "@noble/post-quantum/hybrid.js";
import { open } from "./e2e.js";

export { open };

export const SUITE_XWING = 0x02;
export const ENC_LEN = 1120;
export const XWING_PK_LEN = 1216;
const SEED_LEN = 32;
const SEAL_VERSION = 0x01;
const enc = new TextEncoder();

/** @typedef {Uint8Array<ArrayBuffer>} Bytes */

const suite = new CipherSuite({ kem: new XWing(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });

/** @param {Uint8Array} b @returns {Bytes} a copy with its own ArrayBuffer */
const own = (b) => new Uint8Array(b);
/** @param {Uint8Array} b */
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

// --- contexts ------------------------------------------------------------------------

/** @param {number} userId */
export const ctxIdentity = (userId) => `clioilc:v2:identity:${userId}`;

/** @param {"ws" | "project"} target @param {number} targetId @param {number} version @param {number} recipientId */
export function ctxGrant(target, targetId, version, recipientId) {
  if (target !== "ws" && target !== "project") throw new Error("target must be ws or project");
  return `clioilc:v2:grant:${target}:${targetId}:${version}:${recipientId}`;
}
/** @param {number} wsId @param {number} version */
export const ctxWsName = (wsId, version) => `clioilc:v2:ws-name:${wsId}:${version}`;
/** @param {number} projectId @param {number} version */
export const ctxProjectName = (projectId, version) => `clioilc:v2:project-name:${projectId}:${version}`;
/** @param {number} projectId @param {number} version */
export const ctxProjectRemote = (projectId, version) => `clioilc:v2:project-remote:${projectId}:${version}`;
/** @param {number} projectId @param {number} version @param {number} authorId @param {string} kind @param {string} id */
export const ctxTeam = (projectId, version, authorId, kind, id) =>
  `clioilc:v2:team:${projectId}:${version}:${authorId}:${kind}:${id}`;

// --- symmetric (format v1 blob) --------------------------------------------------------

/**
 * 0x01 || nonce(12) || AES-256-GCM(ciphertext+tag). `nonce` is for fixtures only.
 * @param {Bytes} rawKey @param {Uint8Array} plaintext @param {string} ctx @param {Uint8Array} [nonce]
 * @returns {Promise<Bytes>}
 */
export async function seal(rawKey, plaintext, ctx, nonce) {
  const iv = own(nonce ?? crypto.getRandomValues(new Uint8Array(12)));
  if (rawKey.length !== 32 || iv.length !== 12) throw new Error("bad key or nonce length");
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(ctx) }, key, own(plaintext)),
  );
  const out = new Uint8Array(1 + 12 + ct.length);
  out[0] = SEAL_VERSION;
  out.set(iv, 1);
  out.set(ct, 13);
  return out;
}

// --- identity --------------------------------------------------------------------------

/** A user's key bundle: X-Wing (receives keys) + Ed25519 (signs grants), as two 32-byte seeds. */
export class Identity {
  /** @param {Uint8Array} xwingSeed @param {Uint8Array} ed25519Seed */
  constructor(xwingSeed, ed25519Seed) {
    if (xwingSeed.length !== SEED_LEN || ed25519Seed.length !== SEED_LEN) throw new Error("seeds must be 32 bytes");
    /** @readonly */ this.xwingSeed = own(xwingSeed);
    /** @readonly */ this.ed25519Seed = own(ed25519Seed);
  }

  static generate() {
    return new Identity(crypto.getRandomValues(new Uint8Array(32)), crypto.getRandomValues(new Uint8Array(32)));
  }

  /** @param {Uint8Array} secret 64 bytes */
  static fromSecret(secret) {
    if (secret.length !== 2 * SEED_LEN) throw new Error("identity secret must be 64 bytes");
    return new Identity(secret.subarray(0, SEED_LEN), secret.subarray(SEED_LEN));
  }

  /** @returns {Bytes} */
  secret() {
    const out = new Uint8Array(2 * SEED_LEN);
    out.set(this.xwingSeed);
    out.set(this.ed25519Seed, SEED_LEN);
    return out;
  }

  /** @returns {Bytes} 1216 bytes: ML-KEM-768 public key || X25519 public key */
  xwingPublic() {
    return own(ml_kem768_x25519.keygen(this.xwingSeed).publicKey);
  }

  /** @returns {Bytes} */
  ed25519Public() {
    return own(ed25519.getPublicKey(this.ed25519Seed));
  }

  fingerprint() {
    return fingerprint(this.xwingPublic(), this.ed25519Public());
  }
}

/** SHA-256("clioilc:v2:fp" || xwing_pk || ed25519_pk). @param {Uint8Array} xwingPk @param {Uint8Array} ed25519Pk */
export async function fingerprint(xwingPk, ed25519Pk) {
  if (xwingPk.length !== XWING_PK_LEN || ed25519Pk.length !== 32) throw new Error("bad public key length");
  const label = enc.encode("clioilc:v2:fp");
  const msg = new Uint8Array(label.length + xwingPk.length + 32);
  msg.set(label);
  msg.set(xwingPk, label.length);
  msg.set(ed25519Pk, label.length + xwingPk.length);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", msg));
}

/** 32 bytes as 16 groups of 4 upper-case hex digits. @param {Uint8Array} fp */
export function formatFingerprint(fp) {
  return (hex(fp).toUpperCase().match(/.{4}/g) ?? []).join(" ");
}

// --- wrapping keys to a person (HPKE) ----------------------------------------------------

/** @param {Uint8Array} recipientXwingPk @param {Uint8Array} key @param {string} ctx @returns {Promise<Bytes>} */
export async function wrap(recipientXwingPk, key, ctx) {
  if (recipientXwingPk.length !== XWING_PK_LEN) throw new Error("bad X-Wing public key length");
  const recipientPublicKey = await suite.kem.deserializePublicKey(own(recipientXwingPk).buffer);
  const sender = await suite.createSenderContext({ recipientPublicKey, info: enc.encode(ctx).buffer });
  const ct = new Uint8Array(await sender.seal(own(key).buffer));
  const out = new Uint8Array(1 + ENC_LEN + ct.length);
  out[0] = SUITE_XWING;
  out.set(new Uint8Array(sender.enc), 1);
  out.set(ct, 1 + ENC_LEN);
  return out;
}

/** @param {Identity} identity @param {Uint8Array} blob @param {string} ctx @returns {Promise<Bytes>} */
export async function unwrap(identity, blob, ctx) {
  if (blob[0] !== SUITE_XWING || blob.length < 1 + ENC_LEN + 16) throw new Error("unknown wrap suite");
  const recipientKey = await suite.kem.deserializePrivateKey(identity.xwingSeed.buffer.slice(0));
  try {
    const recipient = await suite.createRecipientContext({
      recipientKey,
      enc: own(blob.subarray(1, 1 + ENC_LEN)).buffer,
      info: enc.encode(ctx).buffer,
    });
    return new Uint8Array(await recipient.open(own(blob.subarray(1 + ENC_LEN)).buffer));
  } catch {
    throw new Error("cannot open key: not addressed to this identity, or tampered");
  }
}

// --- grant signatures ----------------------------------------------------------------------

/**
 * @typedef {{ target: "ws" | "project", targetId: number, version: number, recipientId: number,
 *   recipientFp: Uint8Array, wrapped: Uint8Array }} GrantFields
 */

/** A fixed label, then each field as u32 big-endian length || UTF-8. @param {GrantFields} g */
export async function grantMessage(g) {
  const wrappedHash = new Uint8Array(await crypto.subtle.digest("SHA-256", own(g.wrapped)));
  const fields = [g.target, String(g.targetId), String(g.version), String(g.recipientId), hex(g.recipientFp), hex(wrappedHash)];
  const parts = [enc.encode("clioilc:v2:grant")];
  for (const f of fields) {
    const raw = enc.encode(f);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, raw.length);
    parts.push(len, raw);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** @param {Identity} granter @param {GrantFields} g */
export async function signGrant(granter, g) {
  return own(ed25519.sign(await grantMessage(g), granter.ed25519Seed));
}

/** @param {Uint8Array} granterEd25519Pk @param {Uint8Array} signature @param {GrantFields} g */
export async function verifyGrant(granterEd25519Pk, signature, g) {
  try {
    // zip215: false = strict RFC 8032 rules, like ed25519-dalek's verify_strict.
    return ed25519.verify(signature, await grantMessage(g), granterEd25519Pk, { zip215: false });
  } catch {
    return false;
  }
}
