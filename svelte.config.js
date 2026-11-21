import adapter from "@sveltejs/adapter-static";
import { loadEnv } from "vite";

// The API origin goes into the Content Security Policy at build time.
const env = loadEnv(process.env.NODE_ENV === "development" ? "development" : "production", process.cwd(), "PUBLIC_");
const api = new URL(env.PUBLIC_API_URL ?? "http://localhost:8000").origin;

/** @type {import('@sveltejs/kit').Config} */
export default {
  kit: {
    // Single-page app: every page is rendered in the browser, because all
    // data comes from the API with the user's session cookie.
    adapter: adapter({ fallback: "index.html" }),
    // The unlocked data key and team identities live in this page's memory,
    // so only our own scripts may run and data may only go to our API (an
    // injected script cannot send keys elsewhere). Shipped as a <meta> tag
    // in the static HTML; SvelteKit adds the hash of its inline bootstrap
    // script. frame-ancestors cannot be set by <meta>: see static/_headers.
    csp: {
      mode: "hash",
      directives: {
        "default-src": ["none"],
        // wasm-unsafe-eval: Argon2id (hash-wasm) compiles WebAssembly; it does not allow eval().
        "script-src": ["self", "wasm-unsafe-eval"],
        // Inline styles (style attributes, Svelte) cannot run code; img-src
        // and font-src below stop CSS from loading anything off-site.
        "style-src": ["self", "unsafe-inline"],
        "img-src": ["self", "data:", "https://avatars.githubusercontent.com"],
        "font-src": ["self"],
        "connect-src": ["self", api],
        "manifest-src": ["self"],
        // Login is a form POST to the API, which redirects to GitHub.
        "form-action": ["self", api, "https://github.com"],
        "base-uri": ["none"],
        "object-src": ["none"],
      },
    },
  },
};
