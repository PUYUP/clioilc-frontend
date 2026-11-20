import { describe, expect, it } from "vitest";
import { normalizeRemote } from "./git.js";

// Same table as backend apps/workspaces/tests/test_git.py and tracker link.rs.
const GIT_REMOTE_CASES = /** @type {const} */ ([
  ["git@github.com:Acme/API.git", "github.com/acme/api"],
  ["https://github.com/acme/api", "github.com/acme/api"],
  ["https://github.com/acme/api.git/", "github.com/acme/api"],
  ["ssh://git@github.com:22/acme/api.git", "github.com/acme/api"],
  ["https://user:token@gitlab.com/group/sub/repo.git", "gitlab.com/group/sub/repo"],
  ["github.com:acme/api", "github.com/acme/api"],
  ["  git@bitbucket.org:team/repo  ", "bitbucket.org/team/repo"],
  ["/home/me/repos/api.git", null],
  ["not a remote", null],
  ["https://github.com/", null],
  ["", null],
]);

describe("normalizeRemote", () => {
  it.each(GIT_REMOTE_CASES)("%j", (raw, want) => expect(normalizeRemote(raw)).toBe(want));
});
