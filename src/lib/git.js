// Git remotes in one comparable form, e.g. `github.com/acme/api`. Same rules
// as backend apps/workspaces/git.py and tracker link.rs (GIT_REMOTE_CASES).
// In end-to-end workspaces the browser normalizes before sealing the remote.

const SCP = /^(?:[^@/]+@)?([^:/]+):([^/].*)$/;
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d*)?\/(.+)$/i;
const RESULT = /^[a-z0-9.-]+(?:\/[^/\s]+)+$/;

/** @param {string} raw @returns {string | null} */
export function normalizeRemote(raw) {
  const s = raw.trim();
  const m = URL_RE.exec(s) ?? (s.includes("://") ? null : SCP.exec(s));
  if (!m) return null;
  let path = m[2].replace(/^\/+|\/+$/g, "");
  if (path.endsWith(".git")) path = path.slice(0, -4);
  const out = `${m[1]}/${path.replace(/^\/+|\/+$/g, "")}`.toLowerCase();
  return RESULT.test(out) ? out : null;
}
