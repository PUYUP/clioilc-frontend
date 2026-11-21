<script>
  // The files a commit changed, folded: "▸ 12 files", then path and +/− per file.
  /** @type {{ commit: import("$lib/commits.js").Commit }} */
  let { commit } = $props();
  let open = $state(false);
  const total = $derived(commit.files ?? commit.changes.length);
</script>

{#if commit.changes.length}
  <button class="toggle" aria-expanded={open} onclick={() => (open = !open)}>
    <span aria-hidden="true">{open ? "▾" : "▸"}</span> {total} {total === 1 ? "file" : "files"}
  </button>
  {#if open}
    <ul class="changes">
      {#each commit.changes as f (f.path)}
        <li>
          <code title={f.path}>{f.path}</code>
          {#if f.insertions != null}
            <span class="n"><span class="add">+{f.insertions}</span> <span class="del">−{f.deletions ?? 0}</span></span>
          {:else}
            <span class="n muted">binary</span>
          {/if}
        </li>
      {/each}
      {#if total > commit.changes.length}<li class="muted">… and {total - commit.changes.length} more</li>{/if}
    </ul>
  {/if}
{/if}

<style>
  .toggle { border: 0; background: none; padding: 0; color: var(--accent); font-size: 12px; cursor: pointer; white-space: nowrap; }
  /* A folder-tree branch under the commit: ├─ path  +12 −3 */
  .changes { flex: 1 1 100%; list-style: none; margin: 0 0 2px 10px; padding: 0; display: grid; font-size: 12px; min-width: 0; }
  .changes li { position: relative; display: flex; justify-content: space-between; gap: 10px; min-width: 0; padding: 2px 0 2px 20px; }
  .changes li::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; border-left: 1px solid var(--border); }
  .changes li:last-child::before { bottom: auto; height: calc(2px + 0.75em); }
  .changes li::after { content: ""; position: absolute; left: 0; top: calc(2px + 0.75em); width: 12px; border-top: 1px solid var(--border); }
  .changes code { background: none; padding: 0; overflow-wrap: anywhere; min-width: 0; }
  .n { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .add { color: var(--good); }
  .del { color: var(--critical); }
</style>
