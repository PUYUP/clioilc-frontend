<script>
  // An invitation link: /invite/<token>. Only the invited GitHub account
  // can accept (backend docs/workspaces.md, "Undangan").
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api, ApiError } from "$lib/api.js";
  import { ago } from "$lib/format.js";
  import Login from "$lib/Login.svelte";
  import { refreshWorkspaces, setScope } from "$lib/scope.svelte.js";
  import { logout, session } from "$lib/session.svelte.js";

  /** @typedef {{ workspace: { slug: string, name: string }, project: { slug: string, name: string } | null, role: string, github_login: string, invited_by: string | null, state: string, expires_at: string, for_me: boolean }} Invite */

  const token = $derived(page.params.token ?? "");
  let inv = $state(/** @type {Invite | null} */ (null));
  let missing = $state(false);
  let error = $state(/** @type {string | null} */ (null));
  let busy = $state(false);

  $effect(() => {
    if (!session.user || !token) return;
    const controller = new AbortController();
    api(`/api/v1/workspaces/invitations/${encodeURIComponent(token)}/`, { signal: controller.signal })
      .then((d) => (inv = d))
      .catch((e) => {
        if (e.name !== "AbortError") missing = true;
      });
    return () => controller.abort();
  });

  /** @param {"accept" | "decline"} action */
  async function answer(action) {
    if (!inv) return;
    busy = true;
    error = null;
    try {
      inv = { ...inv, ...(await api(`/api/v1/workspaces/invitations/${encodeURIComponent(token)}/${action}/`, { method: "POST" })) };
      if (action === "accept" && inv) {
        await refreshWorkspaces();
        setScope(inv.workspace.slug);
        goto(`/workspaces/${inv.workspace.slug}`);
      }
    } catch (e) {
      error = e instanceof ApiError && e.code === "already_member" ? "You already have access." : "This invitation can no longer be used.";
    } finally {
      busy = false;
    }
  }

  const STATE_TEXT = /** @type {Record<string, string>} */ ({
    accepted: "This invitation was already accepted.",
    declined: "This invitation was declined.",
    revoked: "This invitation was revoked. Ask for a new link.",
    expired: "This invitation expired. Ask for a new link.",
  });
</script>

{#if !session.user}
  <Login next={`/invite/${token}`} message="Sign in with GitHub to answer this invitation." />
{:else if missing}
  <div class="card box"><h1>Invitation not found</h1><p class="muted">The link is wrong or incomplete.</p></div>
{:else if !inv}
  <p class="muted">Loading…</p>
{:else}
  <div class="card box">
    <p class="muted small">{inv.invited_by ? `@${inv.invited_by} invited @${inv.github_login}` : `Invitation for @${inv.github_login}`}</p>
    <h1>
      {#if inv.project}Join <strong>{inv.project.name}</strong> in {inv.workspace.name}{:else}Join <strong>{inv.workspace.name}</strong>{/if}
    </h1>
    <p>as <strong>{inv.role}</strong></p>
    <p class="muted small">
      Members see the team's usage, costs and tool actions for folders linked with <code>clioilc link</code>. Your prompts
      and replies stay private unless you choose to share them per project.
    </p>
    {#if inv.state !== "pending"}
      <p class="error">{STATE_TEXT[inv.state] ?? "This invitation can no longer be used."}</p>
    {:else if !inv.for_me}
      <p class="error">This invitation is for @{inv.github_login}, but you are signed in as @{session.user.username}.</p>
      <button class="btn" onclick={logout}>Sign out</button>
    {:else}
      <p class="muted small">Expires {ago(new Date(inv.expires_at))}.</p>
      <div class="actions">
        <button class="btn primary" disabled={busy} onclick={() => answer("accept")}>Accept</button>
        <button class="btn" disabled={busy} onclick={() => answer("decline")}>Decline</button>
      </div>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
{/if}

<style>
  .box { max-width: 520px; margin: 24px auto; padding: 24px; }
  h1 { font-size: 20px; margin: 4px 0; font-weight: 500; }
  .small { font-size: 13px; }
  .actions { display: flex; gap: 8px; margin-top: 12px; }
</style>
