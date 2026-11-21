<script>
  // Export or delete everything stored for this account (backend docs/api-v1.md).
  import { API, api, ApiError } from "$lib/api.js";
  import Login from "$lib/Login.svelte";
  import { session } from "$lib/session.svelte.js";
  import { lockVault, vault } from "$lib/vault.svelte.js";
  import { ensureIdentity, isE2EAccount, loadMe, team } from "$lib/team.svelte.js";
  import { showFingerprint } from "$lib/team-keys.js";
  import Unlock from "$lib/Unlock.svelte";

  let identityError = $state(/** @type {string | null} */ (null));
  $effect(() => {
    if (session.user) loadMe().catch(() => {});
  });
  // Opening (or creating) the identity needs the unlocked data key.
  $effect(() => {
    if (!vault.dataKey || !isE2EAccount()) return;
    ensureIdentity().catch((e) => (identityError = e instanceof Error ? e.message : "Failed to load your identity."));
  });

  let exporting = $state(false);
  let exportError = $state(/** @type {string | null} */ (null));
  let deleting = $state(false);
  let deleteError = $state(/** @type {string | null} */ (null));
  let confirmText = $state("");
  let open = $state(false);

  async function download() {
    exporting = true;
    exportError = null;
    try {
      const res = await fetch(`${API}/api/v1/users/export/`, { credentials: "include" });
      if (res.status === 429) throw new Error("Too many exports in the last hour. Try again later.");
      if (!res.ok) throw new Error("Export failed.");
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "clioilc-export.json";
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      exportError = e instanceof Error ? e.message : "Export failed.";
    } finally {
      exporting = false;
    }
  }

  async function remove() {
    if (!session.user) return;
    deleting = true;
    deleteError = null;
    try {
      await api("/api/v1/users/me/", { method: "DELETE", body: { confirm: confirmText } });
      await lockVault();
      session.user = null;
      location.assign("/");
    } catch (e) {
      deleteError = e instanceof ApiError && e.code === "confirm_mismatch" ? "The username does not match." : "Failed to delete the account.";
      deleting = false;
    }
  }
</script>

{#if !session.user}
  <Login next="/account" message="Sign in to manage your account." />
{:else}
  {@const username = session.user.username}
  <div class="head">
    <h1>Account</h1>
    <p class="muted small">Signed in with GitHub as <strong>{username}</strong>.</p>
  </div>

  {#if isE2EAccount()}
    <section class="card">
      <h2>Team identity</h2>
      <p class="muted small">
        Used for end-to-end workspaces. When someone gives you access, they compare this fingerprint with you outside clioilc;
        when you give access, compare theirs. The CLI shows the same with <code>clioilc team</code>.
      </p>
      {#if !vault.dataKey}
        <Unlock title="Unlock to see your fingerprint" />
      {:else if team.fingerprint}
        <p class="small">Your fingerprint:</p>
        <code class="fp">{showFingerprint(team.fingerprint)}</code>
      {:else if identityError}
        <p class="error small">{identityError}</p>
      {:else}
        <p class="muted small">Loading…</p>
      {/if}
    </section>
  {/if}

  <section class="card">
    <h2>Export your data</h2>
    <p class="muted small">
      One JSON file with everything stored for this account: messages, tokens and costs, tool calls, devices and your
      private records. In end-to-end mode the private records stay encrypted; the file includes your keyring, so your
      passphrase still opens them.
    </p>
    <button class="btn" disabled={exporting} onclick={download}>{exporting ? "Preparing…" : "Download export"}</button>
    {#if exportError}<p class="error small" role="alert">{exportError}</p>{/if}
  </section>

  <section class="card danger-zone">
    <h2>Delete account</h2>
    <p class="muted small">
      Permanently deletes this account and everything synced to it, and disconnects every device. This cannot be undone.
      Data on your machines (<code>~/.clioilc</code>) is not touched.
    </p>
    {#if !open}
      <button class="btn" onclick={() => (open = true)}>Delete account…</button>
    {:else}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          remove();
        }}
      >
        <label for="confirm" class="small">Type <strong>{username}</strong> to confirm</label>
        <input id="confirm" class="input" autocomplete="off" spellcheck="false" bind:value={confirmText} />
        <div class="row">
          <button class="btn danger" type="submit" disabled={deleting || confirmText !== username}>
            {deleting ? "Deleting…" : "Delete everything"}
          </button>
          <button class="btn" type="button" disabled={deleting} onclick={() => ((open = false), (confirmText = ""))}>Cancel</button>
        </div>
      </form>
      {#if deleteError}<p class="error small" role="alert">{deleteError}</p>{/if}
    {/if}
  </section>
{/if}

<style>
  .head { margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0; }
  h2 { font-size: 16px; margin: 0 0 6px; }
  .small { font-size: 13px; margin: 4px 0 12px; }
  section { padding: 18px 20px; margin-bottom: 12px; }
  .danger-zone { border-color: color-mix(in srgb, var(--critical) 45%, var(--border)); }
  form { display: grid; gap: 8px; max-width: 360px; }
  label { margin: 0; }
  .input { font: inherit; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text-primary); min-width: 0; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  .btn.danger { background: var(--critical); border-color: transparent; color: #fff; }
  .btn.danger:disabled { opacity: 0.5; }
  .fp { display: block; font-size: 13px; letter-spacing: 0.03em; overflow-wrap: anywhere; margin-bottom: 4px; }
</style>
