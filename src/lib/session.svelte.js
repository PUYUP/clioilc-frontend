// Login state from django-allauth headless (browser client). See backend
// docs/auth.md. The session cookie lives on the API host; we only read it
// through /_allauth/browser/v1/auth/session.
import { API, csrfToken } from "./api.js";

/** @typedef {{ id: number, username: string, email?: string, display: string }} User */

export const session = $state({
  /** True until the first check finishes. */
  loading: true,
  /** @type {User | null} */
  user: null,
  /** Set when the API cannot be reached at all. */
  /** @type {string | null} */
  error: null,
});

const SESSION = `${API}/_allauth/browser/v1/auth/session`;

/** Also sets the `csrftoken` cookie used by later requests. */
export async function refreshSession() {
  try {
    const res = await fetch(SESSION, { credentials: "include" });
    const body = await res.json().catch(() => null);
    session.user = res.ok ? body.data.user : null;
    session.error = null;
  } catch {
    session.user = null;
    session.error = `Tidak bisa menghubungi API di ${API}`;
  } finally {
    session.loading = false;
  }
}

/**
 * Leaves the page: a plain form POST, because the browser must follow the
 * redirect to GitHub. `next` is where to land after login.
 * @param {string} [next]
 */
export function loginWithGitHub(next = "/") {
  const callback = new URL("/auth/callback", location.origin);
  callback.searchParams.set("next", next);
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `${API}/_allauth/browser/v1/auth/provider/redirect`;
  /** @type {Record<string, string>} */
  const fields = {
    provider: "github",
    process: "login",
    callback_url: callback.href,
    csrfmiddlewaretoken: csrfToken(),
  };
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
}

export async function logout() {
  // allauth answers a successful logout with 401 (no longer authenticated).
  await fetch(SESSION, {
    method: "DELETE",
    credentials: "include",
    headers: { "X-CSRFToken": csrfToken() },
  });
  session.user = null;
}

/** Only allow same-app paths as post-login targets. @param {string | null} next */
export function safeNext(next) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
