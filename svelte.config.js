import adapter from "@sveltejs/adapter-static";

/** @type {import('@sveltejs/kit').Config} */
export default {
  kit: {
    // Single-page app: every page is rendered in the browser, because all
    // data comes from the API with the user's session cookie.
    adapter: adapter({ fallback: "index.html" }),
  },
};
