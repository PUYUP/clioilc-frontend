<script>
  // Unlock end-to-end data: a passkey (Touch ID, Face ID) when the account
  // has one, else the passphrase. The key never leaves this browser.
  import { onMount } from "svelte";
  import { listPasskeys, passkeysAvailable, unlockWithPasskey } from "$lib/passkey.js";
  import { session } from "$lib/session.svelte.js";
  import { REMEMBER_DAYS, unlockVault, unlockVaultWith, vault } from "$lib/vault.svelte.js";

  let { title = "Unlock end-to-end data", note = "" } = $props();
  let passphrase = $state("");
  let remember = $state(true);
  /** @type {import("$lib/passkey.js").Passkey[]} */
  let passkeys = $state([]);
  let usePassphrase = $state(false);
  let passkeyError = $state(/** @type {string | null} */ (null));
  let passkeyBusy = $state(false);

  onMount(async () => {
    if (passkeysAvailable()) passkeys = await listPasskeys();
  });

  async function withPasskey() {
    passkeyBusy = true;
    passkeyError = null;
    try {
      const raw = await unlockWithPasskey(passkeys);
      await unlockVaultWith(raw, { remember, userId: session.user?.id });
      raw.fill(0);
    } catch (e) {
      passkeyError = e instanceof Error && e.name === "NotAllowedError" ? "Cancelled." : e instanceof Error ? e.message : "The passkey did not unlock.";
    } finally {
      passkeyBusy = false;
    }
  }
</script>

<div class="card unlock">
  <h2>{title}</h2>
  {#if passkeys.length && !usePassphrase}
    <p class="muted small">{note || "Use your passkey. The key never leaves this browser."}</p>
    <div class="row">
      <button class="btn primary" disabled={passkeyBusy} onclick={withPasskey}>
        <span aria-hidden="true">🔑</span> {passkeyBusy ? "Waiting for the passkey…" : "Unlock with passkey"}
      </button>
      <button class="link small" onclick={() => (usePassphrase = true)}>Use the passphrase instead</button>
    </div>
    {#if passkeyError}<p class="error small" role="alert">{passkeyError}</p>{/if}
  {:else}
    <p class="muted small">
      {note || "Enter the passphrase you chose during clioilc login. The key never leaves this browser."}
    </p>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        unlockVault(passphrase, { remember, userId: session.user?.id }).then(() => (passphrase = ""));
      }}
    >
      <input class="input" type="password" bind:value={passphrase} autocomplete="current-password" placeholder="Passphrase" aria-label="Passphrase" />
      <button class="btn primary" disabled={vault.busy || !passphrase}>{vault.busy ? "Unlocking…" : "Unlock"}</button>
    </form>
    {#if vault.error}<p class="error small" role="alert">{vault.error}</p>{/if}
    {#if passkeys.length}<button class="link small" onclick={() => (usePassphrase = false)}>Use a passkey instead</button>{/if}
  {/if}
  <label class="remember small">
    <input type="checkbox" bind:checked={remember} />
    Remember on this device for {REMEMBER_DAYS} days <span class="muted">(only on your own device; Lock forgets it)</span>
  </label>
</div>

<style>
  .unlock { padding: 16px 20px; margin-bottom: 12px; }
  h2 { font-size: 16px; margin: 0 0 4px; }
  .small { font-size: 13px; }
  form, .row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; align-items: center; }
  form .input { flex: 1 1 200px; }
  .remember { display: flex; gap: 6px; align-items: flex-start; color: var(--text-secondary); margin-top: 10px; }
  .remember input { margin-top: 2px; }
  .link { border: 0; background: none; padding: 4px 0; color: var(--accent); cursor: pointer; }
</style>
