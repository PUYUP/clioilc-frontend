// Fixture made by an independent implementation (Python argon2-cffi +
// cryptography) in the documented format v1; see backend docs/encryption.md.
import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/e2e-v1.json";
import { decryptRecord, deriveKey, open, unlock } from "./e2e.js";

/** @param {Uint8Array} b */
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

describe("e2e format v1", () => {
  it("derives the documented Argon2id test vector", async () => {
    const key = await deriveKey("passphrase", fixture.keyring.kdf);
    expect(hex(key)).toBe("ab76d9ada2f130af1f8594d81020c6a39202dc3e17350172f7507e87cfaa65bb");
    expect(hex(key)).toBe(fixture.kek_hex);
  });

  it("unlocks the keyring and decrypts a record", async () => {
    const { dataKey, raw, salt } = await unlock(fixture.keyring, fixture.passphrase);
    expect(hex(raw)).toBe(fixture.dek_hex);
    // The key kept for the session cannot be read back by script.
    expect(dataKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", dataKey)).rejects.toThrow();
    expect(hex(salt)).toBe(fixture.salt_hex);
    expect(await decryptRecord(dataKey, fixture.record)).toEqual(fixture.record_data);
  });

  it("rejects a wrong passphrase", async () => {
    await expect(unlock(fixture.keyring, "wrong passphrase")).rejects.toThrow();
  });

  it("rejects a record moved to another id or kind", async () => {
    const { dataKey } = await unlock(fixture.keyring, fixture.passphrase);
    await expect(decryptRecord(dataKey, { ...fixture.record, id: "b".repeat(32) })).rejects.toThrow();
    await expect(decryptRecord(dataKey, { ...fixture.record, kind: "block" })).rejects.toThrow();
  });

  it("rejects an unknown format version", async () => {
    const key = new Uint8Array(32);
    await expect(open(key, new Uint8Array([2, ...new Uint8Array(40)]), "x")).rejects.toThrow("version");
  });
});
