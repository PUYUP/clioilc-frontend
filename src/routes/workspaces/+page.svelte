<script>
  // Team workspaces: the ones I am in, invitations waiting for me, and a
  // form to start a new one (backend docs/workspaces.md).
  import { goto } from "$app/navigation";
  import { api, ApiError } from "$lib/api.js";
  import { ago } from "$lib/format.js";
  import Login from "$lib/Login.svelte";
  import { scope, refreshWorkspaces, setScope } from "$lib/scope.svelte.js";
  import { session } from "$lib/session.svelte.js";
  import { installKey, isE2EAccount, loadMe, team, wsLabel } from "$lib/team.svelte.js";
  import Unlock from "$lib/Unlock.svelte";
  import { vault } from "$lib/vault.svelte.js";

  /** @typedef {{ id: number, workspace: { slug: string, name: string }, project: { slug: string, name: string } | null, role: string, invited_by: string | null, expires_at: string }} Invite */

  let invites = $state(/** @type {Invite[] | null} */ (null));
  let error = $state(/** @type {string | null} */ (null));
  let busy = $state(false);
  let name = $state("");
  let slug = $state("");
  let slugTouched = $state(false);
  /** @type {"server" | "e2e"} */
  let mode = $state("server");

  $effect(() => {
    if (session.user) loadMe().catch(() => {});
  });

  // Suggest a slug from the name until the user edits it.
  $effect(() => {
    if (!slugTouched) slug = toSlug(name);
  });

  /** @param {string} s */
  function toSlug(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 39).replace(/-+$/, "");
  }

  $effect(() => {
    if (!session.user) return;
    const controller = new AbortController();
    api("/api/v1/workspaces/invitations/", { signal: controller.signal })
      .then((d) => (invites = d))
      .catch((e) => {
        if (e.name !== "AbortError") invites = [];
      });
    return () => controller.abort();
  });

  async function create() {
    busy = true;
    error = null;
    try {
      let ws;
      if (mode === "e2e") {
        // Two steps: the workspace is created without a name, then key v1 is
        // installed with the name sealed under it (docs/e2e-teams.md).
        ws = await api("/api/v1/workspaces/", { method: "POST", body: { slug, enc_mode: "e2e" } });
        await installKey(ws.slug, "ws", ws.id, { name });
      } else {
        ws = await api("/api/v1/workspaces/", { method: "POST", body: { slug, name } });
      }
      await refreshWorkspaces();
      setScope(ws.slug);
      goto(`/workspaces/${ws.slug}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "slug_taken") error = "That URL name is taken.";
      else if (e instanceof ApiError && e.status === 400) error = e.body?.slug?.[0] ?? e.body?.name?.[0] ?? "Check the name.";
      else error = "Failed to create the workspace.";
    } finally {
      busy = false;
    }
  }

  /** @param {Invite} inv @param {"accept" | "decline"} action */
  async function answer(inv, action) {
    busy = true;
    try {
      await api(`/api/v1/workspaces/invitations/${inv.id}/${action}/`, { method: "POST" });
      invites = (invites ?? []).filter((i) => i.id !== inv.id);
      if (action === "accept") {
        await refreshWorkspaces();
        setScope(inv.workspace.slug);
        goto(`/workspaces/${inv.workspace.slug}`);
      }
    } catch {
      error = "That invitation can no longer be used.";
    } finally {
      busy = false;
    }
  }
</script>

{#if !session.user}
  <Login next="/workspaces" message="Sign in to see your workspaces." />
{:else}
  <div class="head">
    <h1>Workspaces</h1>
    <p class="muted small">Share agent usage with a team. Each member links their own folders with <code>clioilc link</code>.</p>
  </div>

  {#if error}<div class="card"><p class="error" role="alert">{error}</p></div>{/if}

  {#if invites?.length}
    <section class="card">
      <h2>Invitations</h2>
      <ul class="list">
        {#each invites as inv (inv.id)}
          <li class="row">
            <div class="grow">
              <strong>{inv.project ? `${inv.workspace.name} / ${inv.project.name}` : inv.workspace.name}</strong>
              <span class="muted small">as {inv.role}{inv.invited_by ? `, from @${inv.invited_by}` : ""} · expires {ago(new Date(inv.expires_at))}</span>
            </div>
            <div class="actions">
              <button class="btn primary" disabled={busy} onclick={() => answer(inv, "accept")}>Accept</button>
              <button class="btn" disabled={busy} onclick={() => answer(inv, "decline")}>Decline</button>
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="card">
    <h2>Your workspaces</h2>
    {#if !scope.loaded}
      <p class="muted small">Loading…</p>
    {:else if scope.workspaces.length === 0}
      <p class="muted small">You are not in any workspace yet.</p>
    {:else}
      <ul class="list">
        {#each scope.workspaces as w (w.slug)}
          <li class="row">
            <div class="grow">
              <a href={`/workspaces/${w.slug}`}><strong>{wsLabel(w)}</strong></a>{#if w.enc_mode === "e2e"}<span class="badge" title="End-to-end encrypted">E2E</span>{/if}
              <span class="muted small">{w.slug} · {w.role ?? "project collaborator"}</span>
            </div>
            <button class="btn" onclick={() => (setScope(w.slug), goto("/"))}>View usage</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card">
    <h2>New workspace</h2>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        create();
      }}
    >
      <label class="small" for="ws-name">Name</label>
      <input id="ws-name" class="input" maxlength="100" placeholder="Acme" bind:value={name} required />
      <label class="small" for="ws-slug">URL name</label>
      <input
        id="ws-slug"
        class="input"
        maxlength="39"
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        bind:value={slug}
        oninput={() => (slugTouched = true)}
        required
      />
      <p class="muted small hint">Used in <code>clioilc link {slug || "acme"}/&lt;project&gt;</code>. Lowercase letters, digits and dashes.{mode === "e2e" ? " The URL name is not encrypted; pick one that does not give away a client or project." : ""}</p>
      {#if isE2EAccount()}
        <fieldset class="mode">
          <legend class="small">Encryption</legend>
          <label class="small"><input type="radio" bind:group={mode} value="server" /> Server — the server can read shared data (simplest)</label>
          <label class="small"><input type="radio" bind:group={mode} value="e2e" /> End-to-end — only members can read names and shared data. Members must be end-to-end accounts. Cannot be changed later.</label>
        </fieldset>
        {#if mode === "e2e" && !vault.dataKey}
          <Unlock title="Unlock to create an end-to-end workspace" />
        {/if}
      {/if}
      <div><button class="btn primary" type="submit" disabled={busy || !name || !slug || (mode === "e2e" && !vault.dataKey)}>Create workspace</button></div>
      {#if mode === "e2e" && team.fingerprint}
        <p class="muted small hint">Your fingerprint: <code>{team.fingerprint.toUpperCase().match(/.{4}/g)?.join(" ")}</code></p>
      {/if}
    </form>
  </section>
{/if}

<style>
  .head { margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0; }
  h2 { font-size: 16px; margin: 0 0 10px; }
  .small { font-size: 13px; }
  .head .small { margin: 4px 0 0; }
  section { padding: 18px 20px; margin-bottom: 12px; }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
  .grow { display: grid; gap: 2px; min-width: 0; }
  .grow strong { overflow-wrap: anywhere; }
  .actions { display: flex; gap: 8px; }
  form { display: grid; gap: 6px; max-width: 360px; }
  .hint { margin: 0 0 6px; }
  .badge { font-size: 11px; margin-left: 6px; padding: 1px 6px; border-radius: 6px; background: var(--ghost); color: var(--text-secondary); }
  .mode { border: 0; padding: 0; margin: 4px 0 8px; display: grid; gap: 6px; }
  .mode legend { margin-bottom: 4px; }
  .mode label { display: flex; gap: 8px; align-items: flex-start; }
</style>
