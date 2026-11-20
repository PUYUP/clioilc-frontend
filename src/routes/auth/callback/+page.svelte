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
  <div class="card"><p class="error">Sign-in did not complete.</p><a class="btn" href="/">Try again</a></div>
{:else}
  <p class="muted">Finishing sign-in…</p>
{/if}
