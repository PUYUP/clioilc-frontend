/// <reference types="vitest/config" />
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  // Must match the backend's FRONTEND_URL / CSRF_TRUSTED_ORIGINS.
  server: { host: "localhost", port: 5173, strictPort: true },
  test: { include: ["src/**/*.test.js"] },
});
