import { describe as suite, expect, it } from "vitest";
import { describe } from "./audit.js";

/** @param {Partial<import("./audit.js").AuditEvent>} e */
const ev = (e) => describe({ id: 1, actor: "ann", target: null, project: null, data: {}, created_at: "", action: "", ...e });

suite("audit sentences", () => {
  it("covers the common events", () => {
    expect(ev({ action: "member.role", target: "bob", data: { old: "member", new: "viewer", links_dropped: 2 } })).toBe(
      "@ann changed @bob's role from member to viewer (2 linked folders removed)",
    );
    expect(ev({ action: "invite.create", target: "bob", project: "API", data: { role: "viewer" } })).toBe(
      "@ann invited @bob as viewer to “API”",
    );
    expect(ev({ action: "link.create", project: "API", data: { history: false } })).toBe(
      "@ann linked a folder to “API”, from now on",
    );
    expect(ev({ action: "project.update", project: "API", data: { changes: { name: {}, git_remote: {} } } })).toBe(
      "@ann changed the name and git remote of “API”",
    );
    expect(ev({ action: "member.leave", actor: null })).toBe("someone left the workspace");
    expect(ev({ action: "future.thing" })).toBe("@ann: future.thing");
  });
});
