// On-device summaries for the journal (backend docs/journal.md, Fase B):
// Chrome's built-in AI (Gemini Nano) via the Summarizer and Prompt
// (LanguageModel) APIs. Nothing leaves this computer, so it works for
// end-to-end data too.
//
// The model never reads raw logs: it gets compact facts built here from
// work items (deterministic), and is told to use only those. Small models
// invent things when given a mess; given facts, they only rephrase them.
import { shortHash } from "./commits.js";
import { span, statusOf, STATUS_LABEL } from "./journal.js";

/** @typedef {import("./journal.js").WorkItem} WorkItem */
/** @typedef {"unavailable" | "downloadable" | "downloading" | "available"} Availability */

export const LANGUAGES = /** @type {const} */ ([
  { code: "id", label: "Bahasa Indonesia" },
  { code: "en", label: "English" },
]);
/** @typedef {typeof LANGUAGES[number]["code"]} Lang */

const day = (/** @type {Date} */ d) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
const minutes = (/** @type {number} */ ms) => {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} minutes` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

/**
 * The facts of one work item, as short labelled lines.
 * @param {WorkItem} w @param {string} project @param {Date} [now]
 */
export function itemFacts(w, project, now = new Date()) {
  const status = statusOf(w, now);
  const lines = [`Work item: ${w.title ?? "untitled"}`, `Project: ${project}${w.branch ? `, branch ${w.branch}` : ""}`];
  const why = {
    active: w.edited ? "changes not committed yet" : "discussion",
    pending: `changes not committed, no activity since ${day(w.lastActivity)}`,
    committed: "committed, not pushed yet",
    done: w.prs.length ? "pull request opened" : w.closedBy === "outside" ? "finished outside the agent" : "pushed",
    abandoned: "no changes, no activity for days",
    discarded: "changes were discarded",
  }[status];
  lines.push(`Status: ${STATUS_LABEL[status]} (${why})`);
  lines.push(
    `Activity: ${w.prompts} prompt${w.prompts === 1 ? "" : "s"}, about ${minutes(w.activeMs)} active, ${day(w.started)} to ${day(w.lastActivity)}`,
  );
  for (const p of w.pauses) lines.push(`Paused: ${span(p.to.getTime() - p.from.getTime())}`);
  if (w.commits.length) {
    const shown = w.commits.slice(0, 8).map((c) => `${shortHash(c.hash)} ${c.subject}${c.insertions != null ? ` (+${c.insertions} -${c.deletions})` : ""}`);
    lines.push(`Commits (${w.commits.length}): ${shown.join("; ")}${w.commits.length > 8 ? "; …" : ""}`);
  }
  if (w.prs.length) lines.push(`Pull requests: ${w.prs.join(", ")}`);
  if (w.files.length) {
    const names = w.files.slice(0, 8).map((f) => f.path.split("/").slice(-2).join("/"));
    lines.push(`Files changed (${w.files.length}): ${names.join(", ")}${w.files.length > 8 ? ", …" : ""}`);
  }
  const repeated = w.errors.filter((e) => e.count >= 3);
  for (const e of repeated.slice(0, 3)) lines.push(`Repeated error (${e.count}x, ${e.tool}): ${e.sample ?? "details not shared"}`);
  return lines.join("\n");
}

/**
 * The facts of a week, grouped by status. Items are listed as one line each;
 * people are never measured (no hours or idle time per person).
 * @param {ReturnType<typeof import("./journal.js").weekSummary>} week
 * @param {(id: string | null) => string} projectName
 */
export function weekFacts(week, projectName) {
  /** @param {WorkItem} w */
  const line = (w) => {
    const bits = [projectName(w.projectId)];
    if (w.commits.length) bits.push(`${w.commits.length} commit${w.commits.length === 1 ? "" : "s"}`);
    if (w.prs.length) bits.push(`${w.prs.length} PR`);
    if (w.user) bits.push(`by @${w.user}`);
    return `- ${w.title ?? "untitled"} (${bits.join(", ")})`;
  };
  const n = (/** @type {number} */ k, /** @type {string} */ w) => `${k} ${w}${k === 1 ? "" : "s"}`;
  const out = [`Week: ${n(week.items, "work item")}, ${n(week.commits, "commit")}, ${n(week.prs.length, "pull request")}.`];
  /** @type {[string, WorkItem[]][]} */
  const groups = [
    ["Done", week.by.done],
    ["Committed, not pushed", week.by.committed],
    ["In progress", week.by.active],
    ["Pending (changes not committed)", week.by.pending],
  ];
  for (const [title, list] of groups) {
    if (!list.length) continue;
    out.push(`${title}:`, ...list.slice(0, 25).map(line));
    if (list.length > 25) out.push(`- … and ${list.length - 25} more`);
  }
  if (week.problems.length) {
    out.push("Recurring problems:");
    for (const p of week.problems.slice(0, 5)) out.push(`- ${p.count}x ${p.tool} in ${p.items} items: ${p.sample ?? "details not shared"}`);
  }
  return out.join("\n");
}

const LANG_NAME = { id: "Indonesian", en: "English" };

/** @param {Lang} lang */
export const weekInstructions = (lang) =>
  [
    "You write short weekly engineering reports for a software team.",
    "Use only the facts given. Do not invent work, names, numbers or reasons.",
    "Write four short parts: what got done, what is in progress or pending, recurring problems, and next steps (only for pending work or problems).",
    "Mention work items by their title. Plain text, short lines starting with '- ', no markdown headings.",
    `Write in ${LANG_NAME[lang]}.`,
  ].join(" ");

/** @param {Lang} lang */
export const itemContext = (lang) =>
  `Facts about one piece of software work done with an AI coding agent. Summarize what was done and where it stands, in ${LANG_NAME[lang]}. Use only these facts.`;

/**
 * Append a streamed chunk. Chrome first streamed the whole text so far,
 * later only the new part; accept both.
 * @param {string} acc @param {string} chunk
 */
export const appendChunk = (acc, chunk) => (acc && chunk.startsWith(acc) ? chunk : acc + chunk);

// --- the browser APIs ---------------------------------------------------------------

/** @returns {any} */
const api = (/** @type {"Summarizer" | "LanguageModel"} */ name) => /** @type {any} */ (globalThis)[name];

/**
 * What this browser can do for `lang`, without downloading anything.
 * `fallback`: the language is not supported, English is.
 * @param {Lang} lang
 * @returns {Promise<{ summarizer: Availability, prompt: Availability, lang: Lang, fallback: boolean }>}
 */
export async function availability(lang) {
  /** @param {Lang} l */
  const check = async (l) => {
    const S = api("Summarizer");
    const L = api("LanguageModel");
    const safe = async (/** @type {() => Promise<Availability>} */ f) => {
      try {
        return await f();
      } catch {
        return /** @type {Availability} */ ("unavailable");
      }
    };
    return {
      summarizer: S ? await safe(() => S.availability({ expectedInputLanguages: ["en", l], outputLanguage: l })) : "unavailable",
      prompt: L
        ? await safe(() =>
            L.availability({ expectedInputs: [{ type: "text", languages: ["en", l] }], expectedOutputs: [{ type: "text", languages: [l] }] }),
          )
        : "unavailable",
    };
  };
  const got = await check(lang);
  if (lang !== "en" && got.summarizer === "unavailable" && got.prompt === "unavailable") {
    const en = await check("en");
    if (en.summarizer !== "unavailable" || en.prompt !== "unavailable") return { ...en, lang: "en", fallback: true };
  }
  return { ...got, lang, fallback: false };
}

/**
 * @typedef {{ onProgress?: (loaded: number) => void, onText?: (text: string) => void, signal?: AbortSignal }} RunOptions
 */

/** @param {RunOptions} o */
const monitor = (o) => (/** @type {any} */ m) => {
  m.addEventListener("downloadprogress", (/** @type {any} */ e) => o.onProgress?.(typeof e.loaded === "number" ? e.loaded : 0));
};

/** @param {AsyncIterable<string> | ReadableStream<string>} stream @param {RunOptions} o */
async function collect(stream, o) {
  let text = "";
  for await (const chunk of /** @type {AsyncIterable<string>} */ (stream)) {
    text = appendChunk(text, chunk);
    o.onText?.(text);
  }
  return text.trim();
}

/**
 * Summarize one work item: the Summarizer API, else the Prompt API.
 * Must run from a click (the APIs need user activation to download).
 * @param {string} facts @param {Lang} lang @param {RunOptions} [o]
 */
export async function summarizeItem(facts, lang, o = {}) {
  const S = api("Summarizer");
  if (S) {
    try {
      const s = await S.create({
        type: "tldr",
        format: "plain-text",
        length: "short",
        sharedContext: itemContext(lang),
        expectedInputLanguages: ["en", lang],
        outputLanguage: lang,
        monitor: monitor(o),
        signal: o.signal,
      });
      try {
        return await collect(s.summarizeStreaming(facts, { signal: o.signal }), o);
      } finally {
        s.destroy?.();
      }
    } catch (e) {
      if (/** @type {any} */ (e)?.name === "AbortError" || !api("LanguageModel")) throw e;
    }
  }
  return prompt(`${itemContext(lang)} Two or three sentences.`, facts, lang, o);
}

/**
 * A weekly report from the facts. Facts too long for the model's context
 * are summarized per part first, then together (map-reduce).
 * @param {string} facts @param {Lang} lang @param {RunOptions} [o]
 */
export async function summarizeWeek(facts, lang, o = {}) {
  return prompt(weekInstructions(lang), facts, lang, o);
}

/** @param {string} instructions @param {string} facts @param {Lang} lang @param {RunOptions} o */
async function prompt(instructions, facts, lang, o) {
  const L = api("LanguageModel");
  if (!L) throw new Error("This browser has no on-device language model.");
  const options = {
    initialPrompts: [{ role: "system", content: instructions }],
    expectedInputs: [{ type: "text", languages: ["en", lang] }],
    expectedOutputs: [{ type: "text", languages: [lang] }],
    monitor: monitor(o),
    signal: o.signal,
  };
  const session = await L.create(options);
  try {
    const parts = await fit(session, facts);
    if (parts.length === 1) return await collect(session.promptStreaming(parts[0], { signal: o.signal }), o);
    // Map: notes per part (each in a fresh session, so context stays small).
    const notes = [];
    for (const part of parts) {
      const s = await L.create(options);
      try {
        notes.push(await s.prompt(`Short notes on these facts:\n${part}`, { signal: o.signal }));
      } finally {
        s.destroy?.();
      }
    }
    // Reduce.
    return await collect(session.promptStreaming(`Facts, as notes per part:\n${notes.join("\n")}`, { signal: o.signal }), o);
  } finally {
    session.destroy?.();
  }
}

/**
 * Split facts at line boundaries so each part fits the session's input
 * quota (with room for the answer).
 * @param {any} session @param {string} facts @returns {Promise<string[]>}
 */
export async function fit(session, facts) {
  const quota = typeof session.inputQuota === "number" ? session.inputQuota * 0.6 : Infinity;
  const measure = async (/** @type {string} */ t) =>
    typeof session.measureInputUsage === "function" ? await session.measureInputUsage(t) : t.length / 4;
  if ((await measure(facts)) <= quota) return [facts];
  const parts = [];
  let cur = "";
  for (const line of facts.split("\n")) {
    const next = cur ? `${cur}\n${line}` : line;
    if (cur && (await measure(next)) > quota) {
      parts.push(cur);
      cur = line;
    } else cur = next;
  }
  if (cur) parts.push(cur);
  return parts;
}
