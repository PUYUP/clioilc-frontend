// E2E team keys in the browser (backend docs/e2e-teams.md): trust decisions,
// opening grants, and building grants and new key versions. Pure functions;
// the state and API calls live in team.svelte.js.
//
// Trust rule (same as the tracker): a grant is used only when its Ed25519
// signature verifies against this account's own key, or against a teammate
// key pinned after comparing fingerprints. Fingerprints are always computed
// here from the public keys, never taken from the server's string.
import { ctxGrant, ctxProjectName, ctxTeam, fingerprint, open, signGrant, unwrap, verifyGrant, wrap } from "./e2e-v2.js";

/** @param {string} s */
export const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
/** @param {Uint8Array} b */
export const toB64 = (b) => btoa(String.fromCharCode(...b));
/** @param {Uint8Array} b */
export const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/**
 * @typedef {{ user_id: number, username: string, xwing_pk: string, ed25519_pk: string, fingerprint: string }} IdentityRow
 * @typedef {{ username: string, ed25519_pk: string, fingerprint: string }} Pin
 * @typedef {{ target: "ws" | "project", target_id: number, version: number, wrapped: string, signature: string, granter_id: number | null }} GrantRow
 * @typedef {{ workspace: { id: number, slug: string, version: number, rotation_needed: boolean },
 *   projects: { id: number, slug: string, version: number, rotation_needed: boolean }[],
 *   grants: GrantRow[], waiting: { user_id: number, target: "ws" | "project", target_id: number, version: number }[],
 *   recipients: Record<string, number[]>, identities: Record<string, IdentityRow> }} KeyState
 * @typedef {"mine" | "pinned" | "unknown" | "changed" | "mismatch"} Trust
 */

/** The fingerprint of a server identity row, computed locally. @param {IdentityRow} row */
export async function rowFingerprint(row) {
  return hex(await fingerprint(fromB64(row.xwing_pk), fromB64(row.ed25519_pk)));
}

/**
 * @param {Record<string, Pin>} pins @param {number} meId @param {string} myEd25519B64
 * @param {number} userId @param {IdentityRow} row @returns {Promise<Trust>}
 */
export async function trustOf(pins, meId, myEd25519B64, userId, row) {
  const fp = await rowFingerprint(row);
  if (fp !== row.fingerprint) return "mismatch"; // the server's string disagrees with the keys
  if (userId === meId) return row.ed25519_pk === myEd25519B64 ? "mine" : "changed";
  const pin = pins[String(userId)];
  if (!pin) return "unknown";
  return pin.ed25519_pk === row.ed25519_pk && pin.fingerprint === fp ? "pinned" : "changed";
}

/** Map key for an opened team key. @param {"ws" | "project"} target @param {number} id @param {number} version */
export const keyId = (target, id, version) => `${target}:${id}:${version}`;

/**
 * Verify and open my grants. Returns opened keys, and the granters whose keys
 * I still have to verify (or that changed).
 * @param {{ state: KeyState, me: { id: number }, identity: import("./e2e-v2.js").Identity, pins: Record<string, Pin> }} a
 */
export async function openGrants({ state, me, identity, pins }) {
  const myFp = await identity.fingerprint();
  const myEd = toB64(identity.ed25519Public());
  /** @type {Map<string, Uint8Array<ArrayBuffer>>} */
  const keys = new Map();
  /** @type {Map<number, { user_id: number, username: string, fingerprint: string, ed25519_pk: string, trust: Trust }>} */
  const toVerify = new Map();
  /** @type {string[]} */
  const problems = [];
  for (const g of state.grants) {
    if (g.granter_id == null) {
      problems.push(`A ${g.target} key (v${g.version}) has no granter any more; ask for a new grant.`);
      continue;
    }
    const row = state.identities[String(g.granter_id)];
    if (!row) {
      problems.push(`The public key of the person who gave you a ${g.target} key is missing.`);
      continue;
    }
    const trust = await trustOf(pins, me.id, myEd, g.granter_id, row);
    if (trust !== "mine" && trust !== "pinned") {
      toVerify.set(g.granter_id, { user_id: g.granter_id, username: row.username, fingerprint: await rowFingerprint(row), ed25519_pk: row.ed25519_pk, trust });
      continue;
    }
    const wrapped = fromB64(g.wrapped);
    const fields = { target: g.target, targetId: g.target_id, version: g.version, recipientId: me.id, recipientFp: myFp, wrapped };
    if (!(await verifyGrant(fromB64(row.ed25519_pk), fromB64(g.signature), fields))) {
      problems.push(`A ${g.target} key from @${row.username} has a bad signature; it is not used.`);
      continue;
    }
    try {
      keys.set(keyId(g.target, g.target_id, g.version), await unwrap(identity, wrapped, ctxGrant(g.target, g.target_id, g.version, me.id)));
    } catch {
      problems.push(`A ${g.target} key from @${row.username} could not be opened.`);
    }
  }
  return { keys, toVerify: [...toVerify.values()], problems };
}

/**
 * A signed grant of `key` for one recipient, whose fingerprint is computed here.
 * @param {{ granter: import("./e2e-v2.js").Identity, recipient: IdentityRow, target: "ws" | "project", targetId: number, version: number, key: Uint8Array }} a
 */
export async function makeGrant({ granter, recipient, target, targetId, version, key }) {
  const recipientFp = await fingerprint(fromB64(recipient.xwing_pk), fromB64(recipient.ed25519_pk));
  const wrapped = await wrap(fromB64(recipient.xwing_pk), key, ctxGrant(target, targetId, version, recipient.user_id));
  const signature = await signGrant(granter, { target, targetId, version, recipientId: recipient.user_id, recipientFp, wrapped });
  return { wrapped: toB64(wrapped), signature: toB64(signature) };
}

/**
 * Who a new key version must be granted to, split into those I can grant
 * (myself or verified) and those I must verify first. A recipient list comes
 * from the server, so an unverified person never receives a key from me.
 * @param {{ ids: number[], state: KeyState, me: { id: number }, identity: import("./e2e-v2.js").Identity, pins: Record<string, Pin> }} a
 */
export async function splitRecipients({ ids, state, me, identity, pins }) {
  const myEd = toB64(identity.ed25519Public());
  /** @type {IdentityRow[]} */ const ready = [];
  /** @type {{ user_id: number, username: string, fingerprint: string, ed25519_pk: string, trust: Trust }[]} */ const verify = [];
  for (const id of ids) {
    const row = state.identities[String(id)];
    if (!row) throw new Error("A recipient's public key is missing; reload and try again.");
    const trust = await trustOf(pins, me.id, myEd, id, row);
    if (trust === "mine" || trust === "pinned") ready.push(row);
    else verify.push({ user_id: id, username: row.username, fingerprint: await rowFingerprint(row), ed25519_pk: row.ed25519_pk, trust });
  }
  return { ready, verify };
}

/** 64 hex chars as 16 groups of 4, upper case. @param {string} fpHex */
export const showFingerprint = (fpHex) => (fpHex.toUpperCase().match(/.{4}/g) ?? []).join(" ");

/**
 * An E2E team activity response -> private rows in the shape the timeline
 * reads (v1 `data` objects). A record whose key I do not hold, or that fails
 * to open, becomes an "unreadable" row instead of failing the whole day.
 * @param {any} res @param {(target: "ws" | "project", id: number, version: number) => Uint8Array<ArrayBuffer> | null} keyFor
 */
export async function decryptTeamRows(res, keyFor) {
  const dec = new TextDecoder();
  const rows = [];
  for (const p of res.private ?? []) {
    if (p.kind !== "project") continue;
    const key = keyFor("project", p.project_pk, p.key_version);
    let name = p.slug;
    if (key && p.name_ct) {
      try {
        name = dec.decode(await open(key, fromB64(p.name_ct), ctxProjectName(p.project_pk, p.key_version)));
      } catch {
        name = p.slug;
      }
    }
    rows.push({ kind: "project", id: p.id, ts: null, data: { name, slug: p.slug } });
  }
  for (const r of res.team_records ?? []) {
    const key = keyFor("project", r.project_pk, r.key_version);
    const row = { kind: r.kind, id: r.id, ts: r.ts, user: r.user };
    try {
      if (!key) throw new Error("no key");
      const plain = await open(key, fromB64(r.ciphertext), ctxTeam(r.project_pk, r.key_version, r.author_id, r.kind, r.id));
      rows.push({ ...row, data: JSON.parse(dec.decode(plain)) });
    } catch {
      rows.push({ ...row, error: "unreadable" });
    }
  }
  return rows;
}
