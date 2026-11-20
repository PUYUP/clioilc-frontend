<script>
  // allauth sends failed social logins here (HEADLESS_FRONTEND_URLS).
  import { page } from "$app/state";
  import Login from "$lib/Login.svelte";

  const error = page.url.searchParams.get("error");
  const message =
    error === "cancelled"
      ? "Login dibatalkan di GitHub."
      : `Login gagal${error ? ` (${error})` : ""}. Silakan coba lagi.`;
</script>

<Login {message} />
