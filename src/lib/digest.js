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
 *   turns: Turn[],
 *   commits: CommitLine[],
 *   earlierCommits: CommitLine[],
 *   pushed: boolean,
 *   uncommitted: { path: string, edits: number }[] | null,
 *   filesChanged: number,
 *   commands: number,
 *   toolErrors: number,
 *   messageErrors: number,
 *   failingTools: { name: string, count: number }[],
 *   first: Date,
 *   last: Date,
 * }} ProjectDigest
 * @typedef {{ message: string, ts: Date, commit?: import("./commits.js").Commit }} CommitLine
 * @typedef {{
 *   ts: Date, text: string,
 *   commits: CommitLine[],
 *   edited: number,
 *   committedLater: CommitLine | null,
 *   uncommitted: number | null,
 *   commands: number,
 *   failed: number,
 *   runs: Run[],
 * }} Turn
 * @typedef {{ ts: Date, tool: string, text: string, failed: boolean }} Run
 *   A command the turn ran (not one that made a commit), or any action that failed.
 *   One prompt and what the agent did for it, up to the next prompt of the
 *   same session. `committedLater`: a later commit that holds files edited
 *   here; `uncommitted`: files edited here that no commit holds (null when
 *   commit file lists are not known).
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
    totals.prompts += p.turns.length;
    totals.commits += p.commits.length;
    totals.files += p.filesChanged;
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

  // Turns: each human prompt opens one in its session; the actions after it
  // (commits, edits, commands) belong to it until the session's next prompt.
  /** @type {{ ts: Date, text: string, commits: CommitLine[], edits: Map<string, number>, commands: number, failed: number, runs: Run[] }[]} */
  const turns = [];
  /** Session -> index of its current turn. @type {Map<string, number>} */
  const current = new Map();
  /** Commits whose prompt is not in this day (asked before midnight). @type {CommitLine[]} */
  const earlierCommits = [];
  const turnOf = (/** @type {Item} */ i) => {
    const k = current.get(i.sessionId ?? "");
    return k === undefined ? null : turns[k];
  };

  /** @type {CommitLine[]} */
  const commits = [];
  let pushed = false;
  /** Last edit time per file (ms). @type {Map<string, number>} */
  const lastEdit = new Map();
  /** @type {Map<string, number>} */
  const files = new Map();
  /** @type {Map<string, number>} */
  const failing = new Map();
  let commands = 0;
  let toolErrors = 0;
  // Data from a tracker that finds commits itself: trust only those. Reading
  // a message out of a command matches text that merely mentions
  // `git commit` (a script, a test), so it is only a fallback for older data.
  const trackerCommits = items.some((i) => (i.tool?.commits?.length ?? 0) > 0);
  for (const i of items) {
    if (i.kind === "prompt" && !i.isSubagent) {
      const line = promptLine(i.text);
      if (line) {
        turns.push({ ts: i.ts, text: line, commits: [], edits: new Map(), commands: 0, failed: 0, runs: [] });
        current.set(i.sessionId ?? "", turns.length - 1);
      }
      continue;
    }
    if (i.kind !== "tool" || !i.tool) continue;
    const turn = turnOf(i);
    /** @param {CommitLine} line */
    const addCommit = (line) => {
      commits.push(line);
      (turn ? turn.commits : earlierCommits).push(line);
    };
    const { name: tool, status } = i.tool;
    if (status === "error") {
      toolErrors++;
      if (turn) {
        turn.failed++;
        turn.runs.push({ ts: i.ts, tool, text: runText(i.text), failed: true });
      }
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
        if (!commits.some((x) => x.commit?.hash === c.hash)) addCommit({ message: c.subject, ts: i.ts, commit: c });
      }
      const msg = found.length || trackerCommits ? null : commitMessage(i.text);
      if (msg && !commits.some((c) => c.message === msg)) addCommit({ message: msg, ts: i.ts });
      if (!found.length && !msg && turn) {
        turn.commands++;
        turn.runs.push({ ts: i.ts, tool, text: runText(i.text), failed: false });
      }
      if (/\bgit\s+push\b/.test(i.text)) pushed = true;
    } else if (EDIT_TOOLS.has(tool) && isProjectFile(i.text)) {
      files.set(i.text, (files.get(i.text) ?? 0) + 1);
      lastEdit.set(i.text, i.ts.getTime());
      if (turn) turn.edits.set(i.text, i.ts.getTime());
    }
  }

  const base = name ? projectRoot(name, [...files.keys()]) : null;
  const shown = (/** @type {string} */ path) => (base && path.startsWith(base) ? path.slice(base.length) : path);

  // What reached a commit that day, as absolute paths (root + relative
  // path), with the time of the last commit that had it.
  /** @type {Map<string, number>} */
  const committed = new Map();
  // Without each commit's file list (older data, or a commit the tracker
  // could not find), what is left uncommitted cannot be told: say nothing.
  let known = true;
  for (const c of commits) {
    if (!c.commit?.changes?.length || !c.commit.root) {
      known = false;
      continue;
    }
    for (const f of c.commit.changes) {
      const key = `${c.commit.root}/${f.path}`;
      committed.set(key, Math.max(committed.get(key) ?? 0, c.ts.getTime()));
    }
  }
  const uncommitted = known
    ? [...files.entries()]
        // Never committed, or edited again after its last commit.
        .filter(([path]) => (lastEdit.get(path) ?? 0) > (committed.get(path) ?? -1))
        .map(([path, edits]) => ({ path: shown(path), edits }))
        .sort((a, b) => b.edits - a.edits || a.path.localeCompare(b.path))
    : null;
  const isUncommitted = (/** @type {string} */ path) => (lastEdit.get(path) ?? 0) > (committed.get(path) ?? -1);
  /** The first commit after `ts` that holds one of `paths`. @param {Iterable<string>} paths @param {number} ts */
  const firstCommitOf = (paths, ts) => {
    const want = new Set(paths);
    return (
      commits.find(
        (c) => c.ts.getTime() >= ts && c.commit?.root && c.commit.changes.some((f) => want.has(`${c.commit?.root}/${f.path}`)),
      ) ?? null
    );
  };
  /** @type {Turn[]} */
  const turnsOut = turns.map((t) => ({
    ts: t.ts,
    text: t.text,
    commits: [...t.commits].reverse(),
    edited: t.edits.size,
    committedLater: !t.commits.length && t.edits.size && known ? firstCommitOf(t.edits.keys(), t.ts.getTime()) : null,
    uncommitted: known ? [...t.edits.keys()].filter(isUncommitted).length : null,
    commands: t.commands,
    failed: t.failed,
    runs: t.runs,
  }));

  return {
    projectId,
    name,
    sessions: sessions.size,
    activeMs,
    costUsd,
    // Newest first; items arrive oldest first, commits of one command in the
    // order they were made, so reversing keeps that order newest first too.
    turns: turnsOut.reverse(),
    commits: [...commits].reverse(),
    earlierCommits: [...earlierCommits].reverse(),
    pushed,
    uncommitted,
    // Files changed: those in the day's commits plus edits not committed; the
    // edited files when commit file lists are not known.
    filesChanged: known
      ? new Set([...committed.keys(), ...[...files.keys()].filter((f) => (lastEdit.get(f) ?? 0) > (committed.get(f) ?? -1))]).size
      : files.size,
    commands,
    toolErrors,
    messageErrors: failedMessages.size,
    failingTools: [...failing.entries()].map(([n, count]) => ({ name: n, count })).sort((a, b) => b.count - a.count),
    first: items[0].ts,
    last: items[items.length - 1].ts,
  };
}

/** A command's summary as stored ("Run tests: cargo test"), whole. @param {string} text */
const runText = (text) => text.trim();

/** First meaningful line of a prompt; null for harness noise. @param {string} text */
export function promptLine(text) {
  const t = text.trim();
  if (
    !t ||
    t.startsWith("[Request interrupted") ||
    t.startsWith("This session is being continued") ||
    t.startsWith("Caveat:")
  ) {
    return null;
  }
  const firstLine = (/** @type {string} */ s) =>
    s
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !/^<.*>$/.test(l));
  // The user's own words first, outside pasted blocks (`<pasted_content …>`).
  let line = firstLine(t.replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, "\n"));
  if (!line) {
    // Only pasted text: its first line with a word in it, marked as pasted.
    const pasted = /<pasted_content[^>]*>([\s\S]*?)<\/pasted_content/.exec(t)?.[1] ?? "";
    const first = pasted
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /\p{L}{3,}/u.test(l));
    if (first) line = `Pasted: ${first}`;
  }
  if (!line) return null; // only tags: a command or harness message, not a question
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
