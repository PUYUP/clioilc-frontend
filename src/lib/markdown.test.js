// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown.js";

/** @param {string} html */
const dom = (html) => {
  const box = document.createElement("div");
  box.innerHTML = html;
  return box;
};

describe("renderMarkdown", () => {
  it("renders common markdown", () => {
    const box = dom(renderMarkdown("## Title\n\n- **bold** and `code`\n- two"));
    expect(box.querySelector("h2")?.textContent).toBe("Title");
    expect(box.querySelectorAll("li")).toHaveLength(2);
    expect(box.querySelector("strong")?.textContent).toBe("bold");
    expect(box.querySelector("code")?.textContent).toBe("code");
  });

  it("shows raw HTML as text and never runs it", () => {
    const box = dom(renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(2)> <tool_use_error>boom</tool_use_error>'));
    expect(box.querySelector("script, img, iframe")).toBeNull();
    expect(box.textContent).toContain("<tool_use_error>boom</tool_use_error>");
  });

  it("only makes http(s) links clickable", () => {
    const box = dom(renderMarkdown("[x](javascript:alert(3)) [ok](https://example.com) [file](src/a.rs#L3) ![p](https://example.com/t.png)"));
    const links = [...box.querySelectorAll("a")];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://example.com");
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[0].getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect([...box.querySelectorAll(".md-ref")].map((s) => s.getAttribute("title"))).toContain("src/a.rs#L3");
    expect(box.querySelector("img")).toBeNull();
    expect(box.textContent).toContain("[image: p]");
  });
});
