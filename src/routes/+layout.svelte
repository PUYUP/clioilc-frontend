<script>
  import "../app.css";
  import { onMount } from "svelte";
  import { session, refreshSession, logout } from "$lib/session.svelte.js";

  let { children } = $props();
  onMount(refreshSession);
</script>

<header>
  <div class="wrap bar">
    <a class="brand" href="/">clioilc</a>
    {#if session.user}
      <div class="user">
        <span class="muted">{session.user.username}</span>
        <button class="btn" onclick={logout}>Keluar</button>
      </div>
    {/if}
  </div>
</header>

<main class="wrap">
  {#if session.loading}
    <p class="muted">Memuat…</p>
  {:else if session.error}
    <div class="card"><p class="error">{session.error}</p><p class="muted">Pastikan backend berjalan dan <code>PUBLIC_API_URL</code> benar.</p></div>
  {:else}
    {@render children()}
  {/if}
</main>

<style>
  .wrap { max-width: 1040px; margin: 0 auto; padding: 0 16px; }
  header { border-bottom: 1px solid var(--border); background: var(--surface); }
  .bar { display: flex; align-items: center; justify-content: space-between; height: 56px; }
  .brand { font-weight: 650; text-decoration: none; letter-spacing: -0.01em; }
  .user { display: flex; align-items: center; gap: 12px; }
  main.wrap { padding-top: 24px; padding-bottom: 48px; }
</style>
