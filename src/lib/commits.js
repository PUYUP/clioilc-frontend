// Git commits made by an agent's tool call (found by the tracker on the
// user's machine; backend docs/api-v1.md, tool_call data `commits`).
// Team rows come from other people's machines, so the shape is checked here
// and only known hosts get a link.

/** @typedef {{ hash: string, branch: string | null, subject: string, remote: string | null, files?: number, insertions?: number, deletions?: number }} Commit */

const HASH = /^[0-9a-f]{7,64}$/;
const REMOTE = /^[a-z0-9.-]+(\/[^\s/]+)+$/;

/** @param {unknown} raw @returns {Commit[]} */
export function commitsOf(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {Commit[]} */
  const out = [];
  for (const c of raw.slice(0, 20)) {
    if (!c || typeof c !== "object" || typeof c.hash !== "string" || !HASH.test(c.hash)) continue;
    out.push({
      hash: c.hash,
      branch: typeof c.branch === "string" && c.branch ? c.branch : null,
      subject: typeof c.subject === "string" ? c.subject : "",
      remote: typeof c.remote === "string" && REMOTE.test(c.remote) ? c.remote : null,
      ...stats(c),
    });
  }
  return out;
}

/** Size of the change, when the tracker found the repository. @param {any} c */
function stats(c) {
  const n = (/** @type {unknown} */ v) => typeof v === "number" && Number.isInteger(v) && v >= 0;
  return n(c.files) && n(c.insertions) && n(c.deletions) ? { files: c.files, insertions: c.insertions, deletions: c.deletions } : {};
}

/** Commit page on a known forge, from a normalized remote (`github.com/acme/api`). */
const FORGES = /** @type {Record<string, (repo: string, hash: string) => string>} */ ({
  "github.com": (repo, hash) => `https://github.com/${repo}/commit/${hash}`,
  "gitlab.com": (repo, hash) => `https://gitlab.com/${repo}/-/commit/${hash}`,
  "bitbucket.org": (repo, hash) => `https://bitbucket.org/${repo}/commits/${hash}`,
  "codeberg.org": (repo, hash) => `https://codeberg.org/${repo}/commit/${hash}`,
});

/** @param {Commit} c @returns {string | null} */
export function commitUrl(c) {
  if (!c.remote || c.hash.length < 40) return null; // a short hash may not be unique
  const [host, ...path] = c.remote.split("/");
  const make = FORGES[host];
  return make ? make(path.map(encodeURIComponent).join("/"), c.hash) : null;
}

/** @param {string} hash */
export const shortHash = (hash) => hash.slice(0, 7);
