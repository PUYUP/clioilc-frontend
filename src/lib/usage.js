// Usage series for the dashboard, from GET /api/v1/usage/report/.
import { api } from "./api.js";
import { isoDate, timeZone } from "./format.js";

export const METRICS = /** @type {const} */ ([
  { key: "cost_usd", label: "Biaya (setara API)", format: "usd" },
  { key: "output_tokens", label: "Token output", format: "count" },
  { key: "input_tokens", label: "Token input", format: "count" },
  { key: "cache_write_tokens", label: "Token cache write", format: "count" },
  { key: "cache_read_tokens", label: "Token cache read", format: "count" },
  { key: "messages", label: "Pesan", format: "count" },
  { key: "tools", label: "Panggilan tool", format: "count" },
]);

/** @typedef {typeof METRICS[number]["key"] | "errors" | "tool_errors" | "unpriced"} MetricKey */
/** @typedef {{ t: Date } & Record<MetricKey, number>} Point */

const FIELDS = /** @type {MetricKey[]} */ ([...METRICS.map((m) => m.key), "errors", "tool_errors", "unpriced"]);

export const RANGES = /** @type {const} */ ([
  { key: "24h", label: "24 jam", hours: 24, unit: "hour" },
  { key: "7d", label: "7 hari", days: 7, unit: "day" },
  { key: "30d", label: "30 hari", days: 30, unit: "day" },
  { key: "90d", label: "90 hari", days: 90, unit: "day" },
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
