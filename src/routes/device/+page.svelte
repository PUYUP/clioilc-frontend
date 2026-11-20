<script>
  // Approve a `clioilc login` (device flow). See backend docs/auth.md.
  import { page } from "$app/state";
  import { api, ApiError } from "$lib/api.js";
  import { session } from "$lib/session.svelte.js";
  import Login from "$lib/Login.svelte";

  /** @typedef {{ user_code: string, name: string, status: string, expires_at: string }} Authorization */

  let code = $state(page.url.searchParams.get("code") ?? "");
  /** @type {Authorization | null} */
  let auth = $state(null);
  /** @type {"idle" | "loading" | "approved" | "denied"} */
  let phase = $state("idle");
  /** @type {string | null} */
  let error = $state(null);

  const path = (/** @type {string} */ c) => `/api/v1/devices/authorize/${encodeURIComponent(c.trim())}/`;

  /** @param {unknown} e */
  function explain(e) {
    if (e instanceof ApiError && e.status === 404) return "Code not found. Check the code in your terminal.";
    if (e instanceof ApiError && e.status === 410)
      return "This code has expired or was already used. Run `clioilc login` again.";
    return "Something went wrong. Please try again.";
  }

  async function lookup() {
    if (!code.trim()) return;
    phase = "loading";
    error = null;
    auth = null;
    try {
      auth = await api(path(code));
    } catch (e) {
      error = explain(e);
    } finally {
      phase = "idle";
    }
  }

  /** @param {"approve" | "deny"} decision */
  async function decide(decision) {
    if (!auth) return;
    phase = "loading";
    error = null;
    try {
      await api(`${path(auth.user_code)}${decision}/`, { method: "POST" });
      phase = decision === "approve" ? "approved" : "denied";
    } catch (e) {
      error = explain(e);
      phase = "idle";
    }
  }

  $effect(() => {
    // Code from the link printed by `clioilc login`: look it up right away.
    if (session.user && code && !auth && phase === "idle" && !error) lookup();
  });
</script>

{#if !session.user}
  <Login
    next={page.url.pathname + page.url.search}
    message="Sign in to connect a device to your account."
  />
{:else if phase === "approved"}
  <div class="card box">
    <h1>Device connected</h1>
    <p class="muted">
      <strong>{auth?.name}</strong> can now send data. Go back to your terminal; <code>clioilc login</code>
      finishes on its own.
    </p>
    <a class="btn" href="/">Go to dashboard</a>
  </div>
{:else if phase === "denied"}
  <div class="card box">
    <h1>Request denied</h1>
    <p class="muted">That device was not given access. You can close this page.</p>
  </div>
{:else}
  <div class="card box">
    <h1>Connect a device</h1>
    {#if !auth}
      <p class="muted">Enter the code shown by <code>clioilc login</code> in your terminal.</p>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          lookup();
        }}
      >
        <label class="sr" for="code">Device code</label>
        <input
          id="code"
          bind:value={code}
          placeholder="ABCD-EFGH"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
        />
        <button class="btn primary" disabled={phase === "loading" || !code.trim()}>Continue</button>
      </form>
    {:else}
      <p>
        <strong class="device">{auth.name}</strong> is asking for access to send agent activity to the account
        <strong>{session.user.username}</strong>.
      </p>
      <p class="muted">
        Code <code>{auth.user_code}</code>. Only allow this if you just ran
        <code>clioilc login</code>.
      </p>
      <div class="actions">
        <button class="btn primary" disabled={phase === "loading"} onclick={() => decide("approve")}>Allow</button>
        <button class="btn" disabled={phase === "loading"} onclick={() => decide("deny")}>Deny</button>
      </div>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
{/if}

<style>
  .box { max-width: 480px; margin: 48px auto; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  form, .actions { display: flex; gap: 8px; margin-top: 16px; }
  input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--page);
    color: var(--text-primary);
  }
  .device { font-size: 17px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
