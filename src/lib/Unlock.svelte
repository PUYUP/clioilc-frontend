<script>
  // Passphrase prompt for end-to-end data (the key stays in this tab only).
  import { session } from "$lib/session.svelte.js";
  import { REMEMBER_DAYS, unlockVault, vault } from "$lib/vault.svelte.js";

  let { title = "Unlock end-to-end data", note = "" } = $props();
  let passphrase = $state("");
  let remember = $state(true);
</script>

<div class="card unlock">
  <h2>{title}</h2>
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
    <label class="remember small">
      <input type="checkbox" bind:checked={remember} />
      Remember on this device for {REMEMBER_DAYS} days <span class="muted">(only on your own device; Lock forgets it)</span>
    </label>
  </form>
  {#if vault.error}<p class="error small" role="alert">{vault.error}</p>{/if}
</div>

<style>
  .unlock { padding: 16px 20px; margin-bottom: 12px; }
  h2 { font-size: 16px; margin: 0 0 4px; }
  .small { font-size: 13px; }
  form { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  form .input { flex: 1 1 200px; }
  .remember { flex: 1 1 100%; display: flex; gap: 6px; align-items: flex-start; color: var(--text-secondary); }
  .remember input { margin-top: 2px; }
</style>
