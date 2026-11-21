<script>
  // Approve a `clioilc login` (device flow). See backend docs/auth.md.
  import { page } from "$app/state";
  import { api, ApiError } from "$lib/api.js";
  import { session } from "$lib/session.svelte.js";
  import Login from "$lib/Login.svelte";
  import { keyCheck, sealForDevice } from "$lib/handoff.js";
  import { listPasskeys, passkeysAvailable, unlockWithPasskey } from "$lib/passkey.js";
  import { isE2EAccount, loadMe } from "$lib/team.svelte.js";

  /** @typedef {{ user_code: string, name: string, status: string, expires_at: string, e2e_pubkey: string | null }} Authorization */

  // E2E accounts: hand the new machine the data key so it asks no passphrase.
  let check = $state(/** @type {string | null} */ (null));
  let handoff = $state(true);
  let matches = $state(false);
  let passphrase = $state("");
  let usePassphrase = $state(false);
  /** @type {import("$lib/passkey.js").Passkey[]} */
  let passkeys = $state([]);
  $effect(() => {
    if (session.user) loadMe().catch(() => {});
  });
  $effect(() => {
    const pub = auth?.e2e_pubkey;
    check = null;
    if (pub && isE2EAccount()) {
      keyCheck(pub).then((c) => (check = c));
      if (passkeysAvailable()) listPasskeys().then((l) => (passkeys = l));
    }
  });
  const offerHandoff = $derived(!!check && isE2EAccount());

  /** The data key's bytes: from a passkey, else the passphrase. */
  async function dataKeyBytes() {
    if (passkeys.length && !usePassphrase) return unlockWithPasskey(passkeys);
    const { unlock } = await import("$lib/e2e.js");
    const keyring = await api("/api/v1/users/keyring/");
    try {
      return (await unlock(keyring, passphrase)).raw;
    } catch {
      throw new Error("Wrong passphrase.");
    }
  }

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
      /** @type {Record<string, string> | undefined} */
      let body;
      if (decision === "approve" && offerHandoff && handoff && auth.e2e_pubkey) {
        if (!matches) throw new Error("Confirm the key check first, or untick unlocking the terminal.");
        const dek = await dataKeyBytes();
        try {
          body = await sealForDevice(auth.e2e_pubkey, dek, auth.user_code);
        } finally {
          dek.fill(0);
        }
      }
      await api(`${path(auth.user_code)}${decision}/`, { method: "POST", body });
      phase = decision === "approve" ? "approved" : "denied";
    } catch (e) {
      error = e instanceof Error && !(e instanceof ApiError) ? (e.name === "NotAllowedError" ? "Cancelled." : e.message) : explain(e);
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
      {#if offerHandoff}
        <div class="handoff">
          <label class="check">
            <input type="checkbox" bind:checked={handoff} />
            <span>Also unlock end-to-end data on that machine, so it does not ask for the passphrase</span>
          </label>
          {#if handoff}
            <p class="small">Key check: <code class="kc">{check}</code></p>
            <label class="check">
              <input type="checkbox" bind:checked={matches} />
              <span>The terminal shows exactly this key check</span>
            </label>
            {#if !passkeys.length || usePassphrase}
              <input class="input" type="password" bind:value={passphrase} autocomplete="current-password" placeholder="Your passphrase (once, here)" aria-label="Passphrase" />
            {:else}
              <p class="muted small">
                Your passkey is asked when you allow.
                <button class="link" type="button" onclick={() => (usePassphrase = true)}>Use the passphrase instead</button>
              </p>
            {/if}
          {/if}
        </div>
      {/if}
      <div class="actions">
        <button class="btn primary" disabled={phase === "loading" || (offerHandoff && handoff && (!matches || ((!passkeys.length || usePassphrase) && !passphrase)))} onclick={() => decide("approve")}>Allow</button>
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
  .handoff { display: grid; gap: 8px; margin: 12px 0; padding: 12px; border-radius: 8px; background: var(--ghost); }
  .check { display: flex; gap: 8px; align-items: flex-start; font-size: 14px; }
  .check input { margin-top: 3px; width: auto; flex: none; padding: 0; min-width: 0; }
  .handoff .input { width: 100%; box-sizing: border-box; text-transform: none; letter-spacing: normal; font-family: inherit; font-size: 15px; }
  .small { font-size: 13px; margin: 0; }
  .kc { font-size: 14px; letter-spacing: 0.04em; }
  .link { border: 0; background: none; padding: 0; color: var(--accent); cursor: pointer; font-size: 13px; }
</style>
