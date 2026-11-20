<script>
  // Machines connected with `clioilc login` (backend docs/auth.md).
  import { API, api, ApiError } from "$lib/api.js";
  import { ago, count, longLabel, timeZone } from "$lib/format.js";
  import Login from "$lib/Login.svelte";
  import { session } from "$lib/session.svelte.js";

  /** @typedef {{ id: number, name: string, created_at: string, last_used_at: string | null, message_count: number, last_message_at: string | null }} Device */

  let devices = $state(/** @type {Device[] | null} */ (null));
  let error = $state(/** @type {string | null} */ (null));
  let confirming = $state(/** @type {number | null} */ (null));
  let busy = $state(false);
  let now = $state(new Date());

  // A device that synced in the last 5 minutes is "active" (watch --sync).
  const ACTIVE_MS = 5 * 60 * 1000;

  $effect(() => {
    if (!session.user) return;
    const controller = new AbortController();
    api("/api/v1/devices/", { signal: controller.signal })
      .then((d) => (devices = d))
      .catch((e) => {
        if (e.name !== "AbortError") error = "Failed to load devices.";
      });
    const tick = setInterval(() => (now = new Date()), 30_000);
    return () => {
      controller.abort();
      clearInterval(tick);
    };
  });

  /** @param {Device} d */
  async function revoke(d) {
    busy = true;
    error = null;
    try {
      await api(`/api/v1/devices/${d.id}/`, { method: "DELETE" });
      devices = (devices ?? []).filter((x) => x.id !== d.id);
      confirming = null;
    } catch (e) {
      error = e instanceof ApiError && e.status === 404 ? "That device was already revoked." : "Failed to revoke the device.";
    } finally {
      busy = false;
    }
  }

  const when = (/** @type {string} */ iso) => {
    const d = new Date(iso);
    return { rel: ago(d, now), full: `${longLabel(d, "hour")} (${timeZone})` };
  };
  const loginCmd = `clioilc login --server ${API}`;
</script>

{#if !session.user}
  <Login next="/devices" message="Sign in to manage your devices." />
{:else}
  <div class="head">
    <h1>Devices</h1>
    <p class="muted small">Machines connected with <code>clioilc login</code>. Each one syncs its own agent logs.</p>
  </div>

  {#if error}<div class="card"><p class="error" role="alert">{error}</p></div>{/if}

  {#if devices === null}
    {#if !error}<p class="muted">Loading devices…</p>{/if}
  {:else if devices.length === 0}
    <div class="card empty">
      <p>No devices connected yet.</p>
      <p class="muted small">On the machine that runs your agents:</p>
      <pre><code>{loginCmd}
clioilc watch --sync</code></pre>
    </div>
  {:else}
    <ul class="list">
      {#each devices as d (d.id)}
        {@const used = d.last_used_at ? new Date(d.last_used_at) : null}
        {@const active = used !== null && now.getTime() - used.getTime() < ACTIVE_MS}
        <li class="card device">
          <div class="top">
            <div class="name">
              <strong>{d.name}</strong>
              {#if active}
                <span class="state on"><span class="dot" aria-hidden="true"></span> Active</span>
              {:else}
                <span class="state"><span class="dot" aria-hidden="true"></span> Idle</span>
              {/if}
            </div>
            {#if confirming === d.id}
              <div class="confirm" role="group" aria-label={`Revoke ${d.name}`}>
                <button class="btn danger" disabled={busy} onclick={() => revoke(d)}>{busy ? "Revoking…" : "Revoke"}</button>
                <button class="btn" disabled={busy} onclick={() => (confirming = null)}>Cancel</button>
              </div>
            {:else}
              <button class="btn" onclick={() => (confirming = d.id)}>Revoke…</button>
            {/if}
          </div>
          {#if confirming === d.id}
            <p class="warn small">
              <strong>{d.name}</strong> will stop syncing right away. Data it already sent stays. To connect it again,
              run <code>clioilc login</code> on that machine.
            </p>
          {/if}
          <dl>
            <div>
              <dt>Last sync</dt>
              {#if d.last_used_at}
                {@const w = when(d.last_used_at)}
                <dd title={w.full}>{w.rel}</dd>
              {:else}
                <dd class="muted">never</dd>
              {/if}
            </div>
            <div>
              <dt>Messages synced</dt>
              <dd>{count(d.message_count, "message")}</dd>
            </div>
            <div>
              <dt>Latest message</dt>
              {#if d.last_message_at}
                {@const w = when(d.last_message_at)}
                <dd title={w.full}>{w.rel}</dd>
              {:else}
                <dd class="muted">none yet</dd>
              {/if}
            </div>
            <div>
              <dt>Connected</dt>
              {#if d.created_at}
                {@const w = when(d.created_at)}
                <dd title={w.full}>{w.rel}</dd>
              {/if}
            </div>
          </dl>
        </li>
      {/each}
    </ul>
    <p class="muted small add">
      Add another machine: run <code>{loginCmd}</code> on it, then approve the code here.
    </p>
  {/if}
{/if}

<style>
  .head { margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0; }
  .small { font-size: 13px; margin: 4px 0 0; }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .device { padding: 16px 20px; }
  .top { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; }
  .name { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; min-width: 0; }
  .name strong { font-size: 16px; overflow-wrap: anywhere; }
  .state { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-secondary); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); }
  .state.on { color: var(--text-primary); }
  .state.on .dot { background: var(--good); }
  .confirm { display: flex; gap: 8px; }
  .btn.danger { background: var(--critical); border-color: transparent; color: #fff; }
  .btn.danger:hover { filter: brightness(1.08); }
  .warn { color: var(--text-secondary); margin-top: 10px; }
  dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 14px 0 0; }
  dt { font-size: 12px; color: var(--text-secondary); }
  dd { margin: 2px 0 0; font-size: 15px; font-variant-numeric: tabular-nums; }
  .empty { text-align: center; padding: 32px 20px; }
  .empty p { margin: 0 0 8px; }
  pre { display: inline-block; text-align: left; background: var(--ghost); border-radius: 8px; padding: 10px 14px; margin: 8px 0 0; overflow-x: auto; max-width: 100%; }
  .add { margin-top: 16px; }
</style>
