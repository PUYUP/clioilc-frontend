import { describe, expect, it } from "vitest";
import { pickVoice, sentences } from "./speech.js";

/** @param {string} name @param {string} lang @param {boolean} local */
const v = (name, lang, local, def = false) => /** @type {SpeechSynthesisVoice} */ ({ name, lang, localService: local, default: def, voiceURI: name });

describe("pickVoice", () => {
  const voices = [v("Google Bahasa Indonesia", "id-ID", false), v("Damayanti", "id-ID", true), v("Samantha", "en-US", true), v("Google US English", "en-US", false, true)];
  it("uses on-device voices only, preferring known good ones", () => {
    expect(pickVoice(voices, "id")?.name).toBe("Damayanti");
    expect(pickVoice(voices, "en")?.name).toBe("Samantha");
    expect(pickVoice([v("Google Bahasa Indonesia", "id-ID", false)], "id")).toBeNull();
  });
});

describe("sentences", () => {
  it("splits on sentence ends and lines, drops list dashes, caps length", () => {
    expect(sentences("- Done: A. Next: B!\n- Pending: C")).toEqual(["Done: A.", "Next: B!", "Pending: C"]);
    const long = sentences(`${"word ".repeat(100)}.`, 50);
    expect(long.every((s) => s.length <= 50)).toBe(true);
    expect(long.join(" ").replace(/\s+/g, " ")).toBe(`${"word ".repeat(100)}.`.replace(/\s+/g, " ").trim());
  });
});
