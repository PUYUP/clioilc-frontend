// One readable sentence per workspace audit event
// (backend docs/workspaces.md, "Audit log").

/**
 * @typedef {{ id: number, action: string, actor: string | null, target: string | null,
 *   project: string | null, data: Record<string, any>, created_at: string }} AuditEvent
 */

/** @param {string | null} name */
const at = (name) => (name ? `@${name}` : "someone");

const FIELD = /** @type {Record<string, string>} */ ({ name: "name", slug: "URL name", git_remote: "git remote" });

/** @param {AuditEvent} e */
export function describe(e) {
  const who = at(e.actor);
  const target = at(e.target);
  const p = e.project ? `“${e.project}”` : "a deleted project";
  const d = e.data ?? {};
  const onProject = e.project ? ` to ${p}` : "";
  const dropped = d.links_dropped ? ` (${d.links_dropped} linked folder${d.links_dropped === 1 ? "" : "s"} removed)` : "";
  switch (e.action) {
    case "workspace.create":
      return `${who} created the workspace`;
    case "workspace.rename":
      return `${who} renamed the workspace from “${d.old}” to “${d.new}”`;
    case "member.role":
      return `${who} changed ${target}'s role from ${d.old} to ${d.new}${dropped}`;
    case "member.remove":
      return `${who} removed ${target}${dropped}`;
    case "member.leave":
      return `${who} left the workspace${dropped}`;
    case "invite.create":
      return `${who} invited ${target} as ${d.role}${onProject}`;
    case "invite.revoke":
      return `${who} revoked the invitation for ${target}`;
    case "invite.accept":
      return `${who} joined as ${d.role}${e.project ? ` on ${p}` : ""}`;
    case "invite.decline":
      return `${who} declined an invitation`;
    case "project.create":
      return `${who} created project ${p}`;
    case "project.update":
      return `${who} changed the ${Object.keys(d.changes ?? {}).map((f) => FIELD[f] ?? f).join(" and ") || "settings"} of ${p}`;
    case "project.delete":
      return `${who} deleted project ${p}${dropped}`;
    case "project_access.set":
      return `${who} made ${target} ${d.new} on ${p}`;
    case "project_access.remove":
      return `${who} removed ${target} from ${p}${dropped}`;
    case "link.create":
      return `${who} linked a folder${onProject}, ${d.history ? "with its history" : "from now on"}`;
    case "link.remove":
      return `${who} unlinked a folder from ${p}`;
    default:
      return `${who}: ${e.action}`;
  }
}
