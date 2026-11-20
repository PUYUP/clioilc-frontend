// The cross-implementation fixture is made by the reference implementation:
// backend `manage.py make_e2e_v2_fixture` (apps/core/e2e_v2.py).
import { describe, expect, it } from "vitest";
import f from "./__fixtures__/e2e-v2.json";
import {
  ENC_LEN, Identity, ctxGrant, ctxProjectName, ctxProjectRemote, ctxTeam, formatFingerprint,
  grantMessage, open, seal, signGrant, unwrap, verifyGrant, wrap,
} from "./e2e-v2.js";

/** @param {string} s */
const unhex = (s) => new Uint8Array(s.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
/** @param {Uint8Array} b */
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
/** @param {"alice" | "bob"} who */
const person = (who) => new Identity(unhex(f[who].xwing_seed), unhex(f[who].ed25519_seed));

describe("e2e format v2", () => {
  it("derives the reference keys, fingerprints and identity secret", async () => {
    for (const who of /** @type {const} */ (["alice", "bob"])) {
      const id = person(who);
      expect(hex(id.xwingPublic())).toBe(f[who].xwing_pk);
      expect(hex(id.ed25519Public())).toBe(f[who].ed25519_pk);
      const fp = await id.fingerprint();
      expect(hex(fp)).toBe(f[who].fingerprint);
      expect(formatFingerprint(fp)).toBe(f[who].fingerprint_display);
      const sealed = await seal(unhex(f[who].dek), id.secret(), f[who].identity_ctx, unhex(f[who].identity_nonce));
      expect(hex(sealed)).toBe(f[who].identity_sealed);
      const secret = await open(unhex(f[who].dek), unhex(f[who].identity_sealed), f[who].identity_ctx);
      expect(hex(Identity.fromSecret(secret).secret())).toBe(hex(id.secret()));
    }
  });

  it("opens and verifies the reference grant, and signs it identically", async () => {
    const alice = person("alice"), bob = person("bob");
    const g = f.grant;
    expect(ctxGrant("project", 7, 1, 42)).toBe(g.ctx);
    const wrapped = unhex(g.wrapped);
    expect(hex(await unwrap(bob, wrapped, g.ctx))).toBe(f.project.key);
    await expect(unwrap(alice, wrapped, g.ctx)).rejects.toThrow("cannot open key");
    await expect(unwrap(bob, wrapped, ctxGrant("project", 7, 1, 43))).rejects.toThrow("cannot open key");

    const fields = { target: /** @type {const} */ ("project"), targetId: 7, version: 1, recipientId: 42, recipientFp: await bob.fingerprint(), wrapped };
    expect(hex(await grantMessage(fields))).toBe(g.message);
    expect(hex(await signGrant(alice, fields))).toBe(g.signature);
    const sig = unhex(g.signature);
    expect(await verifyGrant(alice.ed25519Public(), sig, fields)).toBe(true);
    expect(await verifyGrant(bob.ed25519Public(), sig, fields)).toBe(false);
    expect(await verifyGrant(alice.ed25519Public(), sig, { ...fields, version: 2 })).toBe(false);
  });

  it("seals and opens content like the reference", async () => {
    const key = unhex(f.project.key);
    expect(f.name.ctx).toBe(ctxProjectName(7, 1));
    expect(f.remote.ctx).toBe(ctxProjectRemote(7, 1));
    for (const item of [f.name, f.remote]) {
      expect(hex(await seal(key, new TextEncoder().encode(item.plain), item.ctx, unhex(item.nonce)))).toBe(item.sealed);
      expect(new TextDecoder().decode(await open(key, unhex(item.sealed), item.ctx))).toBe(item.plain);
    }
    const r = f.team_record;
    expect(r.ctx).toBe(ctxTeam(7, 1, 42, "prompt", "a".repeat(32)));
    expect(JSON.parse(new TextDecoder().decode(await open(key, unhex(r.sealed), r.ctx)))).toEqual(r.data);
    await expect(open(key, unhex(r.sealed), ctxTeam(7, 1, 42, "prompt", "b".repeat(32)))).rejects.toThrow();
  });

  it("round-trips with fresh keys", async () => {
    const carol = Identity.generate();
    const key = new Uint8Array(32).fill(7);
    const ctx = ctxGrant("ws", 1, 3, 9);
    const blob = await wrap(carol.xwingPublic(), key, ctx);
    expect(blob.length).toBe(1 + ENC_LEN + 32 + 16);
    expect(hex(await unwrap(carol, blob, ctx))).toBe(hex(key));
    expect(hex(blob)).not.toBe(hex(await wrap(carol.xwingPublic(), key, ctx)));
    expect(() => ctxGrant(/** @type {any} */ ("org"), 1, 1, 1)).toThrow();
  });
});
