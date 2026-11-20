// Markdown for agent replies and thinking. The text comes from agent logs,
// so it is untrusted: raw HTML is shown as text, images are not loaded,
// only http(s) links become links, and the result is sanitized again.
import DOMPurify from "dompurify";
import { Marked } from "marked";

/** @param {string} s */
const escape = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    // `<tool_use_error>` and friends stay visible as text.
    html({ text }) {
      return escape(text);
    },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (/^https?:\/\//i.test(href)) {
        const t = title ? ` title="${escape(title)}"` : "";
        return `<a href="${escape(href)}"${t} target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
      }
      // Workspace file links (src/x.rs#L10) cannot open from the browser.
      return `<span class="md-ref" title="${escape(href)}">${label}</span>`;
    },
    image({ text }) {
      return `<span class="md-ref">[image: ${escape(text)}]</span>`;
    },
  },
});

/** @param {string} text @returns {string} sanitized HTML */
export function renderMarkdown(text) {
  const html = /** @type {string} */ (marked.parse(text, { async: false }));
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["img", "style", "form", "input", "button", "iframe"],
  });
}
