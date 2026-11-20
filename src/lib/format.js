const locale = "en-US";

/** 1,284 / 12.9K / 4.2M: compact for tiles and axes. @param {number} n */
export function compact(n) {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** Full number with grouping, for tooltips and tables. @param {number} n */
export function full(n) {
  return new Intl.NumberFormat(locale).format(n);
}

/** $280.97; small amounts keep enough digits to not read as 0. @param {number} n */
export function usd(n) {
  const digits = n !== 0 && Math.abs(n) < 0.01 ? 4 : 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** $1.2K: for axis ticks. @param {number} n */
export function usdCompact(n) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 2 : 1,
  }).format(n);
}

/** "1 error", "48 errors". @param {number} n @param {string} word @param {string} [many] */
export function count(n, word, many = `${word}s`) {
  return `${full(n)} ${n === 1 ? word : many}`;
}

/** The browser's IANA time zone, sent to the API so days match the user's. */
export const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** YYYY-MM-DD of `date` in the browser's time zone. @param {Date} date */
export function isoDate(date) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return p.format(date);
}

/** @param {Date} d */
export const dayLabel = (d) =>
  new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short" }).format(d);

/** @param {Date} d */
export const hourLabel = (d) =>
  new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(d);

/** @param {Date} d */
export const longLabel = (d, /** @type {"hour"|"day"} */ unit) =>
  new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(unit === "hour" ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(d);
