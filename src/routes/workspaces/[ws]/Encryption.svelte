<script>
  // Keys of an end-to-end workspace (backend docs/e2e-teams.md): my
  // fingerprint, teammates I still have to verify, people waiting for keys
  // (manual approval after comparing fingerprints), and rotation.
  import { rowFingerprint, showFingerprint } from "$lib/team-keys.js";
  import { VerifyFirstError, approve, installKey, loadKeys, pin, team } from "$lib/team.svelte.js";
  import Unlock from "$lib/Unlock.svelte";
  import { vault } from "$lib/vault.svelte.js";

  /**
   * @typedef {{ user_id: number, username: string, fingerprint: string, ed25519_pk: string, trust: string }} Person
   * @typedef {{ id: number, slug: string, key_version: number, rotation_needed: boolean, can: { manage_members: boolean } }} Ws
   * @typedef {{ id: number, slug: string, key_version: number, rotation_needed: boolean, can: { manage_access: boolean } }} Proj
   */

  /** @type {{ slug: string, ws: Ws, projects: Proj[], onchange: () => void }} */
  let { slug, ws, projects, onchange } = $props();

  let busy = $state(false);
  let error = $state(/** @type {string | null} */ (null));
  /** People I must verify before a key can go to them (from a refused install). */
  let mustVerify = $state(/** @type {Person[]} */ ([]));
  /** People waiting for a key I can give, with locally computed fingerprints. */
  let waiting = $state(/** @type {Person[]} */ ([]));
  /** Checkboxes: "I compared this fingerprint with them". */
  let compared = $state(/** @type {Record<number, boolean>} */ ({}));

  const info = $derived(team.states[slug]);
  const rotations = $derived([
    ...(ws.rotation_needed && ws.can.manage_members ? [{ target: /** @type {const} */ ("ws"), id: ws.id, label: "workspace key" }] : []),
    ...projects
      .filter((p) => p.can.manage_access && (p.rotation_needed || p.key_version === 0))
      .map((p) => ({ target: /** @type {const} */ ("project"), id: p.id, label: `key of ${team.names[`project:${p.id}`] ?? p.slug}`, setup: p.key_version === 0 })),
  ]);

  $effect(() => {
    if (!vault.dataKey) return;
    refresh();
  });

  async function refresh() {
    try {
      const { state } = await loadKeys(slug);
      const ids = [...new Set(state.waiting.map((w) => w.user_id))];
      waiting = await Promise.all(
        ids
          .filter((id) => state.identities[String(id)])
          .map(async (id) => {
            const row = state.identities[String(id)];
            return { user_id: id, username: row.username, fingerprint: await rowFingerprint(row), ed25519_pk: row.ed25519_pk, trust: "unknown" };
          }),
      );
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load keys.";
    }
  }

  /** @param {() => Promise<unknown>} fn */
  async function act(fn) {
    busy = true;
    error = null;
    try {
      await fn();
      await refresh();
      onchange();
    } catch (e) {
      if (e instanceof VerifyFirstError) {
        mustVerify = /** @type {Person[]} */ (e.people);
        error = "Verify these people first: compare each fingerprint with them, then try again.";
      } else error = e instanceof Error ? e.message : "Something went wrong.";
    } finally {
      busy = false;
    }
  }

  /** @param {Person} p */
  const verify = (p) =>
    act(async () => {
      await pin(p);
      mustVerify = mustVerify.filter((x) => x.user_id !== p.user_id);
    });

  /** @param {Person} p */
  const give = (p) => act(() => approve(slug, p));

  /** @param {{ target: "ws" | "project", id: number }} r */
  const rotate = (r) =>
    act(async () => {
      // The name (and remote) are re-sealed under the new key, so they must be readable now.
      const name = team.names[r.target === "ws" ? `ws:${r.id}` : `project:${r.id}`] ?? (r.target === "project" ? projects.find((p) => p.id === r.id)?.slug : null);
      if (!name) throw new Error("Open the current key first (you need to hold it to rotate).");
      await installKey(slug, r.target, r.id, { name, remote: r.target === "project" ? (team.names[`remote:${r.id}`] ?? null) : undefined });
    });
</script>

<section class="card">
  <h2>Encryption</h2>
  <p class="muted small">End-to-end: names and shared data are encrypted with keys only members hold. Give keys only to people whose fingerprint you compared with them, outside clioilc (in person, or a chat you trust).</p>

  {#if !vault.dataKey}
    <Unlock title="Unlock to use this workspace's keys" />
  {:else}
    {#if team.fingerprint}
      <p class="small">Your fingerprint: <code class="fp">{showFingerprint(team.fingerprint)}</code></p>
    {/if}
    {#if error}<p class="error small" role="alert">{error}</p>{/if}
    {#each info?.problems ?? [] as p (p)}<p class="warn small">{p}</p>{/each}

    {#each [...(info?.toVerify ?? []), ...mustVerify] as p (p.user_id)}
      <div class="person">
        <p class="small">
          {#if p.trust === "changed"}<strong class="warn">@{p.username}'s key changed</strong> since you verified it.{:else}Verify <strong>@{p.username}</strong>{/if}
          — their fingerprint:
        </p>
        <code class="fp">{showFingerprint(p.fingerprint)}</code>
        <label class="small check"><input type="checkbox" bind:checked={compared[p.user_id]} /> @{p.username} sees exactly this on their Account page</label>
        <button class="btn" disabled={busy || !compared[p.user_id]} onclick={() => verify(p)}>Verify</button>
      </div>
    {/each}

    {#if waiting.length}
      <h3>Waiting for keys</h3>
      {#each waiting as p (p.user_id)}
        <div class="person">
          <p class="small"><strong>@{p.username}</strong> joined and needs the keys. Their fingerprint:</p>
          <code class="fp">{showFingerprint(p.fingerprint)}</code>
          <label class="small check"><input type="checkbox" bind:checked={compared[p.user_id]} /> I compared this with @{p.username} and it matches</label>
          <button class="btn primary" disabled={busy || !compared[p.user_id]} onclick={() => give(p)}>Give access</button>
        </div>
      {/each}
    {/if}

    {#each rotations as r (`${r.target}:${r.id}`)}
      <div class="person">
        <p class="small">
          {#if "setup" in r && r.setup}The {r.label} is not set up yet.{:else}The <strong>{r.label}</strong> must be rotated: someone who held it left. Uploads to it are paused until then.{/if}
        </p>
        <button class="btn primary" disabled={busy} onclick={() => rotate(r)}>{"setup" in r && r.setup ? "Set up key" : "Rotate now"}</button>
      </div>
    {/each}

    <p class="muted small">Workspace key v{ws.key_version}{#each projects as p (p.id)}{" · "}{team.names[`project:${p.id}`] ?? p.slug} v{p.key_version}{/each}</p>
  {/if}
</section>

<style>
  section { padding: 18px 20px; margin-bottom: 12px; }
  h2 { font-size: 16px; margin: 0 0 6px; }
  h3 { font-size: 14px; margin: 14px 0 6px; }
  .small { font-size: 13px; }
  .fp { display: inline-block; font-size: 12px; letter-spacing: 0.02em; overflow-wrap: anywhere; }
  .person { display: grid; gap: 6px; padding: 10px 12px; margin: 8px 0; border-radius: 8px; background: var(--ghost); }
  .person p { margin: 0; }
  .person .btn { justify-self: start; }
  .check { display: flex; gap: 8px; align-items: flex-start; }
  .warn { color: var(--critical); }
</style>
