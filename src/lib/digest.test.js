import { describe, expect, it } from "vitest";
import { buildDigest, commitMessage, duration, isProjectFile, projectRoot, promptLine } from "./digest.js";

describe("commitMessage", () => {
  it.each([
    [
      "Stage everything: git add -A && git commit -q -F - <<'EOF'\nInitial commit: snailstamp API\n\nBody",
      "Initial commit: snailstamp API",
    ],
    ['Commit: git commit -m "Fix login redirect" && git push', "Fix login redirect"],
    ["Commit: git commit -am 'Bump version to 1.2'", "Bump version to 1.2"],
    ['Commit: git commit -m "Say \\"hi\\" properly"', 'Say "hi" properly'],
    ["Commit: git commit -m \"$(cat <<'EOF'\nAdd devices page\n\nBody\nEOF\n)\"", "Add devices page"],
    ["Commit: git -C repo commit -q -F - <<EOF\nShort subject\nEOF", "Short subject"],
  ])("reads %j", (summary, want) => {
    expect(commitMessage(summary)).toBe(want);
  });

  it("ignores other git commands", () => {
    expect(commitMessage("Show status: git status && git log --oneline")).toBeNull();
    expect(commitMessage("Run tests: cargo test -q")).toBeNull();
  });
});

describe("promptLine", () => {
  it("keeps the first meaningful line", () => {
    expect(promptLine("\n\nfirst line\nsecond")).toBe("first line");
    expect(promptLine("x".repeat(200))).toHaveLength(160);
  });
  it("drops harness noise", () => {
    for (const t of ["<command-name>/clear</command-name>", "[Request interrupted by user]", "This session is being continued from…", "Caveat: …"]) {
      expect(promptLine(t)).toBeNull();
    }
  });
});

describe("files", () => {
  it("finds the project folder from the Claude project name", () => {
    expect(projectRoot("-Volumes-SSD1-Private-clioilc-tracker", ["/Volumes/SSD1/Private/clioilc/tracker/core/src/a.rs"])).toBe(
      "/Volumes/SSD1/Private/clioilc/tracker/",
    );
    expect(projectRoot("-Volumes-SSD1-Private-snailers", ["/Volumes/SSD1/Private/other/a.rs"])).toBeNull();
  });
  it("skips scratch space and ~/.claude", () => {
    expect(isProjectFile("/Volumes/SSD1/Private/app/src/main.rs")).toBe(true);
    expect(isProjectFile("/Users/me/.claude/projects/-x/memory/note.md")).toBe(false);
    expect(isProjectFile("/private/tmp/claude-502/x/scratchpad/a.py")).toBe(false);
    expect(isProjectFile("relative/path.txt")).toBe(false);
  });
});

describe("duration", () => {
  it("formats minutes and hours", () => {
    expect(duration(0)).toBe("<1m");
    expect(duration(35 * 60000)).toBe("35m");
    expect(duration(125 * 60000)).toBe("2h 05m");
  });
});

describe("buildDigest", () => {
  /** @param {number} min */
  const t = (min) => new Date(Date.UTC(2026, 10, 20, 9, min));
  const base = { projectId: "p1", sessionId: "s1", isSubagent: false, status: null };
  /** @type {any} */
  const day = {
    projects: new Map([["p1", "-Volumes-SSD1-Private-app"]]),
    messages: new Map([
      ["m1", { cost_usd: 0.5, status: "ok" }],
      ["m2", { cost_usd: 0.25, status: "overloaded" }],
    ]),
    items: [
      { ...base, id: "1", ts: t(0), kind: "prompt", text: "add a login page" },
      { ...base, id: "2", ts: t(1), kind: "text", text: "On it.", messageId: "m1" },
      { ...base, id: "3", ts: t(2), kind: "tool", text: "/Volumes/SSD1/Private/app/src/login.ts", messageId: "m1", tool: { name: "Write", status: "ok", error: null } },
      { ...base, id: "4", ts: t(3), kind: "tool", text: "/Volumes/SSD1/Private/app/src/login.ts", messageId: "m1", tool: { name: "Edit", status: "ok", error: null } },
      { ...base, id: "5", ts: t(4), kind: "tool", text: 'Commit: git commit -m "Add login page" && git push', messageId: "m1", tool: { name: "Bash", status: "ok", error: null } },
      { ...base, id: "6", ts: t(5), kind: "tool", text: "Run tests: npm test", messageId: "m2", tool: { name: "Bash", status: "error", error: "1 failed" } },
      // 40 minutes later: idle gap, not active time.
      { ...base, id: "7", ts: t(45), kind: "text", text: "Done.", messageId: "m2" },
    ],
  };

  it("summarises a project's day", () => {
    const { projects, totals } = buildDigest(day);
    expect(projects).toHaveLength(1);
    const p = projects[0];
    expect(p.prompts.map((x) => x.text)).toEqual(["add a login page"]);
    expect(p.prompts[0].ts).toBeInstanceOf(Date);
    expect(p.commits.map((c) => c.message)).toEqual(["Add login page"]);
    expect(p.pushed).toBe(true);
    // The commit came from the command only (no file list): nothing is claimed uncommitted.
    expect(p.uncommitted).toBeNull();
    expect(p.filesChanged).toBe(1);
    expect(p.toolErrors).toBe(1);
    expect(p.messageErrors).toBe(1);
    expect(p.failingTools).toEqual([{ name: "Bash", count: 1 }]);
    expect(p.costUsd).toBeCloseTo(0.75);
    expect(p.activeMs).toBe(5 * 60000);
    expect(totals).toMatchObject({ commits: 1, files: 1, errors: 2, sessions: 1 });
  });
});


describe("digest commits", () => {
  it("uses the commits the tracker found, with their hash", () => {
    const ts = new Date("2026-11-20T03:00:00Z");
    const commit = { hash: "3c514b0" + "a".repeat(33), branch: "main", subject: "Fix login", remote: "github.com/acme/pay" };
    const items = [
      { id: "p", ts, kind: "prompt", text: "fix it", projectId: "p1", sessionId: "s", isSubagent: false, status: null },
      {
        id: "t", ts, kind: "tool", text: "Commit: git commit -qm 'Fix login'", projectId: "p1", sessionId: "s", isSubagent: false, status: "ok",
        tool: { name: "Bash", status: "ok", error: null, commits: [commit] },
      },
    ];
    const { projects } = buildDigest({ items: /** @type {any} */ (items), projects: new Map([["p1", "-w-pay"]]), messages: new Map() });
    expect(projects[0].commits).toEqual([{ message: "Fix login", ts, commit }]);
  });
});


describe("newest first", () => {
  it("orders prompts and commits with the latest on top", () => {
    const at = (/** @type {number} */ m) => new Date(Date.UTC(2026, 10, 20, 3, m));
    const prompt = (/** @type {string} */ text, /** @type {number} */ m) => ({ id: text, ts: at(m), kind: "prompt", text, projectId: "p1", sessionId: "s", isSubagent: false, status: null });
    const commitAt = (/** @type {string[]} */ subjects, /** @type {number} */ m) => ({
      id: subjects.join(), ts: at(m), kind: "tool", text: "git commit", projectId: "p1", sessionId: "s", isSubagent: false, status: "ok",
      tool: { name: "Bash", status: "ok", error: null, commits: subjects.map((s) => ({ hash: s.padEnd(40, "a"), subject: s, changes: [] })) },
    });
    const p = buildDigest({
      items: /** @type {any} */ ([prompt("first", 1), commitAt(["a", "b"], 2), prompt("second", 3), commitAt(["c"], 4)]),
      projects: new Map([["p1", "-w-app"]]),
      messages: new Map(),
    }).projects[0];
    expect(p.prompts.map((x) => x.text)).toEqual(["second", "first"]);
    expect(p.commits.map((c) => c.message)).toEqual(["c", "b", "a"]);
  });
});

describe("files not committed", () => {
  const at = (/** @type {number} */ m) => new Date(Date.UTC(2026, 10, 20, 3, m));
  /** @param {string} id @param {number} m @param {string} path */
  const edit = (id, m, path) => ({ id, ts: at(m), kind: "tool", text: path, projectId: "p1", sessionId: "s", isSubagent: false, status: "ok", tool: { name: "Edit", status: "ok", error: null, commits: [] } });
  /** @param {string} id @param {number} m @param {string[]} paths */
  const commit = (id, m, paths) => ({
    id, ts: at(m), kind: "tool", text: "git commit -qm x", projectId: "p1", sessionId: "s", isSubagent: false, status: "ok",
    tool: { name: "Bash", status: "ok", error: null, commits: [{ hash: id.padEnd(40, "a"), subject: id, root: "/w/app/backend", changes: paths.map((p) => ({ path: p, insertions: 1, deletions: 0 })) }] },
  });
  const digestOf = (/** @type {any[]} */ items) =>
    buildDigest({ items, projects: new Map([["p1", "-w-app"]]), messages: new Map() }).projects[0];

  it("lists only edits that no later commit holds, matching by repository", () => {
    const p = digestOf([
      edit("e1", 1, "/w/app/backend/docs/journal.md"),
      edit("e2", 2, "/w/app/backend/README.md"),
      edit("e3", 3, "/w/app/tracker/README.md"), // same name, another repository
      commit("c1", 5, ["docs/journal.md", "README.md"]),
      edit("e4", 7, "/w/app/backend/README.md"), // edited again after its commit
    ]);
    expect(p.uncommitted).toEqual([
      { path: "backend/README.md", edits: 2 },
      { path: "tracker/README.md", edits: 1 },
    ]);
    // journal.md, backend/README.md (committed, then edited again: counted once), tracker/README.md.
    expect(p.filesChanged).toBe(3);
  });

  it("ignores commands that only mention git commit when the tracker reports commits", () => {
    const script = { ...edit("s1", 4, ""), text: "python3 - <<'EOF'\nrun('git commit -qm fake')\nEOF", tool: { name: "Bash", status: "ok", error: null, commits: [] } };
    const p = digestOf([edit("e1", 1, "/w/app/backend/docs/journal.md"), commit("c1", 2, ["docs/journal.md"]), script]);
    expect(p.commits.map((c) => c.message)).toEqual(["c1"]);
    expect(p.uncommitted).toEqual([]);
  });

  it("is empty when everything was committed", () => {
    const p = digestOf([edit("e1", 1, "/w/app/backend/docs/journal.md"), commit("c1", 2, ["docs/journal.md"])]);
    expect(p.uncommitted).toEqual([]);
  });
});
