import { describe, expect, it } from "vitest";
import { projectLabeler, shortProject } from "./activity.js";

describe("projectLabeler", () => {
  const names = [
    "-Applications-XAMPP-xamppfiles-htdocs-www-atlanize",
    "-Volumes-SSD1-Private-clioilc",
    "-Volumes-SSD1-Private-clioilc-tracker",
    "-Volumes-SSD1-Private-snailers",
  ];
  const label = projectLabeler(names);

  it("drops the prefix most projects share", () => {
    expect(label("-Volumes-SSD1-Private-clioilc")).toBe("clioilc");
    expect(label("-Volumes-SSD1-Private-clioilc-tracker")).toBe("clioilc-tracker");
    expect(label("-Volumes-SSD1-Private-snailers")).toBe("snailers");
  });

  it("keeps other projects whole (shortened if long)", () => {
    expect(label("-Applications-XAMPP-xamppfiles-htdocs-www-atlanize")).toBe(shortProject("-Applications-XAMPP-xamppfiles-htdocs-www-atlanize"));
  });

  it("handles a single project and unknown names", () => {
    expect(projectLabeler(["-Users-me-app"])("-Users-me-app")).toBe("Users-me-app");
    expect(label(undefined)).toBe("unknown project");
  });
});
