// E2E team workspaces in the browser (backend docs/e2e-teams.md): my identity,
// teammates I verified (pins), and the team keys I can open. Keys live in
// memory only, like the account's data key (vault.svelte.js).
import { api, ApiError } from "./api.js";
import { Identity, ctxIdentity, ctxProjectName, ctxProjectRemote, ctxWsName, open, seal } from "./e2e-v2.js";
import { decryptTeamRows, fromB64, hex, keyId, makeGrant, openGrants, splitRecipients, toB64 } from "./team-keys.js";
import { LockedError, vault } from "./vault.svelte.js";

/**
 * @typedef {import("./team-keys.js").KeyState} KeyState
 * @typedef {import("./team-keys.js").Pin} Pin
 * @typedef {{ user_id: number, username: string, fingerprint: string, ed25519_pk: string, trust: string }} ToVerify
 */

const dec = new TextDecoder();
const enc = new TextEncoder();

export const team = $state({
  /** @type {{ id: number, username: string, enc_mode: string | null } | null} */
  me: null,
  /** @type {Identity | null} */
  identity: null,
  /** My fingerprint, hex. */
  fingerprint: /** @type {string | null} */ (null),
  /** Teammates whose keys I verified, by user id. */
  pins: /** @type {Record<string, Pin>} */ ({}),
  /** Opened team keys by keyId(target, id, version). */
  keys: /** @type {Record<string, Uint8Array<ArrayBuffer>>} */ ({}),
  /** Per workspace slug: the server's key state and what is left to do. */
  states: /** @type {Record<string, { state: KeyState, toVerify: ToVerify[], problems: string[] }>} */ ({}),
  /** Decrypted names: "ws:<id>" / "project:<id>" -> name; "remote:<id>" -> git remote. */
  names: /** @type {Record<string, string>} */ ({}),
});

/** Thrown when a new key would go to people this browser has not verified. */
export class VerifyFirstError extends Error {
  /** @param {ToVerify[]} people */
  constructor(people) {
    super("Verify these people's fingerprints first.");
    this.people = people;
  }
}

export async function loadMe() {
  if (!team.me) team.me = await api("/api/v1/users/me/");
  return /** @type {NonNullable<typeof team.me>} */ (team.me);
}

export const isE2EAccount = () => team.me?.enc_mode === "e2e";

// --- pins (per browser; losing them only means verifying again) ----------------------

const pinKey = (/** @type {number} */ id) => `clioilc.pins.${id}`;

function readPins(/** @type {number} */ id) {
  try {
    return JSON.parse(localStorage.getItem(pinKey(id)) ?? "{}");
  } catch {
    return {};
  }
}

function writePins() {
  if (!team.me) return;
  try {
    localStorage.setItem(pinKey(team.me.id), JSON.stringify(team.pins));
  } catch {
    /* private mode: pins last for this tab only */
  }
}

/** Record that I compared this person's fingerprint with them. @param {ToVerify} p */
export async function pin(p) {
  team.pins = { ...team.pins, [String(p.user_id)]: { username: p.username, ed25519_pk: p.ed25519_pk, fingerprint: p.fingerprint } };
  writePins();
}

// --- identity ----------------------------------------------------------------------------

/** @type {Promise<Identity> | null} */
let pendingIdentity = null;

/**
 * Opens (or creates and uploads) my identity bundle. Needs the unlocked data
 * key. Concurrent callers share one attempt, and a 409 (another client made
 * one meanwhile) loads that one instead of overwriting it.
 */
export function ensureIdentity() {
  if (team.identity) return Promise.resolve(team.identity);
  pendingIdentity ??= loadOrCreateIdentity().finally(() => (pendingIdentity = null));
  return pendingIdentity;
}

async function loadOrCreateIdentity() {
  const dek = vault.dataKey;
  if (!dek) throw new LockedError();
  const me = await loadMe();
  if (me.enc_mode !== "e2e") throw new Error("Team keys need an end-to-end account.");
  team.pins = readPins(me.id);
  const fetchExisting = async () => {
    const row = await api("/api/v1/users/identity/");
    return Identity.fromSecret(await open(dek, fromB64(row.wrapped_secret), ctxIdentity(me.id)));
  };
  /** @type {Identity} */
  let identity;
  try {
    identity = await fetchExisting();
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
    identity = Identity.generate();
    try {
      await api("/api/v1/users/identity/", {
        method: "PUT",
        body: {
          xwing_pk: toB64(identity.xwingPublic()),
          ed25519_pk: toB64(identity.ed25519Public()),
          wrapped_secret: toB64(await seal(dek, identity.secret(), ctxIdentity(me.id))),
        },
      });
    } catch (err) {
      // Another client created one first: use it, never replace it here.
      if (!(err instanceof ApiError && err.code === "identity_exists")) throw err;
      identity = await fetchExisting();
    }
  }
  team.identity = identity;
  team.fingerprint = hex(await identity.fingerprint());
  return identity;
}

// --- keys of a workspace ------------------------------------------------------------------

/** Load the key state of a workspace and open every grant I may use. @param {string} slug */
export async function loadKeys(slug) {
  const identity = await ensureIdentity();
  const me = await loadMe();
  /** @type {KeyState} */
  const state = await api(`/api/v1/workspaces/${slug}/keys/`);
  const { keys, toVerify, problems } = await openGrants({ state, me, identity, pins: team.pins });
  team.keys = { ...team.keys, ...Object.fromEntries(keys) };
  team.states = { ...team.states, [slug]: { state, toVerify, problems } };
  return team.states[slug];
}

/** @param {"ws" | "project"} target @param {number} id @param {number} version */
export const keyFor = (target, id, version) => team.keys[keyId(target, id, version)] ?? null;

/**
 * Decrypt a workspace's name and its projects' names and remotes into team.names.
 * @param {{ id: number, name_ct: string | null, key_version: number }} ws
 * @param {{ id: number, name_ct: string | null, remote_ct: string | null, key_version: number }[]} [projects]
 */
export async function decryptNames(ws, projects = []) {
  const names = { ...team.names };
  const k = keyFor("ws", ws.id, ws.key_version);
  if (k && ws.name_ct) names[`ws:${ws.id}`] = await openText(k, ws.name_ct, ctxWsName(ws.id, ws.key_version));
  for (const p of projects) {
    const pk = keyFor("project", p.id, p.key_version);
    if (!pk) continue;
    if (p.name_ct) names[`project:${p.id}`] = await openText(pk, p.name_ct, ctxProjectName(p.id, p.key_version));
    if (p.remote_ct) names[`remote:${p.id}`] = await openText(pk, p.remote_ct, ctxProjectRemote(p.id, p.key_version));
  }
  team.names = names;
}

/** @param {Uint8Array<ArrayBuffer>} key @param {string} b64 @param {string} ctx */
async function openText(key, b64, ctx) {
  try {
    return dec.decode(await open(key, fromB64(b64), ctx));
  } catch {
    return "(unreadable)";
  }
}

/** A workspace row's display name. @param {{ id: number, slug: string, name: string, enc_mode?: string }} w */
export function wsLabel(w) {
  return w.enc_mode === "e2e" ? (team.names[`ws:${w.id}`] ?? w.slug) : w.name;
}

/** @param {{ id: number, slug: string, name: string }} p @param {boolean} e2e */
export function projectLabel(p, e2e) {
  return e2e ? (team.names[`project:${p.id}`] ?? p.slug) : p.name;
}

// --- giving keys ----------------------------------------------------------------------------

/**
 * Approve someone waiting for keys, after comparing their fingerprint with
 * them: pins them, then grants every waiting key I hold.
 * @param {string} slug @param {ToVerify} person
 */
export async function approve(slug, person) {
  const identity = await ensureIdentity();
  await pin(person);
  const { state } = team.states[slug] ?? (await loadKeys(slug));
  const row = state.identities[String(person.user_id)];
  const grants = [];
  for (const w of state.waiting.filter((x) => x.user_id === person.user_id)) {
    const key = keyFor(w.target, w.target_id, w.version);
    if (!key) continue; // a key I do not hold: another manager gives it
    grants.push({ target: w.target, target_id: w.target_id, version: w.version, ...(await makeGrant({ granter: identity, recipient: row, target: w.target, targetId: w.target_id, version: w.version, key })) });
  }
  if (grants.length) await api(`/api/v1/workspaces/${slug}/keys/grants/`, { method: "POST", body: { recipient_id: person.user_id, grants } });
  await loadKeys(slug);
  return grants.length;
}

/**
 * Install the next version of a key (first key or rotation), with the name
 * (and remote) sealed under it and a grant for every recipient. Throws
 * VerifyFirstError when some recipient is not verified in this browser.
 * @param {string} slug @param {"ws" | "project"} target @param {number} targetId
 * @param {{ name: string, remote?: string | null }} plain
 */
export async function installKey(slug, target, targetId, plain) {
  const identity = await ensureIdentity();
  const me = await loadMe();
  const { state } = await loadKeys(slug);
  const current = target === "ws" ? state.workspace.version : (state.projects.find((p) => p.id === targetId)?.version ?? 0);
  const version = current + 1;
  const ids = state.recipients[target === "ws" ? "ws" : `project:${targetId}`] ?? [me.id];
  const { ready, verify } = await splitRecipients({ ids, state, me, identity, pins: team.pins });
  if (verify.length) throw new VerifyFirstError(verify);
  const key = crypto.getRandomValues(new Uint8Array(32));
  const grants = [];
  for (const recipient of ready) {
    grants.push({ recipient_id: recipient.user_id, ...(await makeGrant({ granter: identity, recipient, target, targetId, version, key })) });
  }
  const nameCtx = target === "ws" ? ctxWsName(targetId, version) : ctxProjectName(targetId, version);
  /** @type {Record<string, unknown>} */
  const body = { target, target_id: targetId, version, grants, name_ct: toB64(await seal(key, enc.encode(plain.name), nameCtx)) };
  if (target === "project" && plain.remote) body.remote_ct = toB64(await seal(key, enc.encode(plain.remote), ctxProjectRemote(targetId, version)));
  await api(`/api/v1/workspaces/${slug}/keys/`, { method: "POST", body });
  team.keys = { ...team.keys, [keyId(target, targetId, version)]: key };
  await loadKeys(slug);
}

/** A new name or remote sealed with the current key. @param {"ws-name" | "project-name" | "project-remote"} what @param {number} id @param {number} version @param {string} text */
export async function sealCurrent(what, id, version, text) {
  const key = keyFor(what === "ws-name" ? "ws" : "project", id, version);
  if (!key) throw new Error("You do not hold this key.");
  const ctx = what === "ws-name" ? ctxWsName(id, version) : what === "project-name" ? ctxProjectName(id, version) : ctxProjectRemote(id, version);
  return toB64(await seal(key, enc.encode(text), ctx));
}

// --- team data (activity) ----------------------------------------------------------------------

/**
 * Turn an E2E team activity response into the private-row shape the
 * timeline already understands. Records whose key I cannot open become
 * "unreadable" rows.
 * @param {any} res a /usage/activity/?workspace= response with enc_mode "e2e"
 */
export async function openTeamActivity(res) {
  await loadKeys(res.workspace);
  const rows = await decryptTeamRows(res, keyFor);
  return { rows, notes: team.states[res.workspace]?.toVerify.length ? ["Some team data is waiting for you to verify a teammate's key on the workspace page."] : [] };
}
