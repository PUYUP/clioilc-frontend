// Engineering work journal (backend docs/journal.md): work items built by
// the tracker from facts, loaded from GET /api/v1/usage/journal/. Statuses
// that depend on the time of viewing are worked out here, with the same
// rules as the tracker (clioilc_core::journal::status), so they never go
// stale while a laptop is off.
import { api } from "./api.js";
import { commitsOf } from "./commits.js";
import { decryptRecord } from "./e2e.js";
import { timeZone } from "./format.js";
import { withScope } from "./scope.svelte.js";
import { openTeamActivity } from "./team.svelte.js";
import { LockedError } from "./vault.svelte.js";

export { LockedError };

const HOUR = 3600 * 1000;
/** Edited, not committed, idle this long: pending. */
export const PENDING_AFTER = 24 * HOUR;
/** Neither edited nor committed, idle this long: abandoned. */
export const ABANDONED_AFTER = 72 * HOUR;

/**
 * @typedef {"active" | "pending" | "committed" | "done" | "abandoned" | "discarded"} Status
 * @typedef {{ from: Date, to: Date }} Pause
 * @typedef {{ path: string, edits: number }} FileEdits
 * @typedef {{ fingerprint: string, tool: string, count: number, sample: string | null }} ErrorGroup
 * @typedef {{
 *   id: string, user?: string, projectId: string | null,
 *   title: string | null, branch: string | null,
 *   state: "open" | "closed", closedBy: string | null,
 *   edited: boolean, pendingEdits: boolean, committed: boolean, pushed: boolean,
 *   started: Date, lastActivity: Date, pauses: Pause[],
 *   sessions: number, prompts: number, activeMs: number,
 *   spans: { session_id: string, from: string, to: string }[],
 *   commits: import("./commits.js").Commit[], prs: string[],
 *   files: FileEdits[], errors: ErrorGroup[],
 * }} WorkItem
 */

/** @type {Record<Status, string>} */
export const STATUS_LABEL = {
  active: "In progress",
  pending: "Pending",
  committed: "Committed",
  done: "Done",
  abandoned: "Abandoned",
  discarded: "Discarded",
};
/** @type {Status[]} */
export const STATUSES = ["active", "pending", "committed", "done", "abandoned", "discarded"];

/** @param {WorkItem} w @param {Date} [now] @returns {Status} */
export function statusOf(w, now = new Date()) {
  if (w.closedBy === "discarded") return "discarded";
  if (w.closedBy === "outside" || w.closedBy === "pr" || w.pushed || w.prs.length) return "done";
  if (w.committed && !w.pendingEdits) return "committed";
  const idle = now.getTime() - w.lastActivity.getTime();
  if (w.edited) return idle < PENDING_AFTER ? "active" : "pending";
  return idle < ABANDONED_AFTER ? "active" : "abandoned";
}

/** Errors seen three times or more in one item. @param {WorkItem} w */
export const repeatedErrors = (w) => w.errors.filter((e) => e.count >= 3);

const date = (/** @type {unknown} */ v) => {
  const d = new Date(typeof v === "string" ? v : NaN);
  return Number.isNaN(d.getTime()) ? null : d;
};
const str = (/** @type {unknown} */ v) => (typeof v === "string" && v ? v : null);
const num = (/** @type {unknown} */ v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/**
 * A decrypted record's data -> WorkItem, or null for deletion markers and
 * malformed rows (team data comes from other people's machines).
 * @param {string} id @param {any} d @param {string} [user]
 * @returns {WorkItem | null}
 */
export function toWorkItem(id, d, user) {
  if (!d || typeof d !== "object" || d.deleted) return null;
  const started = date(d.started);
  const lastActivity = date(d.last_activity);
  if (!started || !lastActivity) return null;
  const list = (/** @type {unknown} */ v) => (Array.isArray(v) ? v : []);
  return {
    id,
    user,
    projectId: str(d.project_id),
    title: str(d.title),
    branch: str(d.branch),
    state: d.state === "closed" ? "closed" : "open",
    closedBy: str(d.closed_by),
    edited: d.edited === true,
    pendingEdits: d.pending_edits === true,
    committed: d.committed === true,
    pushed: d.pushed === true,
    started,
    lastActivity,
    pauses: list(d.pauses)
      .map((p) => ({ from: date(p?.from), to: date(p?.to) }))
      .filter((p) => p.from && p.to)
      .map((p) => /** @type {Pause} */ (p)),
    sessions: num(d.sessions),
    prompts: num(d.prompts),
    activeMs: num(d.active_ms),
    spans: list(d.spans).filter((s) => s && typeof s.session_id === "string" && typeof s.from === "string" && typeof s.to === "string"),
    commits: commitsOf(d.commits),
    prs: list(d.prs).filter((u) => typeof u === "string" && /^https:\/\/[^\s]+\/(pull|-\/merge_requests|pull-requests)\/\d+$/.test(u)),
    files: list(d.files)
      .filter((f) => f && typeof f.path === "string")
      .map((f) => ({ path: f.path, edits: num(f.edits) })),
    errors: list(d.errors)
      .filter((e) => e && typeof e.fingerprint === "string")
      .map((e) => ({ fingerprint: e.fingerprint, tool: str(e.tool) ?? "tool", count: num(e.count), sample: str(e.sample) })),
  };
}

/**
 * Work items whose last activity is on or after `since` (YYYY-MM-DD, local),
 * newest first, with project names by id.
 * @param {string} since @param {CryptoKey | null} dataKey @param {AbortSignal} [signal]
 */
export async function loadJournal(since, dataKey, signal) {
  const params = withScope(new URLSearchParams({ since, tz: timeZone }));
  const res = await api(`/api/v1/usage/journal/?${params}`, { signal });
  /** @type {Map<string, string>} */
  const projects = new Map();
  /** @type {WorkItem[]} */
  const items = [];
  /** @type {string[]} */
  let notes = [];

  if (res.workspace && res.enc_mode === "e2e") {
    if (!dataKey) throw new LockedError();
    const opened = await openTeamActivity(res);
    notes = opened.notes;
    for (const r of opened.rows) {
      if (r.kind === "project") projects.set(r.id, r.data?.name ?? r.data?.slug ?? r.id);
      else if (r.kind === "work_item" && r.data) {
        const w = toWorkItem(r.id, r.data, /** @type {any} */ (r).user);
        if (w) items.push(w);
      }
    }
  } else {
    if (res.enc_mode === "e2e" && !dataKey && res.private.some((/** @type {any} */ p) => !p.data)) throw new LockedError();
    for (const p of res.private) {
      let data = p.data;
      if (!data && !p.error && dataKey) {
        try {
          data = await decryptRecord(dataKey, p);
        } catch {
          data = null;
        }
      }
      if (p.kind === "project" && data) projects.set(p.id, data.name ?? data.slug ?? p.id);
      else if (p.kind === "work_item") {
        const w = toWorkItem(p.id, data, p.user);
        if (w) items.push(w);
      }
    }
  }
  items.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  return { items, projects, team: !!res.workspace, notes };
}

/**
 * Cost of each item from the server's per-message costs (by session span).
 * @param {WorkItem[]} items @param {AbortSignal} [signal]
 * @returns {Promise<Map<string, number | null>>}
 */
export async function loadCosts(items, signal) {
  /** @type {Map<string, number | null>} */
  const out = new Map();
  for (let i = 0; i < items.length; i += 200) {
    const chunk = items.slice(i, i + 200);
    const body = { items: Object.fromEntries(chunk.map((w) => [w.id, w.spans.slice(0, 200)])) };
    const params = withScope(new URLSearchParams());
    const res = await api(`/api/v1/usage/span-costs/?${params}`, { method: "POST", body, signal });
    for (const [id, cost] of Object.entries(res.costs ?? {})) out.set(id, typeof cost === "number" ? cost : null);
  }
  return out;
}

/**
 * The week at a glance (for leads and PMs): what got done, what waits, and
 * what keeps failing, over items active in the last 7 days.
 * @param {WorkItem[]} items @param {Date} [now]
 */
export function weekSummary(items, now = new Date()) {
  const since = now.getTime() - 7 * 24 * HOUR;
  const recent = items.filter((w) => w.lastActivity.getTime() >= since);
  /** @type {Record<Status, WorkItem[]>} */
  const by = { active: [], pending: [], committed: [], done: [], abandoned: [], discarded: [] };
  for (const w of recent) by[statusOf(w, now)].push(w);
  /** @type {Map<string, { fingerprint: string, tool: string, count: number, items: number, sample: string | null }>} */
  const problems = new Map();
  for (const w of recent) {
    for (const e of w.errors) {
      const p = problems.get(e.fingerprint) ?? { fingerprint: e.fingerprint, tool: e.tool, count: 0, items: 0, sample: e.sample };
      p.count += e.count;
      p.items += 1;
      p.sample ??= e.sample;
      problems.set(e.fingerprint, p);
    }
  }
  return {
    items: recent.length,
    by,
    commits: recent.reduce((n, w) => n + w.commits.length, 0),
    prs: recent.flatMap((w) => w.prs),
    // Recurring: in more than one item, or three times or more in one.
    problems: [...problems.values()].filter((p) => p.items > 1 || p.count >= 3).sort((a, b) => b.count - a.count),
  };
}

/** "5 days", "2 hours". @param {number} ms */
export function span(ms) {
  const h = Math.round(ms / HOUR);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}
