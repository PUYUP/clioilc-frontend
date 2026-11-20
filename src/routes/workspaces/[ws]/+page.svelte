<script>
  // One workspace: projects (and my sharing choice per project), members,
  // invitations and settings. What is shown follows my role
  // (backend docs/workspaces.md, "Aturan akses").
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api, ApiError } from "$lib/api.js";
  import { describe } from "$lib/audit.js";
  import { ago, longLabel, timeZone } from "$lib/format.js";
  import Login from "$lib/Login.svelte";
  import { refreshWorkspaces, setScope } from "$lib/scope.svelte.js";
  import { session } from "$lib/session.svelte.js";

  /**
   * @typedef {{ slug: string, name: string, role: string | null, can: { manage_projects: boolean, manage_members: boolean, delete: boolean, transfer: boolean } }} Workspace
   * @typedef {{ slug: string, name: string, git_remote: string, role: string | null, sources: number, can: { link: boolean, manage_access: boolean, manage: boolean } }} Project
   * @typedef {{ id: number, username: string, avatar_url: string | null, role: string }} Member
   * @typedef {{ id: number, project: { slug: string, name: string } | null, role: string, github_login: string, invited_by: string | null, expires_at: string, url?: string, emailed?: boolean }} Invite
   */

  const ROLES = ["owner", "admin", "member", "viewer"];
  const PROJECT_ROLES = ["viewer", "contributor", "maintainer"];
  const ROLE_HELP = {
    owner: "everything, including deleting the workspace",
    admin: "manage projects, members and invitations",
    member: "see all projects and link own folders",
    viewer: "see all projects",
    contributor: "see this project and link own folders",
    maintainer: "contributor + invite to this project",
  };

  const slug = $derived(page.params.ws ?? "");
  let ws = $state(/** @type {Workspace | null} */ (null));
  let projects = $state(/** @type {Project[]} */ ([]));
  let members = $state(/** @type {Member[] | null} */ (null));
  let invites = $state(/** @type {Invite[] | null} */ (null));
  let shareText = $state(/** @type {Record<string, boolean>} */ ({}));
  let collaborators = $state(/** @type {Record<string, Member[] | undefined>} */ ({}));
  let notFound = $state(false);
  let error = $state(/** @type {string | null} */ (null));
  let busy = $state(false);

  // Forms
  let projectName = $state("");
  let projectSlug = $state("");
  let projectRemote = $state("");
  let editingRemote = $state(/** @type {string | null} */ (null));
  let remoteDraft = $state("");
  let events = $state(/** @type {import("$lib/audit.js").AuditEvent[] | null} */ (null));
  let auditNext = $state(/** @type {number | null} */ (null));
  let inviteLogin = $state("");
  let inviteTarget = $state(""); // "" = whole workspace, else a project slug
  let inviteRole = $state("member");
  let newInvite = $state(/** @type {Invite | null} */ (null));
  let copied = $state(false);
  let rename = $state("");
  let deleteOpen = $state(false);
  let deleteConfirm = $state("");
  let removing = $state(/** @type {string | null} */ (null));

  const me = $derived(session.user?.username);
  const canInviteSomewhere = $derived(!!ws?.can.manage_members || projects.some((p) => p.can.manage_access));
  const inviteTargets = $derived(
    ws?.can.manage_members ? projects : projects.filter((p) => p.can.manage_access),
  );
  const roleChoices = $derived(inviteTarget ? PROJECT_ROLES : ["admin", "member", "viewer"]);

  $effect(() => {
    // Keep the role valid for the chosen target.
    if (!roleChoices.includes(inviteRole)) inviteRole = inviteTarget ? "viewer" : "member";
  });
  $effect(() => {
    if (!ws?.can.manage_members && inviteTargets.length && !inviteTarget) inviteTarget = inviteTargets[0].slug;
  });

  $effect(() => {
    if (!session.user || !slug) return;
    const controller = new AbortController();
    load(slug, controller.signal);
    return () => controller.abort();
  });

  /** @param {string} s @param {AbortSignal} [signal] */
  async function load(s, signal) {
    error = null;
    try {
      ws = await api(`/api/v1/workspaces/${s}/`, { signal });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) notFound = true;
      else if (/** @type {any} */ (e).name !== "AbortError") error = "Failed to load the workspace.";
      return;
    }
    const w = /** @type {Workspace} */ (ws);
    rename = w.name;
    const [p, m, inv] = await Promise.all([
      api(`/api/v1/workspaces/${s}/projects/`, { signal }),
      w.role ? api(`/api/v1/workspaces/${s}/members/`, { signal }) : Promise.resolve(null),
      w.can.manage_members ? api(`/api/v1/workspaces/${s}/invitations/`, { signal }) : Promise.resolve(null),
    ]);
    projects = p;
    members = m;
    invites = inv;
    if (w.can.manage_members) loadAudit(s, null, signal);
    const settings = await Promise.all(
      p.map((/** @type {Project} */ x) => api(`/api/v1/workspaces/${s}/projects/${x.slug}/me/`, { signal })),
    );
    shareText = Object.fromEntries(p.map((/** @type {Project} */ x, /** @type {number} */ i) => [x.slug, settings[i].share_text]));
  }

  /** @param {() => Promise<unknown>} fn @param {string} failure */
  async function run(fn, failure) {
    busy = true;
    error = null;
    try {
      await fn();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : null;
      /** @type {Record<string, string>} */
      const messages = {
          last_owner: "A workspace needs at least one owner. Make someone else owner first.",
          slug_taken: "That URL name is taken.",
          already_member: "That person already has access.",
          forbidden: "Your role does not allow this.",
        };
      error =
        messages[String(code ?? "")] ??
        (e instanceof ApiError && e.status === 400 ? Object.values(e.body ?? {}).flat().join(" ") || failure : failure);
    } finally {
      busy = false;
    }
  }

  /** @param {string} s @param {number | null} before @param {AbortSignal} [signal] */
  async function loadAudit(s, before, signal) {
    const q = before ? `?before=${before}` : "";
    const page = await api(`/api/v1/workspaces/${s}/audit/${q}`, { signal });
    events = before ? [...(events ?? []), ...page.events] : page.events;
    auditNext = page.next;
  }

  /** @param {Project} p */
  const saveRemote = (p) =>
    run(async () => {
      const updated = await api(`/api/v1/workspaces/${slug}/projects/${p.slug}/`, {
        method: "PATCH",
        body: { git_remote: remoteDraft },
      });
      projects = projects.map((x) => (x.slug === p.slug ? { ...x, git_remote: updated.git_remote } : x));
      editingRemote = null;
    }, "Failed to save the git remote.");

  const createProject = () =>
    run(async () => {
      const p = await api(`/api/v1/workspaces/${slug}/projects/`, {
        method: "POST",
        body: { name: projectName, slug: projectSlug || toSlug(projectName), git_remote: projectRemote },
      });
      projects = [...projects, p].sort((a, b) => a.slug.localeCompare(b.slug));
      shareText[p.slug] = false;
      projectName = projectSlug = projectRemote = "";
    }, "Failed to create the project.");

  /** @param {Project} p */
  const toggleShare = (p) =>
    run(async () => {
      const r = await api(`/api/v1/workspaces/${slug}/projects/${p.slug}/me/`, {
        method: "PATCH",
        body: { share_text: !shareText[p.slug] },
      });
      shareText[p.slug] = r.share_text;
    }, "Failed to save.");

  /** @param {Project} p */
  const deleteProject = (p) =>
    run(async () => {
      await api(`/api/v1/workspaces/${slug}/projects/${p.slug}/`, { method: "DELETE", body: { confirm: p.slug } });
      projects = projects.filter((x) => x.slug !== p.slug);
      removing = null;
    }, "Failed to delete the project.");

  /** @param {Project} p */
  async function toggleCollaborators(p) {
    if (collaborators[p.slug]) {
      collaborators[p.slug] = undefined;
      return;
    }
    await run(async () => {
      collaborators[p.slug] = await api(`/api/v1/workspaces/${slug}/projects/${p.slug}/access/`);
    }, "Failed to load collaborators.");
  }

  /** @param {Project} p @param {Member} u */
  const removeCollaborator = (p, u) =>
    run(async () => {
      await api(`/api/v1/workspaces/${slug}/projects/${p.slug}/access/${u.id}/`, { method: "DELETE" });
      collaborators[p.slug] = (collaborators[p.slug] ?? []).filter((x) => x.id !== u.id);
    }, "Failed to remove the collaborator.");

  /** @param {Member} m @param {string} role */
  const changeRole = (m, role) =>
    run(async () => {
      await api(`/api/v1/workspaces/${slug}/members/${m.id}/`, { method: "PATCH", body: { role } });
      members = (members ?? []).map((x) => (x.id === m.id ? { ...x, role } : x));
      if (m.username === me) await reload();
    }, "Failed to change the role.");

  /** @param {Member} m */
  const removeMember = (m) =>
    run(async () => {
      await api(`/api/v1/workspaces/${slug}/members/${m.id}/`, { method: "DELETE" });
      removing = null;
      if (m.username === me) {
        await refreshWorkspaces();
        goto("/workspaces");
      } else {
        members = (members ?? []).filter((x) => x.id !== m.id);
      }
    }, "Failed to remove the member.");

  const invite = () =>
    run(async () => {
      /** @type {Invite} */
      const created = await api(`/api/v1/workspaces/${slug}/invitations/`, {
        method: "POST",
        body: { github_login: inviteLogin.replace(/^@/, ""), role: inviteRole, project: inviteTarget || null },
      });
      newInvite = created;
      copied = false;
      inviteLogin = "";
      if (ws?.can.manage_members) invites = [created, ...(invites ?? [])];
    }, "Failed to create the invitation.");

  /** @param {Invite} inv */
  const revoke = (inv) =>
    run(async () => {
      await api(`/api/v1/workspaces/${slug}/invitations/${inv.id}/`, { method: "DELETE" });
      invites = (invites ?? []).filter((i) => i.id !== inv.id);
      if (newInvite?.id === inv.id) newInvite = null;
    }, "Failed to revoke the invitation.");

  const saveName = () =>
    run(async () => {
      ws = await api(`/api/v1/workspaces/${slug}/`, { method: "PATCH", body: { name: rename } });
      await refreshWorkspaces();
    }, "Failed to rename.");

  const deleteWorkspace = () =>
    run(async () => {
      await api(`/api/v1/workspaces/${slug}/`, { method: "DELETE", body: { confirm: deleteConfirm } });
      setScope(null);
      await refreshWorkspaces();
      goto("/workspaces");
    }, "Failed to delete the workspace.");

  async function reload() {
    await load(slug);
    await refreshWorkspaces();
  }

  async function copyLink() {
    if (!newInvite?.url) return;
    try {
      await navigator.clipboard.writeText(newInvite.url);
      copied = true;
    } catch {
      copied = false;
    }
  }

  /** @param {string} s */
  function toSlug(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 39).replace(/-+$/, "");
  }
</script>

{#if !session.user}
  <Login next={`/workspaces/${slug}`} message="Sign in to see this workspace." />
{:else if notFound}
  <div class="card"><p>Workspace not found, or you are not a member.</p><p><a href="/workspaces">All workspaces</a></p></div>
{:else if !ws}
  {#if error}<div class="card"><p class="error">{error}</p></div>{:else}<p class="muted">Loading…</p>{/if}
{:else}
  <div class="head">
    <div>
      <p class="muted small crumb"><a href="/workspaces">Workspaces</a> /</p>
      <h1>{ws.name}</h1>
      <p class="muted small">{ws.slug} · you are {ws.role ? `${ws.role}` : "a project collaborator"}</p>
    </div>
    <button class="btn primary" onclick={() => (setScope(ws?.slug ?? null), goto("/"))}>View team usage</button>
  </div>

  {#if error}<div class="card"><p class="error" role="alert">{error}</p></div>{/if}

  <section class="card">
    <h2>Projects</h2>
    {#if projects.length === 0}
      <p class="muted small">No projects yet.{ws.can.manage_projects ? " Create one below, then link folders to it." : ""}</p>
    {:else}
      <ul class="list">
        {#each projects as p (p.slug)}
          <li class="project">
            <div class="row">
              <div class="grow">
                <strong>{p.name}</strong>
                <span class="muted small">
                  {p.slug} · {p.sources === 1 ? "1 linked folder" : `${p.sources} linked folders`}{p.role ? ` · you: ${p.role}` : ""}
                </span>
                {#if p.git_remote}<span class="muted small remote">git: {p.git_remote}</span>{/if}
              </div>
              <div class="actions">
                {#if p.can.manage_access}
                  <button class="btn" onclick={() => toggleCollaborators(p)}>{collaborators[p.slug] ? "Hide collaborators" : "Collaborators"}</button>
                {/if}
                {#if p.can.manage && editingRemote !== p.slug}
                  <button class="btn" onclick={() => ((editingRemote = p.slug), (remoteDraft = p.git_remote))}>Git remote…</button>
                {/if}
                {#if p.can.manage && removing !== `p:${p.slug}`}
                  <button class="btn" onclick={() => (removing = `p:${p.slug}`)}>Delete…</button>
                {/if}
              </div>
            </div>
            {#if editingRemote === p.slug}
              <form
                class="inline remote-form"
                onsubmit={(e) => {
                  e.preventDefault();
                  saveRemote(p);
                }}
              >
                <input
                  class="input"
                  placeholder="git@github.com:acme/api.git"
                  maxlength="300"
                  bind:value={remoteDraft}
                  aria-label={`Git remote of ${p.name}`}
                  spellcheck="false"
                />
                <button class="btn" type="submit" disabled={busy}>Save</button>
                <button class="btn" type="button" onclick={() => (editingRemote = null)}>Cancel</button>
              </form>
              <p class="muted small hint">With it, <code>clioilc link</code> run in a clone of this repo finds the project by itself. Leave empty to remove.</p>
            {/if}
            {#if removing === `p:${p.slug}`}
              <div class="confirm">
                <p class="small">Delete <strong>{p.name}</strong>? Links and collaborator access are removed. Members' own data is not deleted.</p>
                <div class="actions">
                  <button class="btn danger" disabled={busy} onclick={() => deleteProject(p)}>Delete project</button>
                  <button class="btn" disabled={busy} onclick={() => (removing = null)}>Cancel</button>
                </div>
              </div>
            {/if}
            {#if p.can.link}
              <p class="small link-hint">Link a folder: <code>clioilc link {ws.slug}/{p.slug}</code></p>
            {/if}
            <label class="share small">
              <input type="checkbox" checked={!!shareText[p.slug]} disabled={busy} onchange={() => toggleShare(p)} />
              <span>
                Share my prompts, replies and thinking in this project
                <span class="muted">(usage and tool actions are always shared)</span>
              </span>
            </label>
            {#if collaborators[p.slug]}
              {@const list = collaborators[p.slug] ?? []}
              <div class="collab">
                {#if list.length === 0}
                  <p class="muted small">No outside collaborators. Invite one below.</p>
                {:else}
                  <ul class="list">
                    {#each list as u (u.id)}
                      <li class="row small">
                        <span>@{u.username} · {u.role}</span>
                        <button class="btn" disabled={busy} onclick={() => removeCollaborator(p, u)}>Remove</button>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if ws.can.manage_projects}
      <form
        class="inline"
        onsubmit={(e) => {
          e.preventDefault();
          createProject();
        }}
      >
        <input class="input" placeholder="Project name" maxlength="100" bind:value={projectName} required aria-label="Project name" />
        <input
          class="input"
          placeholder={toSlug(projectName) || "url-name"}
          maxlength="39"
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          bind:value={projectSlug}
          aria-label="Project URL name"
        />
        <input
          class="input"
          placeholder="Git remote (optional)"
          maxlength="300"
          bind:value={projectRemote}
          aria-label="Project git remote"
          spellcheck="false"
        />
        <button class="btn" type="submit" disabled={busy || !projectName}>Add project</button>
      </form>
    {/if}
  </section>

  {#if members}
    <section class="card">
      <h2>Members</h2>
      <ul class="list">
        {#each members as m (m.id)}
          {@const self = m.username === me}
          {@const ownerLocked = m.role === "owner" && !ws.can.transfer}
          <li class="member">
            <div class="row">
              <div class="who">
                {#if m.avatar_url}<img src={m.avatar_url} alt="" width="28" height="28" />{/if}
                <span><strong>@{m.username}</strong>{self ? " (you)" : ""}</span>
              </div>
              <div class="actions">
                {#if ws.can.manage_members && !ownerLocked}
                  <select
                    class="input"
                    aria-label={`Role of ${m.username}`}
                    value={m.role}
                    disabled={busy}
                    onchange={(e) => changeRole(m, e.currentTarget.value)}
                  >
                    {#each ROLES as r (r)}
                      <option value={r} disabled={r === "owner" && !ws.can.transfer}>{r}</option>
                    {/each}
                  </select>
                {:else}
                  <span class="muted small">{m.role}</span>
                {/if}
                {#if (self || (ws.can.manage_members && !ownerLocked)) && removing !== `m:${m.id}`}
                  <button class="btn" disabled={busy} onclick={() => (removing = `m:${m.id}`)}>{self ? "Leave…" : "Remove…"}</button>
                {/if}
              </div>
            </div>
            {#if removing === `m:${m.id}`}
              <div class="confirm">
                <p class="small">
                  {self ? "Leave this workspace?" : `Remove @${m.username}?`} Their linked folders leave the team's view; their own data is kept.
                </p>
                <div class="actions">
                  <button class="btn danger" disabled={busy} onclick={() => removeMember(m)}>{self ? "Leave" : "Remove"}</button>
                  <button class="btn" disabled={busy} onclick={() => (removing = null)}>Cancel</button>
                </div>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
      <p class="muted small roles">
        {#each ROLES as r, i (r)}<strong>{r}</strong>: {ROLE_HELP[/** @type {keyof typeof ROLE_HELP} */ (r)]}{i < ROLES.length - 1 ? " · " : ""}{/each}
      </p>
    </section>
  {/if}

  {#if canInviteSomewhere}
    <section class="card">
      <h2>Invite</h2>
      <form
        class="invite"
        onsubmit={(e) => {
          e.preventDefault();
          invite();
        }}
      >
        <input
          class="input"
          placeholder="GitHub username"
          maxlength="40"
          bind:value={inviteLogin}
          required
          aria-label="GitHub username"
          autocomplete="off"
          spellcheck="false"
        />
        <select class="input" bind:value={inviteTarget} aria-label="Invite to">
          {#if ws.can.manage_members}<option value="">Whole workspace</option>{/if}
          {#each inviteTargets as p (p.slug)}<option value={p.slug}>Only {p.name}</option>{/each}
        </select>
        <select class="input" bind:value={inviteRole} aria-label="Role">
          {#each roleChoices as r (r)}<option value={r}>{r}</option>{/each}
        </select>
        <button class="btn primary" type="submit" disabled={busy || !inviteLogin}>Create invite link</button>
      </form>
      <p class="muted small"><strong>{inviteRole}</strong>: {ROLE_HELP[/** @type {keyof typeof ROLE_HELP} */ (inviteRole)]}. Only that GitHub account can accept. The link works for 7 days.</p>
      {#if newInvite?.url}
        <div class="new-invite">
          <p class="small">
            {#if newInvite.emailed}
              We emailed this link to <strong>@{newInvite.github_login}</strong>. You can also send it yourself; it is shown only once.
            {:else}
              Send this link to <strong>@{newInvite.github_login}</strong>. It is shown only once.
            {/if}
          </p>
          <div class="copy">
            <code>{newInvite.url}</code>
            <button class="btn" onclick={copyLink}>{copied ? "Copied" : "Copy"}</button>
          </div>
        </div>
      {/if}
      {#if invites?.length}
        <h3>Pending</h3>
        <ul class="list">
          {#each invites as inv (inv.id)}
            <li class="row small">
              <span>@{inv.github_login} → {inv.project ? inv.project.name : "workspace"} as {inv.role} · expires {ago(new Date(inv.expires_at))}</span>
              <button class="btn" disabled={busy} onclick={() => revoke(inv)}>Revoke</button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  {#if ws.can.manage_members && events}
    <section class="card">
      <h2>Audit log</h2>
      {#if events.length === 0}
        <p class="muted small">Nothing yet.</p>
      {:else}
        <ol class="audit">
          {#each events as e (e.id)}
            {@const when = new Date(e.created_at)}
            <li class="small">
              <time datetime={e.created_at} title={`${longLabel(when, "hour")} (${timeZone})`}>{ago(when)}</time>
              <span>{describe(e)}</span>
            </li>
          {/each}
        </ol>
        {#if auditNext}
          <button class="btn more" disabled={busy} onclick={() => run(() => loadAudit(slug, auditNext), "Failed to load more.")}>Load older</button>
        {/if}
      {/if}
    </section>
  {/if}

  {#if ws.can.manage_members}
    <section class="card">
      <h2>Settings</h2>
      <form
        class="inline"
        onsubmit={(e) => {
          e.preventDefault();
          saveName();
        }}
      >
        <input class="input" maxlength="100" bind:value={rename} required aria-label="Workspace name" />
        <button class="btn" type="submit" disabled={busy || !rename || rename === ws.name}>Rename</button>
      </form>
      {#if ws.can.delete}
        <div class="danger-zone">
          {#if !deleteOpen}
            <button class="btn" onclick={() => (deleteOpen = true)}>Delete workspace…</button>
          {:else}
            <p class="small">Deletes the workspace, its projects, links and invitations. Members' own data is not deleted. Type <strong>{ws.slug}</strong> to confirm.</p>
            <div class="inline">
              <input class="input" bind:value={deleteConfirm} aria-label="Confirm workspace name" autocomplete="off" />
              <button class="btn danger" disabled={busy || deleteConfirm !== ws.slug} onclick={deleteWorkspace}>Delete</button>
              <button class="btn" onclick={() => ((deleteOpen = false), (deleteConfirm = ""))}>Cancel</button>
            </div>
          {/if}
        </div>
      {/if}
    </section>
  {/if}
{/if}

<style>
  .head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 12px; margin-bottom: 16px; }
  .crumb { margin: 0 0 2px; }
  h1 { font-size: 20px; margin: 0; overflow-wrap: anywhere; }
  h2 { font-size: 16px; margin: 0 0 10px; }
  h3 { font-size: 14px; margin: 16px 0 8px; }
  .small { font-size: 13px; }
  .head .small { margin: 4px 0 0; }
  section { padding: 18px 20px; margin-bottom: 12px; }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .project, .member { display: grid; gap: 6px; }
  .project + .project { border-top: 1px solid var(--border); padding-top: 12px; }
  .row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
  .grow { display: grid; gap: 2px; min-width: 0; }
  .grow strong { overflow-wrap: anywhere; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .link-hint { margin: 0; color: var(--text-secondary); overflow-wrap: anywhere; }
  .share { display: flex; gap: 8px; align-items: flex-start; color: var(--text-secondary); }
  .share input { margin-top: 2px; }
  .confirm { background: var(--ghost); border-radius: 8px; padding: 10px 12px; }
  .confirm p { margin: 0 0 8px; }
  .collab { padding-left: 12px; border-left: 2px solid var(--border); }
  .who { display: flex; align-items: center; gap: 8px; min-width: 0; overflow-wrap: anywhere; }
  .who img { border-radius: 50%; }
  .roles { margin: 12px 0 0; }
  form.inline, div.inline { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  form.inline .input { flex: 1 1 160px; }
  .invite { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 0.8fr) auto; gap: 8px; }
  @media (max-width: 640px) {
    .invite { grid-template-columns: 1fr; }
  }
  .new-invite { margin-top: 12px; padding: 10px 12px; border-radius: 8px; background: var(--series-1-wash); }
  .new-invite p { margin: 0 0 6px; }
  .copy { display: flex; gap: 8px; align-items: center; }
  .copy code { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 12px; }
  .danger-zone { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border); }
  .danger-zone p { margin: 0 0 4px; }
  .remote { overflow-wrap: anywhere; }
  .remote-form { margin-top: 0; }
  .hint { margin: 0; }
  .audit { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .audit li { display: grid; grid-template-columns: 90px 1fr; gap: 8px; }
  .audit time { color: var(--text-muted); white-space: nowrap; }
  .audit span { overflow-wrap: anywhere; }
  .more { margin-top: 10px; }
</style>
