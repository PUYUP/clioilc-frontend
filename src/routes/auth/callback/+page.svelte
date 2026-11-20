<script>
  // GitHub -> backend -> here. The session cookie is set by now.
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { session, refreshSession, safeNext } from "$lib/session.svelte.js";

  let failed = $state(false);
  onMount(async () => {
    await refreshSession();
    if (session.user) goto(safeNext(page.url.searchParams.get("next")), { replaceState: true });
    else failed = true;
  });
</script>

{#if failed}
  <div class="card"><p class="error">Login tidak selesai.</p><a class="btn" href="/">Coba lagi</a></div>
{:else}
  <p class="muted">Menyelesaikan login…</p>
{/if}
