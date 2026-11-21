<script>
  // Export or delete everything stored for this account (backend docs/api-v1.md).
  import { API, api, ApiError } from "$lib/api.js";
  import Login from "$lib/Login.svelte";
  import { session } from "$lib/session.svelte.js";
  import { lockVault, vault } from "$lib/vault.svelte.js";
  import { ensureIdentity, isE2EAccount, loadMe, team } from "$lib/team.svelte.js";
  import { showFingerprint } from "$lib/team-keys.js";
  import Unlock from "$lib/Unlock.svelte";
  import { addPasskey, deletePasskey, listPasskeys, passkeysAvailable } from "$lib/passkey.js";
  import { unlockVault } from "$lib/vault.svelte.js";

  // Passkeys: unlock with Touch ID / Face ID instead of the passphrase.
  /** @type {import("$lib/passkey.js").Passkey[]} */
  let passkeys = $state([]);
  let pkPassphrase = $state("");
  let pkLabel = $state(typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "Mac" : "This device");
  let pkBusy = $state(false);
  let pkError = $state(/** @type {string | null} */ (null));
  $effect(() => {
    if (session.user && isE2EAccount() && passkeysAvailable()) listPasskeys().then((l) => (passkeys = l));
  });
  async function addOne() {
    if (!session.user) return;
    pkBusy = true;
    pkError = null;
    try {
      // The data key's bytes are needed once, to wrap them for the passkey.
      const raw = await unlockVault(pkPassphrase, { remember: !!vault.rememberedUntil, userId: session.user.id });
      if (!raw) throw new Error("Wrong passphrase.");
      try {
        await addPasskey(raw, session.user, pkLabel.trim() || "Passkey");
      } finally {
        raw.fill(0);
      }
      pkPassphrase = "";
      passkeys = await listPasskeys();
    } catch (e) {
      pkError = e instanceof Error && e.name === "NotAllowedError" ? "Cancelled." : e instanceof Error ? e.message : "Could not add the passkey.";
    } finally {
      pkBusy = false;
    }
  }
  /** @param {number} id */
  async function removeOne(id) {
    await deletePasskey(id);
    passkeys = await listPasskeys();
  }

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

  {#if isE2EAccount() && passkeysAvailable()}
    <section class="card">
      <h2>Passkeys</h2>
      <p class="muted small">
        Unlock your end-to-end data with Touch ID, Face ID or Windows Hello instead of the passphrase. A passkey synced
        to your other devices (for example in iCloud Keychain) unlocks them too. Keep the passphrase: it is the way back
        if every passkey is lost.
      </p>
      {#if passkeys.length}
        <ul class="passkeys">
          {#each passkeys as p (p.id)}
            <li><span><span aria-hidden="true">🔑</span> {p.label || "Passkey"} <span class="muted">· added {new Date(p.created_at).toLocaleDateString()}</span></span><button class="btn" onclick={() => removeOne(p.id)}>Remove</button></li>
          {/each}
        </ul>
      {/if}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          addOne();
        }}
      >
        <label for="pk-label" class="small">Name</label>
        <input id="pk-label" class="input" bind:value={pkLabel} maxlength="100" />
        <label for="pk-pass" class="small">Your passphrase (once, to set the passkey up)</label>
        <input id="pk-pass" class="input" type="password" autocomplete="current-password" bind:value={pkPassphrase} />
        <div class="row"><button class="btn primary" type="submit" disabled={pkBusy || !pkPassphrase}>{pkBusy ? "Waiting for the passkey…" : "Add a passkey on this device"}</button></div>
      </form>
      {#if pkError}<p class="error small" role="alert">{pkError}</p>{/if}
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
  .passkeys { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 6px; }
  .passkeys li { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 14px; }
  .danger-zone { border-color: color-mix(in srgb, var(--critical) 45%, var(--border)); }
  form { display: grid; gap: 8px; max-width: 360px; }
  label { margin: 0; }
  .input { font: inherit; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text-primary); min-width: 0; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  .btn.danger { background: var(--critical); border-color: transparent; color: #fff; }
  .btn.danger:disabled { opacity: 0.5; }
  .fp { display: block; font-size: 13px; letter-spacing: 0.03em; overflow-wrap: anywhere; margin-bottom: 4px; }
</style>
