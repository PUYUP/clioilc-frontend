import { afterEach, describe, expect, it } from "vitest";
import { appendChunk, availability, fit, itemFacts, summarizeItem, summarizeWeek, weekFacts } from "./ai.js";
import { toWorkItem, weekSummary } from "./journal.js";

const now = new Date("2026-11-28T12:00:00Z");
const hoursAgo = (/** @type {number} */ h) => new Date(now.getTime() - h * 3600e3).toISOString();
/** @param {Record<string, unknown>} d */
const item = (d, id = "w1") =>
  /** @type {import("./journal.js").WorkItem} */ (
    toWorkItem(id, { project_id: "p", state: "open", started: hoursAgo(200), last_activity: hoursAgo(1), ...d })
  );

const g = /** @type {any} */ (globalThis);
afterEach(() => {
  delete g.Summarizer;
  delete g.LanguageModel;
});

describe("facts", () => {
  it("describe an item in short labelled lines, from facts only", () => {
    const w = item({
      title: "retry payments",
      branch: "feature/retries",
      edited: true,
      pending_edits: true,
      last_activity: hoursAgo(30),
      prompts: 7,
      active_ms: 45 * 60000,
      commits: [{ hash: "3c514b0" + "a".repeat(33), subject: "Add retries", files: 1, insertions: 12, deletions: 3 }],
      files: [{ path: "/w/pay/src/retry.rs", edits: 6 }],
      errors: [{ fingerprint: "f", tool: "Bash", count: 3, sample: "TimeoutError: x" }],
      pauses: [{ from: hoursAgo(200), to: hoursAgo(56) }],
    });
    const f = itemFacts(w, "pay", now);
    expect(f).toContain("Work item: retry payments");
    expect(f).toContain("Project: pay, branch feature/retries");
    expect(f).toContain("Status: Pending (changes not committed, no activity since");
    expect(f).toContain("about 45 minutes active");
    expect(f).toContain("Paused: 6 days");
    expect(f).toContain("3c514b0 Add retries (+12 -3)");
    expect(f).toContain("src/retry.rs");
    expect(f).toContain("Repeated error (3x, Bash): TimeoutError: x");
  });

  it("describe a week without measuring people", () => {
    const s = weekSummary([item({ committed: true, pushed: true, title: "A", commits: [{ hash: "1234567", subject: "a" }] }), item({ title: "B", edited: true, last_activity: hoursAgo(30) }, "b")], now);
    const f = weekFacts(s, () => "pay");
    expect(f).toContain("Done:\n- A (pay, 1 commit)");
    expect(f).toContain("Pending (changes not committed):\n- B (pay)");
    expect(f).not.toMatch(/hour|idle|minutes/);
  });
});

describe("streaming and context", () => {
  it("accepts cumulative and delta chunks", () => {
    expect(["Hel", "lo"].reduce(appendChunk, "")).toBe("Hello");
    expect(["Hel", "Hello", "Hello!"].reduce(appendChunk, "")).toBe("Hello!");
  });

  it("splits facts that do not fit the input quota at line boundaries", async () => {
    const session = { inputQuota: 100, measureInputUsage: async (/** @type {string} */ t) => t.length };
    const facts = Array.from({ length: 10 }, (_, i) => `line ${i} ${"x".repeat(20)}`).join("\n");
    const parts = await fit(session, facts);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join("\n")).toBe(facts);
    expect(parts.every((p) => p.length <= 60)).toBe(true);
    expect(await fit(session, "short")).toEqual(["short"]);
  });
});

/** An async iterable of chunks. @param {string[]} chunks */
async function* stream(chunks) {
  for (const c of chunks) yield c;
}

describe("browser APIs (mocked)", () => {
  it("reports availability and falls back to English when a language is not supported", async () => {
    expect(await availability("id")).toMatchObject({ summarizer: "unavailable", prompt: "unavailable" });
    g.Summarizer = { availability: async (/** @type {any} */ o) => (o.outputLanguage === "id" ? "unavailable" : "downloadable") };
    g.LanguageModel = { availability: async (/** @type {any} */ o) => (o.expectedOutputs[0].languages[0] === "id" ? "unavailable" : "available") };
    expect(await availability("id")).toEqual({ summarizer: "downloadable", prompt: "available", lang: "en", fallback: true });
  });

  it("summarizes an item with the Summarizer, streaming, and reports download progress", async () => {
    /** @type {any[]} */ const created = [];
    g.Summarizer = {
      create: async (/** @type {any} */ o) => {
        created.push(o);
        o.monitor({ addEventListener: (/** @type {string} */ _e, /** @type {any} */ f) => f({ loaded: 0.5 }) });
        return { summarizeStreaming: () => stream(["Retries ", "added."]), destroy() {} };
      },
    };
    /** @type {number[]} */ const progress = [];
    /** @type {string[]} */ const texts = [];
    const out = await summarizeItem("facts", "id", { onProgress: (p) => progress.push(p), onText: (t) => texts.push(t) });
    expect(out).toBe("Retries added.");
    expect(texts).toEqual(["Retries ", "Retries added."]);
    expect(progress).toEqual([0.5]);
    expect(created[0]).toMatchObject({ type: "tldr", outputLanguage: "id" });
  });

  it("writes the week report with the Prompt API, map-reducing long facts", async () => {
    /** @type {string[]} */ const prompts = [];
    g.LanguageModel = {
      create: async () => ({
        inputQuota: 50,
        measureInputUsage: async (/** @type {string} */ t) => t.length,
        prompt: async (/** @type {string} */ t) => {
          prompts.push(t);
          return "note";
        },
        promptStreaming: (/** @type {string} */ t) => {
          prompts.push(t);
          return stream(["- Done: A"]);
        },
        destroy() {},
      }),
    };
    const facts = Array.from({ length: 6 }, (_, i) => `- item ${i} ${"y".repeat(10)}`).join("\n");
    expect(await summarizeWeek(facts, "en")).toBe("- Done: A");
    expect(prompts.filter((p) => p.startsWith("Short notes")).length).toBeGreaterThan(1);
    expect(prompts.at(-1)).toContain("notes per part");
  });
});
