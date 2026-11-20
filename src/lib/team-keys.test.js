import { describe, expect, it } from "vitest";
import f from "./__fixtures__/e2e-v2.json";
import { Identity } from "./e2e-v2.js";
import { decryptTeamRows, hex, keyId, makeGrant, openGrants, splitRecipients, toB64, trustOf } from "./team-keys.js";

/** @param {string} s */
const unhex = (s) => new Uint8Array(s.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
/** @param {"alice" | "bob"} who */
const person = (who) => new Identity(unhex(f[who].xwing_seed), unhex(f[who].ed25519_seed));
/** @param {"alice" | "bob"} who */
const row = (who) => ({
  user_id: f[who].user_id, username: who,
  xwing_pk: toB64(unhex(f[who].xwing_pk)), ed25519_pk: toB64(unhex(f[who].ed25519_pk)), fingerprint: f[who].fingerprint,
});
const bob = person("bob");
const me = { id: 42 };
/** @param {any} [identities] */
const state = (identities) => /** @type {any} */ ({
  workspace: { id: 1, slug: "acme", version: 1, rotation_needed: false }, projects: [], waiting: [], recipients: {},
  grants: [{ target: "project", target_id: 7, version: 1, wrapped: toB64(unhex(f.grant.wrapped)), signature: toB64(unhex(f.grant.signature)), granter_id: 41 }],
  identities: identities ?? { 41: row("alice"), 42: row("bob") },
});
const alicePin = { 41: { username: "alice", ed25519_pk: row("alice").ed25519_pk, fingerprint: f.alice.fingerprint } };

describe("team keys", () => {
  it("does not use a key from someone not verified yet", async () => {
    const r = await openGrants({ state: state(), me, identity: bob, pins: {} });
    expect(r.keys.size).toBe(0);
    expect(r.toVerify.map((v) => [v.username, v.trust, v.fingerprint])).toEqual([["alice", "unknown", f.alice.fingerprint]]);
  });

  it("opens a verified grant", async () => {
    const r = await openGrants({ state: state(), me, identity: bob, pins: alicePin });
    expect(hex(/** @type {Uint8Array} */ (r.keys.get(keyId("project", 7, 1))))).toBe(f.project.key);
    expect(r.problems).toEqual([]);
  });

  it("refuses a changed key and a server fingerprint that does not match the keys", async () => {
    const changed = { 41: { ...alicePin[41], ed25519_pk: toB64(new Uint8Array(32).fill(9)) } };
    expect((await openGrants({ state: state(), me, identity: bob, pins: changed })).toVerify[0].trust).toBe("changed");
    const lying = { 41: { ...row("alice"), fingerprint: "0".repeat(64) }, 42: row("bob") };
    expect(await trustOf(alicePin, 42, row("bob").ed25519_pk, 41, lying[41])).toBe("mismatch");
    expect((await openGrants({ state: state(lying), me, identity: bob, pins: alicePin })).keys.size).toBe(0);
  });

  it("refuses a grant whose signature is not the granter's", async () => {
    const st = state();
    st.grants[0].signature = toB64(new Uint8Array(64).fill(1));
    const r = await openGrants({ state: st, me, identity: bob, pins: alicePin });
    expect(r.keys.size).toBe(0);
    expect(r.problems[0]).toContain("bad signature");
  });

  it("makes grants the recipient can verify and open", async () => {
    const alice = person("alice");
    const key = new Uint8Array(32).fill(5);
    const g = await makeGrant({ granter: alice, recipient: row("bob"), target: "ws", targetId: 3, version: 2, key });
    const st = state();
    st.grants = [{ target: "ws", target_id: 3, version: 2, ...g, granter_id: 41 }];
    const r = await openGrants({ state: st, me, identity: bob, pins: alicePin });
    expect(hex(/** @type {Uint8Array} */ (r.keys.get("ws:3:2")))).toBe(hex(key));
  });

  it("splits recipients into ready and to-verify", async () => {
    const alice = person("alice");
    const st = state();
    const split = await splitRecipients({ ids: [41, 42], state: st, me: { id: 41 }, identity: alice, pins: {} });
    expect(split.ready.map((r) => r.username)).toEqual(["alice"]);
    expect(split.verify.map((v) => v.username)).toEqual(["bob"]);
  });

  it("turns team records into timeline rows, unreadable without the key", async () => {
    const r = f.team_record;
    const res = {
      private: [{ kind: "project", id: "p".repeat(32), project_pk: 7, key_version: 1, slug: "api", name_ct: toB64(unhex(f.name.sealed)) }],
      team_records: [{ project_pk: 7, key_version: 1, author_id: 42, user: "bob", kind: "prompt", id: r.id, ts: "2026-11-20T03:00:00Z", ciphertext: toB64(unhex(r.sealed)) }],
    };
    const key = unhex(f.project.key);
    const rows = await decryptTeamRows(res, (t, id, v) => (t === "project" && id === 7 && v === 1 ? key : null));
    expect(rows[0]).toEqual({ kind: "project", id: "p".repeat(32), ts: null, data: { name: "Acme API", slug: "api" } });
    expect(rows[1]).toMatchObject({ kind: "prompt", user: "bob", data: r.data });
    const locked = await decryptTeamRows(res, () => null);
    expect(locked[0].data.name).toBe("api");
    expect(locked[1]).toMatchObject({ kind: "prompt", error: "unreadable" });
  });
});
