<script>
  // allauth sends failed social logins here (HEADLESS_FRONTEND_URLS).
  import { page } from "$app/state";
  import Login from "$lib/Login.svelte";

  const error = page.url.searchParams.get("error");
  const message =
    error === "cancelled"
      ? "Sign-in was cancelled on GitHub."
      : `Sign-in failed${error ? ` (${error})` : ""}. Please try again.`;
</script>

<Login {message} />
