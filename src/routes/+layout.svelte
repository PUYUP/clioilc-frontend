<script>
  import "../app.css";
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { session, refreshSession, logout } from "$lib/session.svelte.js";
  import { scope, refreshWorkspaces, setScope } from "$lib/scope.svelte.js";
  import { decryptNames, loadKeys, loadMe, team, wsLabel } from "$lib/team.svelte.js";
  import { vault } from "$lib/vault.svelte.js";

  let { children } = $props();
  onMount(refreshSession);

  $effect(() => {
    if (session.user) refreshWorkspaces().then(() => loadMe().catch(() => {}));
  });

  // E2E workspace names are sealed: open them once the passphrase is unlocked.
  $effect(() => {
    if (!vault.dataKey || team.me?.enc_mode !== "e2e") return;
    for (const w of scope.workspaces) {
      if (w.enc_mode !== "e2e" || !w.key_version) continue;
      loadKeys(w.slug)
        .then(() => decryptNames(w))
        .catch(() => {});
    }
  });

  /** @param {Event & { currentTarget: HTMLSelectElement }} e */
  function pickScope(e) {
    const value = e.currentTarget.value;
    if (value === "__manage") {
      e.currentTarget.value = scope.workspace ?? "";
      goto("/workspaces");
      return;
    }
    setScope(value || null);
  }
</script>

<header>
  <div class="wrap bar">
    <div class="left">
      <div class="brand-row">
        <a class="brand" href="/">clioilc</a>
        {#if session.user && scope.loaded}
          <select class="scope" aria-label="Show data of" value={scope.workspace ?? ""} onchange={pickScope}>
            <option value="">Personal</option>
            {#each scope.workspaces as w (w.slug)}
              <option value={w.slug}>{wsLabel(w)}{w.enc_mode === "e2e" ? " 🔒" : ""}</option>
            {/each}
            <option value="__manage">{scope.workspaces.length ? "Manage workspaces…" : "Create a workspace…"}</option>
          </select>
        {/if}
      </div>
      {#if session.user}
        <nav>
          <a href="/" aria-current={page.url.pathname === "/" ? "page" : undefined}>Overview</a>
          <a href="/activity" aria-current={page.url.pathname.startsWith("/activity") ? "page" : undefined}>Activity</a>
          <a href="/digest" aria-current={page.url.pathname.startsWith("/digest") ? "page" : undefined}>Digest</a>
          <a href="/devices" aria-current={page.url.pathname.startsWith("/devices") ? "page" : undefined}>Devices</a>
        </nav>
      {/if}
    </div>
    {#if session.user}
      <div class="user">
        <a class="username" href="/account" aria-current={page.url.pathname.startsWith("/account") ? "page" : undefined} title="Account">{session.user.username}</a>
        <button class="btn" onclick={logout}>Sign out</button>
      </div>
    {/if}
  </div>
</header>

<main class="wrap">
  {#if session.loading}
    <p class="muted">Loading…</p>
  {:else if session.error}
    <div class="card"><p class="error">{session.error}</p><p class="muted">Make sure the backend is running and <code>PUBLIC_API_URL</code> is correct.</p></div>
  {:else}
    {@render children()}
  {/if}
</main>

<style>
  .wrap { max-width: 1040px; margin: 0 auto; padding: 0 16px; }
  header { border-bottom: 1px solid var(--border); background: var(--surface); }
  .bar { display: flex; align-items: center; justify-content: space-between; height: 56px; }
  .brand { font-weight: 650; text-decoration: none; letter-spacing: -0.01em; }
  .brand-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .scope { font: inherit; font-size: 13px; padding: 4px 6px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text-primary); max-width: 160px; text-overflow: ellipsis; }
  .left { display: flex; align-items: center; gap: 20px; min-width: 0; }
  nav { display: flex; gap: 4px; }
  nav a { text-decoration: none; color: var(--text-secondary); padding: 6px 10px; border-radius: 8px; font-size: 14px; }
  nav a:hover { background: var(--ghost); }
  nav a[aria-current="page"] { color: var(--text-primary); font-weight: 600; background: var(--ghost); }
  .user { display: flex; align-items: center; gap: 12px; }
  .user .btn { white-space: nowrap; }
  .username { color: var(--text-secondary); text-decoration: none; font-size: 14px; padding: 6px 8px; border-radius: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .username:hover, .username[aria-current="page"] { background: var(--ghost); color: var(--text-primary); }
  @media (max-width: 520px) {
    /* Three rows: brand + sign out, the scope picker, then the nav. */
    .bar {
      display: grid;
      grid-template-columns: 1fr auto;
      grid-template-areas: "brand user" "scope scope" "nav nav";
      height: auto;
      padding-top: 8px;
      padding-bottom: 6px;
      row-gap: 4px;
    }
    .left { display: contents; }
    /* The row's children join the grid: brand and the scope picker get their own cells. */
    .brand-row { display: contents; }
    .brand { grid-area: brand; align-self: center; }
    .scope { grid-area: scope; max-width: none; width: 100%; }
    nav { grid-area: nav; margin-left: -8px; }
    .user { grid-area: user; }
    .username { max-width: 40vw; }
    .user .btn { padding: 6px 10px; font-size: 13px; }
  }
  main.wrap { padding-top: 24px; padding-bottom: 48px; }
</style>
