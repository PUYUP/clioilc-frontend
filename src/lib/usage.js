// Usage series for the dashboard, from GET /api/v1/usage/report/.
import { api } from "./api.js";
import { isoDate, timeZone } from "./format.js";

export const METRICS = /** @type {const} */ ([
  { key: "cost_usd", label: "Cost (API equivalent)", format: "usd" },
  { key: "output_tokens", label: "Output tokens", format: "count" },
  { key: "input_tokens", label: "Input tokens", format: "count" },
  { key: "cache_write_tokens", label: "Cache write tokens", format: "count" },
  { key: "cache_read_tokens", label: "Cache read tokens", format: "count" },
  { key: "messages", label: "Messages", format: "count" },
  { key: "tools", label: "Tool calls", format: "count" },
]);

/** @typedef {typeof METRICS[number]["key"] | "errors" | "tool_errors" | "tool_ok" | "unpriced"} MetricKey */
/** @typedef {{ t: Date } & Record<MetricKey, number>} Point */

const FIELDS = /** @type {MetricKey[]} */ ([
  ...METRICS.map((m) => m.key),
  "errors",
  "tool_errors",
  "tool_ok",
  "unpriced",
]);

export const RANGES = /** @type {const} */ ([
  { key: "24h", label: "24 hours", hours: 24, unit: "hour" },
  { key: "7d", label: "7 days", days: 7, unit: "day" },
  { key: "30d", label: "30 days", days: 30, unit: "day" },
  { key: "90d", label: "90 days", days: 90, unit: "day" },
]);

/** @param {Date} d */
const startOfHour = (d) => {
  const x = new Date(d);
  x.setMinutes(0, 0, 0);
  return x;
};

/** @param {Date} d */
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/** @returns {Point} */
const empty = (/** @type {Date} */ t) => /** @type {Point} */ ({ t, ...Object.fromEntries(FIELDS.map((f) => [f, 0])) });

/**
 * Every hour/day in the window (zeros where nothing happened), oldest first.
 * @param {typeof RANGES[number]} range
 * @param {"hour" | "day"} unit
 * @param {AbortSignal} [signal]
 */
export async function loadSeries(range, unit, signal) {
  const now = new Date();
  const hours = "hours" in range ? range.hours : range.days * 24;
  // Window [from, to): ends after the current hour/day, so it is included.
  const to = unit === "hour" ? new Date(startOfHour(now).getTime() + 3600e3) : addDays(startOfDay(now), 1);
  const from =
    unit === "hour" ? new Date(to.getTime() - hours * 3600e3) : addDays(to, -Math.max(1, Math.round(hours / 24)));

  const params = new URLSearchParams({
    by: unit,
    start: isoDate(from),
    end: isoDate(new Date(to.getTime() - 1)),
    tz: timeZone,
  });
  const report = await api(`/api/v1/usage/report/?${params}`, { signal });

  /** @type {Map<number, Point>} */
  const byTime = new Map();
  for (const row of report.rows) {
    // hour keys: "2026-11-20T10:00:00+07:00"; day keys: "2026-11-20".
    const t = unit === "hour" ? new Date(row.key) : localDate(row.key);
    byTime.set(t.getTime(), /** @type {Point} */ ({ t, ...pick(row) }));
  }

  /** @type {Point[]} */
  const points = [];
  for (let t = from; t < to; t = unit === "hour" ? new Date(t.getTime() + 3600e3) : addDays(t, 1)) {
    points.push(byTime.get(t.getTime()) ?? empty(t));
  }
  return points;
}

/** @param {Point[]} points */
export function totals(points) {
  const out = empty(new Date());
  for (const p of points) for (const f of FIELDS) out[f] += p[f];
  return out;
}

/** @param {any} row */
function pick(row) {
  return Object.fromEntries(FIELDS.map((f) => [f, Number(row[f] ?? 0)]));
}

/** Local midnight of a YYYY-MM-DD date. @param {string} s */
function localDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Calendar-day step (DST safe). @param {Date} d @param {number} n */
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** @typedef {{ t: Date, ok: number, toolErrors: number, msgErrors: number }} Day */

/**
 * Last 53 weeks for the calendar heatmap: Monday 52 weeks before this
 * week's Monday, through today.
 * @param {AbortSignal} [signal]
 * @returns {Promise<Day[]>}
 */
export async function loadCalendar(signal) {
  const today = startOfDay(new Date());
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const start = addDays(monday, -52 * 7);
  const params = new URLSearchParams({ by: "day", start: isoDate(start), end: isoDate(today), tz: timeZone });
  const report = await api(`/api/v1/usage/report/?${params}`, { signal });
  const byDay = new Map(report.rows.map((/** @type {any} */ r) => [r.key, r]));
  const days = [];
  for (let t = start; t <= today; t = addDays(t, 1)) {
    const r = byDay.get(isoDate(t));
    days.push({ t, ok: r?.tool_ok ?? 0, toolErrors: r?.tool_errors ?? 0, msgErrors: r?.errors ?? 0 });
  }
  return days;
}
