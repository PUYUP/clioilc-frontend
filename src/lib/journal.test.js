import { describe, expect, it } from "vitest";
import { span, statusOf, toWorkItem, weekSummary } from "./journal.js";

const now = new Date("2026-11-28T12:00:00Z");
const hoursAgo = (/** @type {number} */ h) => new Date(now.getTime() - h * 3600e3).toISOString();

/** @param {Record<string, unknown>} d */
const item = (d, id = "w1") =>
  /** @type {import("./journal.js").WorkItem} */ (
    toWorkItem(id, { project_id: "p", state: "open", started: hoursAgo(200), last_activity: hoursAgo(1), ...d })
  );

describe("statusOf (same rules as the tracker)", () => {
  it("follows facts first, then time", () => {
    expect(statusOf(item({ edited: true, pending_edits: true, last_activity: hoursAgo(2) }), now)).toBe("active");
    expect(statusOf(item({ edited: true, pending_edits: true, last_activity: hoursAgo(30) }), now)).toBe("pending");
    expect(statusOf(item({ edited: false, last_activity: hoursAgo(30) }), now)).toBe("active");
    expect(statusOf(item({ edited: false, last_activity: hoursAgo(80) }), now)).toBe("abandoned");
    expect(statusOf(item({ committed: true, last_activity: hoursAgo(80) }), now)).toBe("committed");
    expect(statusOf(item({ committed: true, pushed: true }), now)).toBe("done");
    expect(statusOf(item({ prs: ["https://github.com/a/b/pull/1"] }), now)).toBe("done");
    expect(statusOf(item({ closed_by: "outside", last_activity: hoursAgo(99) }), now)).toBe("done");
    expect(statusOf(item({ closed_by: "discarded", edited: true }), now)).toBe("discarded");
  });

  it("a pending item becomes active again when work resumes", () => {
    // Ill for five days: pending meanwhile, in progress when resumed.
    const sick = item({ edited: true, pending_edits: true, last_activity: hoursAgo(5 * 24) });
    expect(statusOf(sick, now)).toBe("pending");
    const back = item({ edited: true, pending_edits: true, last_activity: hoursAgo(0.5), pauses: [{ from: hoursAgo(6 * 24), to: hoursAgo(1) }] });
    expect(statusOf(back, now)).toBe("active");
    expect(span(back.pauses[0].to.getTime() - back.pauses[0].from.getTime())).toBe("6 days");
  });
});

describe("toWorkItem", () => {
  it("drops deletion markers and malformed rows, and cleans fields", () => {
    expect(toWorkItem("x", { deleted: true })).toBeNull();
    expect(toWorkItem("x", { started: "nope" })).toBeNull();
    expect(toWorkItem("x", null)).toBeNull();
    const w = item({
      prs: ["https://github.com/a/b/pull/7", "javascript:alert(1)", "https://github.com/a/b/pull/new/x"],
      commits: [{ hash: "1234567", subject: "s" }, { hash: "bad!" }],
      errors: [{ fingerprint: "abc", tool: "Bash", count: 3, sample: "boom" }, { nope: 1 }],
      files: [{ path: "/r/a.rs", edits: 2 }, { edits: 1 }],
      active_ms: -5,
    });
    expect(w.prs).toEqual(["https://github.com/a/b/pull/7"]);
    expect(w.commits.map((c) => c.hash)).toEqual(["1234567"]);
    expect(w.errors).toHaveLength(1);
    expect(w.files).toEqual([{ path: "/r/a.rs", edits: 2 }]);
    expect(w.activeMs).toBe(0);
  });
});

describe("weekSummary", () => {
  it("groups the last 7 days by status and finds recurring problems", () => {
    const err = { fingerprint: "f1", tool: "Bash", count: 1, sample: "test failed" };
    const items = [
      item({ committed: true, pushed: true, commits: [{ hash: "1234567", subject: "a" }], errors: [err] }, "a"),
      item({ edited: true, pending_edits: true, last_activity: hoursAgo(30), errors: [err] }, "b"),
      item({ edited: true, last_activity: hoursAgo(10 * 24) }, "old"),
    ];
    const s = weekSummary(items, now);
    expect(s.items).toBe(2);
    expect(s.by.done.map((w) => w.id)).toEqual(["a"]);
    expect(s.by.pending.map((w) => w.id)).toEqual(["b"]);
    expect(s.commits).toBe(1);
    expect(s.problems).toEqual([{ fingerprint: "f1", tool: "Bash", count: 2, items: 2, sample: "test failed" }]);
  });
});
