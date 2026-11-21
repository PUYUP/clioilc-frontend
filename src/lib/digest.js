// Daily digest: what the agent worked on, per project, built from one
// day of activity (see activity.js). Deterministic, no AI: everything
// shown is read from the logs.

/** @typedef {import("./activity.js").Item} Item */

/**
 * @typedef {{
 *   projectId: string | null,
 *   name: string | undefined,
 *   sessions: number,
 *   activeMs: number,
 *   costUsd: number,
 *   prompts: string[],
 *   commits: { message: string, ts: Date, commit?: import("./commits.js").Commit }[],
 *   pushed: boolean,
 *   files: { path: string, edits: number }[],
 *   commands: number,
 *   toolErrors: number,
 *   messageErrors: number,
 *   failingTools: { name: string, count: number }[],
 *   first: Date,
 *   last: Date,
 * }} ProjectDigest
 * @typedef {{ projects: ProjectDigest[], totals: { costUsd: number, sessions: number, activeMs: number, prompts: number, commits: number, files: number, errors: number } }} DayDigest
 */

/** Gaps longer than this between two entries of a session count as idle. */
const IDLE_MS = 15 * 60 * 1000;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** @param {{ items: Item[], projects: Map<string, string>, messages: Map<string, any> }} day @returns {DayDigest} */
export function buildDigest(day) {
  /** @type {Map<string, Item[]>} */
  const byProject = new Map();
  for (const item of day.items) {
    if (item.kind === "unreadable") continue;
    const key = item.projectId ?? "";
    if (!byProject.has(key)) byProject.set(key, []);
    /** @type {Item[]} */ (byProject.get(key)).push(item);
  }

  const projects = [...byProject.entries()].map(([key, items]) =>
    projectDigest(key || null, day.projects.get(key), items, day.messages),
  );
  projects.sort((a, b) => b.costUsd - a.costUsd || b.last.getTime() - a.last.getTime());

  const totals = { costUsd: 0, sessions: 0, activeMs: 0, prompts: 0, commits: 0, files: 0, errors: 0 };
  for (const p of projects) {
    totals.costUsd += p.costUsd;
    totals.sessions += p.sessions;
    totals.activeMs += p.activeMs;
    totals.prompts += p.prompts.length;
    totals.commits += p.commits.length;
    totals.files += p.files.length;
    totals.errors += p.toolErrors + p.messageErrors;
  }
  return { projects, totals };
}

/**
 * @param {string | null} projectId @param {string | undefined} name
 * @param {Item[]} items sorted oldest first @param {Map<string, any>} messages
 * @returns {ProjectDigest}
 */
function projectDigest(projectId, name, items, messages) {
  /** @type {Map<string, Item[]>} */
  const sessions = new Map();
  for (const i of items) {
    const s = i.sessionId ?? "";
    if (!sessions.has(s)) sessions.set(s, []);
    /** @type {Item[]} */ (sessions.get(s)).push(i);
  }
  let activeMs = 0;
  for (const list of sessions.values()) {
    for (let k = 1; k < list.length; k++) {
      const gap = list[k].ts.getTime() - list[k - 1].ts.getTime();
      if (gap > 0 && gap <= IDLE_MS) activeMs += gap;
    }
  }

  let costUsd = 0;
  /** @type {Set<string>} */
  const counted = new Set();
  /** @type {Set<string>} */
  const failedMessages = new Set();
  for (const i of items) {
    if (!i.messageId || counted.has(i.messageId)) continue;
    counted.add(i.messageId);
    const m = messages.get(i.messageId);
    costUsd += m?.cost_usd ?? 0;
    if (m && m.status !== "ok") failedMessages.add(i.messageId);
  }

  /** @type {string[]} */
  const prompts = [];
  for (const i of items) {
    if (i.kind !== "prompt" || i.isSubagent) continue;
    const line = promptLine(i.text);
    if (line && !prompts.includes(line)) prompts.push(line);
  }

  /** @type {{ message: string, ts: Date, commit?: import("./commits.js").Commit }[]} */
  const commits = [];
  let pushed = false;
  /** @type {Map<string, number>} */
  const files = new Map();
  /** @type {Map<string, number>} */
  const failing = new Map();
  let commands = 0;
  let toolErrors = 0;
  for (const i of items) {
    if (i.kind !== "tool" || !i.tool) continue;
    const { name: tool, status } = i.tool;
    if (status === "error") {
      toolErrors++;
      failing.set(tool, (failing.get(tool) ?? 0) + 1);
      continue;
    }
    if (status !== "ok") continue;
    if (tool === "Bash") {
      commands++;
      // Commits the tracker found (hash, branch, size); else the message
      // read from the command, for data synced before it did.
      const found = i.tool.commits ?? [];
      for (const c of found) {
        if (!commits.some((x) => x.commit?.hash === c.hash)) commits.push({ message: c.subject, ts: i.ts, commit: c });
      }
      const msg = found.length ? null : commitMessage(i.text);
      if (msg && !commits.some((c) => c.message === msg)) commits.push({ message: msg, ts: i.ts });
      if (/\bgit\s+push\b/.test(i.text)) pushed = true;
    } else if (EDIT_TOOLS.has(tool) && isProjectFile(i.text)) {
      files.set(i.text, (files.get(i.text) ?? 0) + 1);
    }
  }

  const base = name ? projectRoot(name, [...files.keys()]) : null;
  return {
    projectId,
    name,
    sessions: sessions.size,
    activeMs,
    costUsd,
    prompts,
    commits,
    pushed,
    files: [...files.entries()]
      .map(([path, edits]) => ({ path: base && path.startsWith(base) ? path.slice(base.length) : path, edits }))
      .sort((a, b) => b.edits - a.edits || a.path.localeCompare(b.path)),
    commands,
    toolErrors,
    messageErrors: failedMessages.size,
    failingTools: [...failing.entries()].map(([n, count]) => ({ name: n, count })).sort((a, b) => b.count - a.count),
    first: items[0].ts,
    last: items[items.length - 1].ts,
  };
}

/** First meaningful line of a prompt; null for harness noise. @param {string} text */
export function promptLine(text) {
  const t = text.trim();
  if (
    !t ||
    t.startsWith("<") ||
    t.startsWith("[Request interrupted") ||
    t.startsWith("This session is being continued") ||
    t.startsWith("Caveat:")
  ) {
    return null;
  }
  const line = t.split("\n").find((l) => l.trim()) ?? "";
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

/**
 * Commit message from a Bash summary ("description: command"). Handles
 * `-m "..."`, `-m '...'` and heredocs (`-F - <<'EOF'`, `$(cat <<'EOF'`).
 * @param {string} summary
 */
export function commitMessage(summary) {
  const at = summary.search(/\bgit\s+(?:-C\s+\S+\s+)?commit\b/);
  if (at < 0) return null;
  const rest = summary.slice(at);
  // Heredoc first: it also covers -m "$(cat <<'EOF' ... EOF)".
  const heredoc = rest.match(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*)/);
  if (heredoc) return firstLine(heredoc[2]);
  const quoted = rest.match(/\s-[a-zA-Z]*m\s+(["'])((?:\\.|(?!\1).)*)\1/s);
  if (quoted) return firstLine(quoted[2].replace(/\\(["'\\])/g, "$1"));
  return null;
}

/** @param {string} s */
function firstLine(s) {
  const line = s.split("\n").map((l) => l.trim()).find(Boolean);
  if (!line || /^EOF\b/.test(line)) return null;
  return line.replace(/…\[truncated\]$/, "").slice(0, 200);
}

/**
 * Edits to the agent's own scratch space and to its memory/settings under
 * ~/.claude are not project changes.
 * @param {string} path
 */
export function isProjectFile(path) {
  return path.startsWith("/") && !/^\/(?:private\/)?tmp\//.test(path) && !path.includes("/.claude/");
}

/**
 * The project's folder, from its Claude name (the path with every
 * non-alphanumeric character turned into "-"), matched against a file
 * path. Returns "…/folder/" or null.
 * @param {string} name @param {string[]} paths
 */
export function projectRoot(name, paths) {
  for (const path of paths) {
    const parts = path.split("/");
    for (let n = parts.length - 1; n > 1; n--) {
      const dir = parts.slice(0, n).join("/");
      if (dir.replace(/[^A-Za-z0-9]/g, "-") === name) return `${dir}/`;
    }
  }
  return null;
}

/** "2h 05m", "35m", "<1m". @param {number} ms */
export function duration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return "<1m";
  const h = Math.floor(min / 60);
  return h ? `${h}h ${String(min % 60).padStart(2, "0")}m` : `${min}m`;
}
