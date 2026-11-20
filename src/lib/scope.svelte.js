// Which data the dashboard shows: the signed-in user's own ("personal") or
// a team workspace's (backend docs/workspaces.md). Loaders read it while
// building their URL, so pages reload when it changes.
import { api } from "./api.js";

const KEY = "clioilc.scope";

/**
 * @typedef {{ slug: string, name: string, role: string | null,
 *   can: { manage_projects: boolean, manage_members: boolean, delete: boolean, transfer: boolean } }} Workspace
 */

export const scope = $state({
  /** Selected workspace slug; null = personal. */
  workspace: /** @type {string | null} */ (read()),
  /** @type {Workspace[]} */
  workspaces: [],
  loaded: false,
});

function read() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** @param {string | null} slug */
export function setScope(slug) {
  scope.workspace = slug;
  try {
    if (slug) localStorage.setItem(KEY, slug);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: scope is not remembered */
  }
}

/** Load the workspace list; drop a remembered scope the user lost access to. */
export async function refreshWorkspaces() {
  try {
    scope.workspaces = await api("/api/v1/workspaces/");
  } catch {
    scope.workspaces = [];
  }
  if (scope.workspace && !scope.workspaces.some((w) => w.slug === scope.workspace)) setScope(null);
  scope.loaded = true;
}

/** The selected workspace object, if any. */
export function current() {
  return scope.workspaces.find((w) => w.slug === scope.workspace) ?? null;
}

/** Adds `workspace=` to report/activity/projects queries in team scope. @param {URLSearchParams} params */
export function withScope(params) {
  if (scope.workspace) params.set("workspace", scope.workspace);
  return params;
}
