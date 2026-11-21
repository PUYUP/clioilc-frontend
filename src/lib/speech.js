// Read summaries aloud with the browser's speech synthesis, using
// on-device voices only (backend docs/journal.md): voices with
// `localService === false` (for example "Google Bahasa Indonesia") send the
// text to a server to be spoken, which end-to-end data must never do.

/** Preferred on-device voices per language (macOS names). */
const PREFERRED = /** @type {Record<string, string[]>} */ ({ id: ["Damayanti"], en: ["Samantha", "Alex", "Daniel"] });

/**
 * The on-device voice for `lang`, if any.
 * @param {SpeechSynthesisVoice[]} voices @param {string} lang
 * @returns {SpeechSynthesisVoice | null}
 */
export function pickVoice(voices, lang) {
  const local = voices.filter((v) => v.localService && v.lang.toLowerCase().startsWith(lang.toLowerCase()));
  for (const name of PREFERRED[lang] ?? []) {
    const v = local.find((x) => x.name.startsWith(name));
    if (v) return v;
  }
  return local.find((v) => v.default) ?? local[0] ?? null;
}

/**
 * Sentences of at most `max` characters, so long texts do not hit engine
 * limits and stopping is quick.
 * @param {string} text @param {number} [max]
 */
export function sentences(text, max = 220) {
  const out = [];
  for (const raw of text.replace(/^\s*-\s+/gm, "").split(/(?<=[.!?])\s+|\n+/)) {
    let s = raw.trim();
    while (s.length > max) {
      const cut = s.lastIndexOf(" ", max);
      const at = cut > max / 2 ? cut : max;
      out.push(s.slice(0, at));
      s = s.slice(at).trim();
    }
    if (s) out.push(s);
  }
  return out;
}

/** Voices load asynchronously in some browsers. @returns {Promise<SpeechSynthesisVoice[]>} */
export function voices() {
  const synth = globalThis.speechSynthesis;
  if (!synth) return Promise.resolve([]);
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener?.("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}

/**
 * Speak `text` with `voice`. Returns controls; `onEnd` runs once when done
 * or stopped.
 * @param {string} text @param {SpeechSynthesisVoice} voice @param {() => void} [onEnd]
 */
export function speak(text, voice, onEnd) {
  const synth = globalThis.speechSynthesis;
  synth.cancel();
  const parts = sentences(text);
  let ended = false;
  const finish = () => {
    if (!ended) {
      ended = true;
      onEnd?.();
    }
  };
  parts.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part);
    u.voice = voice;
    u.lang = voice.lang;
    if (i === parts.length - 1) {
      u.onend = finish;
      u.onerror = finish;
    }
    synth.speak(u);
  });
  if (!parts.length) finish();
  return {
    pause: () => synth.pause(),
    resume: () => synth.resume(),
    stop: () => {
      synth.cancel();
      finish();
    },
  };
}
