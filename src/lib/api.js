// Client for the clioilc backend (see backend docs/api-v1.md).
import { PUBLIC_API_URL } from "$env/static/public";

export const API = PUBLIC_API_URL.replace(/\/$/, "");

/** Django's CSRF cookie; required on every non-GET request. */
export function csrfToken() {
  const row = document.cookie.split("; ").find((c) => c.startsWith("csrftoken="));
  return row ? decodeURIComponent(row.slice("csrftoken=".length)) : "";
}

export class ApiError extends Error {
  /** @param {number} status @param {any} body */
  constructor(status, body) {
    super(body?.error ?? body?.detail ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
    /** Stable machine-readable code, e.g. "expired_or_used". */
    this.code = body?.error ?? null;
  }
}

/**
 * @param {string} path  e.g. "/api/v1/usage/report/?by=day"
 * @param {{ method?: string, body?: unknown, signal?: AbortSignal }} [opts]
 */
export async function api(path, { method = "GET", body, signal } = {}) {
  /** @type {Record<string, string>} */
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRFToken"] = csrfToken();
  const res = await fetch(API + path, {
    method,
    headers,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
