import { describe, expect, it } from "vitest";
import { commitUrl, commitsOf, shortHash } from "./commits.js";

const full = "3c514b0" + "a".repeat(33);

describe("commitsOf", () => {
  it("keeps well-formed commits and drops the rest", () => {
    const got = commitsOf([
      { hash: full, branch: "main", subject: "Fix login", remote: "github.com/acme/pay" },
      { hash: "1234567", subject: "Printed only" },
      { hash: "javascript:alert(1)", subject: "x" },
      { hash: "abcdefg", subject: "x" },
      null,
      { hash: full, remote: "evil.com/a b", subject: 3 },
    ]);
    expect(got).toEqual([
      { hash: full, branch: "main", subject: "Fix login", remote: "github.com/acme/pay" },
      { hash: "1234567", branch: null, subject: "Printed only", remote: null },
      { hash: full, branch: null, subject: "", remote: null },
    ]);
    expect(commitsOf(undefined)).toEqual([]);
    expect(commitsOf("nope")).toEqual([]);
  });
});

describe("commitUrl", () => {
  /** @param {string | null} remote */
  const c = (remote, hash = full) => ({ hash, branch: null, subject: "", remote });
  it("links known forges only, and only full hashes", () => {
    expect(commitUrl(c("github.com/acme/pay"))).toBe(`https://github.com/acme/pay/commit/${full}`);
    expect(commitUrl(c("gitlab.com/group/sub/repo"))).toBe(`https://gitlab.com/group/sub/repo/-/commit/${full}`);
    expect(commitUrl(c("bitbucket.org/acme/pay"))).toBe(`https://bitbucket.org/acme/pay/commits/${full}`);
    expect(commitUrl(c("git.internal.example/acme/pay"))).toBeNull();
    expect(commitUrl(c(null))).toBeNull();
    expect(commitUrl(c("github.com/acme/pay", "3c514b0"))).toBeNull();
    expect(shortHash(full)).toBe("3c514b0");
  });
});
