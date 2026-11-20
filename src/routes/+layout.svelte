<script>
  import "../app.css";
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { session, refreshSession, logout } from "$lib/session.svelte.js";

  let { children } = $props();
  onMount(refreshSession);
</script>

<header>
  <div class="wrap bar">
    <div class="left">
      <a class="brand" href="/">clioilc</a>
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
        <span class="muted username">{session.user.username}</span>
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
  .left { display: flex; align-items: center; gap: 20px; min-width: 0; }
  nav { display: flex; gap: 4px; }
  nav a { text-decoration: none; color: var(--text-secondary); padding: 6px 10px; border-radius: 8px; font-size: 14px; }
  nav a:hover { background: var(--ghost); }
  nav a[aria-current="page"] { color: var(--text-primary); font-weight: 600; background: var(--ghost); }
  .user { display: flex; align-items: center; gap: 12px; }
  .user .btn { white-space: nowrap; }
  @media (max-width: 520px) {
    /* Two rows: brand + sign out, then the nav. */
    .bar {
      display: grid;
      grid-template-columns: 1fr auto;
      grid-template-areas: "brand user" "nav nav";
      height: auto;
      padding-top: 8px;
      padding-bottom: 6px;
      row-gap: 4px;
    }
    .left { display: contents; }
    .brand { grid-area: brand; align-self: center; }
    nav { grid-area: nav; margin-left: -8px; }
    .user { grid-area: user; }
    .username { display: none; }
    .user .btn { padding: 6px 10px; font-size: 13px; }
  }
  main.wrap { padding-top: 24px; padding-bottom: 48px; }
</style>
