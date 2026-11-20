// Activity timeline for one day, from GET /api/v1/usage/activity/
// (see backend docs/api-v1.md -> "Menyusun timeline").
import { api } from "./api.js";
import { decryptRecord } from "./e2e.js";
import { timeZone } from "./format.js";
import { withScope } from "./scope.svelte.js";
import { openTeamActivity } from "./team.svelte.js";

/**
 * @typedef {"prompt" | "text" | "thinking" | "tool" | "unreadable"} Kind
 * @typedef {{
 *   id: string, ts: Date, kind: Kind, text: string,
 *   projectId: string | null, sessionId: string | null, isSubagent: boolean,
 *   status: "ok" | "error" | null, errorKind?: string,
 *   messageId?: string, model?: string, costUsd?: number | null,
 *   user?: string,
 *   tool?: { name: string, status: string | null, error: string | null },
 * }} Item
 * @typedef {{ key: string, projectId: string | null, sessionId: string | null, user?: string, items: Item[], costUsd: number }} Group
 */

import { LockedError } from "./vault.svelte.js";

export { LockedError };

/**
 * @param {string} date  YYYY-MM-DD in the browser's time zone
 * @param {Uint8Array<ArrayBuffer> | null} dataKey  E2E data key, if unlocked
 * @param {AbortSignal} [signal]
 */
export async function loadActivity(date, dataKey, signal) {
  const params = withScope(new URLSearchParams({ date, tz: timeZone }));
  const res = await api(`/api/v1/usage/activity/?${params}`, { signal });
  if (res.workspace && res.enc_mode === "e2e") {
    // E2E team workspace: names and records are sealed with team keys.
    if (!dataKey) throw new LockedError();
    const { rows, notes } = await openTeamActivity(res);
    return { ...build(res.messages, res.tool_calls, rows), team: true, notes };
  }
  if (res.enc_mode === "e2e" && !dataKey && res.private.length) throw new LockedError();

  const privateRows = await Promise.all(
    res.private.map(async (/** @type {any} */ p) => {
      if (p.data || p.error) return p;
      try {
        return { ...p, data: await decryptRecord(/** @type {Uint8Array<ArrayBuffer>} */ (dataKey), p) };
      } catch {
        return { ...p, error: "decrypt_failed" };
      }
    }),
  );
  return { ...build(res.messages, res.tool_calls, privateRows), team: !!res.workspace, notes: /** @type {string[]} */ ([]) };
}

/** @param {any[]} messages @param {any[]} toolCalls @param {any[]} privateRows */
function build(messages, toolCalls, privateRows) {
  const msgById = new Map(messages.map((m) => [m.id, m]));
  const toolById = new Map(toolCalls.map((t) => [t.id, t]));
  /** @type {Map<string, string>} */
  const projects = new Map();
  for (const p of privateRows) if (p.kind === "project" && p.data) projects.set(p.id, p.data.name);

  /** @type {Item[]} */
  const items = [];
  for (const p of privateRows) {
    if (p.kind === "project" || !p.ts) continue;
    const ts = new Date(p.ts);
    if (p.error) {
      items.push({ id: p.id, ts, kind: "unreadable", text: "", projectId: null, sessionId: null, isSubagent: false, status: null, user: p.user });
      continue;
    }
    const d = p.data;
    if (p.kind === "prompt") {
      items.push({
        id: p.id, ts, kind: "prompt", text: d.text.trim(),
        projectId: d.project_id, sessionId: d.session_id, isSubagent: d.is_subagent, status: null, user: p.user,
      });
    } else if (p.kind === "block") {
      const m = msgById.get(d.message_id);
      items.push({
        id: p.id, ts, kind: d.kind === "thinking" ? "thinking" : "text", text: d.text.trim(),
        projectId: m?.project_id ?? null, sessionId: m?.session_id ?? null, isSubagent: !!m?.is_subagent,
        messageId: d.message_id, model: m?.model, costUsd: m?.cost_usd ?? null,
        // A reply's status is its API message's: "ok" or an error kind.
        status: m ? (m.status === "ok" ? "ok" : "error") : null,
        errorKind: m && m.status !== "ok" ? m.status : undefined,
        user: p.user,
      });
    } else if (p.kind === "tool_call") {
      const t = toolById.get(p.id);
      const m = t ? msgById.get(t.message_id) : undefined;
      items.push({
        id: p.id, ts, kind: "tool", text: (d.summary ?? "").trim(),
        projectId: m?.project_id ?? null, sessionId: m?.session_id ?? null, isSubagent: !!m?.is_subagent,
        messageId: t?.message_id ?? undefined, model: m?.model, costUsd: m?.cost_usd ?? null,
        status: t?.status === "ok" || t?.status === "error" ? t.status : null,
        tool: { name: d.full_name ?? t?.name ?? "tool", status: t?.status ?? null, error: d.error ?? null },
        user: p.user,
      });
    }
  }
  items.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  return { items, projects, messages: msgById };
}

/**
 * Consecutive items of the same project + session form one group, like
 * `clioilc activity`. Group cost counts each message once.
 * @param {Item[]} items @param {Map<string, any>} messages
 * @returns {Group[]}
 */
export function groupBySession(items, messages) {
  /** @type {Group[]} */
  const groups = [];
  /** @type {Set<string>} */
  let counted = new Set();
  for (const item of items) {
    let g = groups[groups.length - 1];
    if (!g || g.projectId !== item.projectId || g.sessionId !== item.sessionId || g.user !== item.user) {
      g = { key: `${item.id}`, projectId: item.projectId, sessionId: item.sessionId, user: item.user, items: [], costUsd: 0 };
      groups.push(g);
      counted = new Set();
    }
    g.items.push(item);
    if (item.messageId && !counted.has(item.messageId)) {
      counted.add(item.messageId);
      g.costUsd += messages.get(item.messageId)?.cost_usd ?? 0;
    }
  }
  return groups;
}

/**
 * Labels for Claude project folder names (`-Volumes-SSD1-Private-app`):
 * drops the dash-separated prefix shared by the most projects (at least
 * two; longest wins a tie), from the projects that have it, so the part
 * that tells them apart stays visible. Others keep their full name.
 * @param {Iterable<string>} allNames
 * @returns {(name: string | undefined) => string}
 */
export function projectLabeler(allNames) {
  const split = [...new Set(allNames)].map((n) => n.replace(/^-/, "").split("-"));
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const parts of split) {
    // Proper prefixes only: at least one segment must remain.
    for (let len = 1; len < parts.length; len++) {
      const key = parts.slice(0, len).join("-");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let best = "";
  let bestCount = 1;
  for (const [key, n] of counts) {
    if (n > bestCount || (n === bestCount && n > 1 && key.length > best.length)) {
      best = key;
      bestCount = n;
    }
  }
  return (name) => {
    if (!name) return shortProject(name);
    const clean = name.replace(/^-/, "");
    return shortProject(best && clean.startsWith(`${best}-`) ? clean.slice(best.length + 1) : clean);
  };
}

/** Claude project folder name -> something short to show. @param {string | undefined} name */
export function shortProject(name) {
  if (!name) return "unknown project";
  const clean = name.replace(/^-/, "");
  return clean.length > 42 ? `…${clean.slice(-41)}` : clean;
}

/**
 * Project names by project_id, for labelling hashes. E2E names need the
 * unlocked data key; without it the map is empty and `locked` is true.
 * @param {Uint8Array<ArrayBuffer> | null} dataKey @param {AbortSignal} [signal]
 */
export async function loadProjectNames(dataKey, signal) {
  const res = await api(`/api/v1/usage/projects/?${withScope(new URLSearchParams())}`, { signal });
  if (res.enc_mode === "e2e" && res.projects.some((/** @type {any} */ p) => "name_ct" in p)) {
    // E2E team workspace: project names are sealed with the project keys.
    if (!dataKey) return { names: new Map(), locked: true };
    const ws = new URLSearchParams(withScope(new URLSearchParams())).get("workspace") ?? "";
    const { rows } = await openTeamActivity({ workspace: ws, private: res.projects, team_records: [] });
    return { names: new Map(rows.map((r) => [r.id, r.data.name])), locked: false };
  }
  /** @type {Map<string, string>} */
  const names = new Map();
  let locked = false;
  for (const p of res.projects) {
    if (p.data) names.set(p.id, p.data.name);
    else if (p.ciphertext && dataKey) {
      try {
        names.set(p.id, (await decryptRecord(dataKey, p)).name);
      } catch {
        /* unreadable: keep the hash */
      }
    } else if (p.ciphertext) locked = true;
  }
  return { names, locked };
}
