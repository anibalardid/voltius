import { describe, expect, it, vi } from "vitest";
import {
  boundRemoteEntries,
  canRequestRemoteCompletion,
  isRemoteResultCurrent,
  normalizeRemoteDirectory,
  parseRemotePathToken,
  requestRemotePathSuggestions,
  remotePathSuggestions,
  REMOTE_COMPLETION_MAX_ENTRIES,
  REMOTE_COMPLETION_TIMEOUT_MS,
} from "./remotePathCompletion";

const base = {
  enabled: true,
  cwd: "/home/alice/project",
  sessionId: "s1",
  connectionId: "c1",
  sessionType: "ssh" as const,
  sshSessionKnown: true,
  connected: true,
  cursorKnown: true,
  alternateScreen: false,
  mouseTracking: false,
  persistent: false,
  broadcast: false,
};

describe("remote path completion", () => {
  it.each([
    ["cd src/ut", "/home/alice/project/src", "src/", "ut"],
    ["cd /var/lo", "/var", "/var/", "lo"],
    ["cd ./src", "/home/alice/project", "./", "src"],
    ["cd ../al", "/home/alice", "../", "al"],
    ["cd .", "/home/alice/project", "./", ""],
    ["cd ..", "/home/alice", "../", ""],
  ])("parses %s", (draft, directory, replacementPrefix, typedPrefix) => {
    expect(parseRemotePathToken(draft, base.cwd)).toMatchObject({ remoteDirectory: directory, replacementPrefix, typedPrefix });
  });

  it("normalizes current and parent paths without passing traversal to SFTP", () => {
    expect(normalizeRemoteDirectory("/a/b", ".")).toBe("/a/b");
    expect(normalizeRemoteDirectory("/a/b", "../c")).toBe("/a/c");
    expect(normalizeRemoteDirectory("/a", "../../etc")).toBeNull();
    expect(parseRemotePathToken("cd 'secret", "/a")).toBeNull();
    expect(normalizeRemoteDirectory(`/${"a".repeat(4096)}`, ".")).toBeNull();
  });

  it("rejects Windows drive paths instead of making them cwd-relative", () => {
    expect(normalizeRemoteDirectory("/home/alice", "C:/Windows")).toBeNull();
    expect(normalizeRemoteDirectory("/home/alice", "C:\\Windows")).toBeNull();
    expect(parseRemotePathToken("cd C:/Windows", "/home/alice")).toBeNull();
  });

  it("bounds a pre-materialized response and rejects names with controls or separators", () => {
    const entries = boundRemoteEntries([
      { name: "ok", isDir: true },
      { name: "", isDir: false },
      { name: "bad/name", isDir: false },
      { name: "bad\nname", isDir: false },
      { name: "bad\u0000name", isDir: false },
      ...Array.from({ length: REMOTE_COMPLETION_MAX_ENTRIES + 5 }, (_, i) => ({ name: `entry-${i}`, isDir: false })),
    ]);
    expect(entries).toHaveLength(REMOTE_COMPLETION_MAX_ENTRIES);
    expect(entries[0]).toEqual({ name: "ok", isDir: true });
    expect(entries.some((entry) => entry.name.includes("/"))).toBe(false);
    expect(entries.some((entry) => /[\u0000-\u001f\u007f]/.test(entry.name))).toBe(false);
  });

  it("does not invoke the backend while disabled", async () => {
    const list = vi.fn(async () => [{ name: "src", isDir: true }]);
    await expect(requestRemotePathSuggestions({ ...base, enabled: false, draft: "cd sr" }, list)).resolves.toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  it("falls back on backend errors and timeouts", async () => {
    const failing = vi.fn(async () => { throw new Error("offline"); });
    await expect(requestRemotePathSuggestions({ ...base, draft: "cd sr" }, failing)).resolves.toEqual([]);

    vi.useFakeTimers();
    try {
      const slow = vi.fn(() => new Promise<never>(() => {}));
      const result = requestRemotePathSuggestions({ ...base, draft: "cd sr" }, slow);
      await vi.advanceTimersByTimeAsync(REMOTE_COMPLETION_TIMEOUT_MS);
      await expect(result).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates insert-only replacements", () => {
    const suggestions = remotePathSuggestions(
      { ...base, draft: "cd src/ut" },
      [{ name: "utils", isDir: true }, { name: "other", isDir: false }],
      "host",
      10,
    );
    expect(suggestions[0]).toMatchObject({ command: "cd src/utils/", isDir: true });
    expect(suggestions[0].command).not.toMatch(/[\r\n]/);
  });

  it("matches remote entry names case-insensitively while preserving their spelling", () => {
    const suggestions = remotePathSuggestions(
      { ...base, draft: "/Va" },
      [{ name: "var", isDir: true }],
    );

    expect(suggestions.map((suggestion) => suggestion.command)).toEqual(["/var/"]);
  });

  it("completes an absolute path before cwd is known", () => {
    const suggestions = remotePathSuggestions(
      { ...base, cwd: undefined, draft: "cd /Va" },
      [{ name: "var", isDir: true }],
    );

    expect(suggestions.map((suggestion) => suggestion.command)).toEqual(["cd /var/"]);
  });

  it("keeps relative completion disabled before cwd is known", () => {
    const context = { ...base, cwd: undefined, draft: "cd sr" };

    expect(canRequestRemoteCompletion(context)).toBe(false);
    expect(remotePathSuggestions(context, [{ name: "src", isDir: true }])).toEqual([]);
  });

  it.each([
    ["disabled", { enabled: false }],
    ["disconnected", { connected: false }],
    ["unknown SSH session", { sshSessionKnown: false }],
    ["unknown cursor", { cursorKnown: false }],
    ["alternate screen", { alternateScreen: true }],
    ["mouse tracking", { mouseTracking: true }],
    ["broadcast", { broadcast: true }],
    ["local session", { sessionType: "local" as const }],
  ])("does not request remote completion in the %s context", (_label, change) => {
    expect(canRequestRemoteCompletion({ ...base, draft: "cd sr", ...change })).toBe(false);
    expect(remotePathSuggestions({ ...base, draft: "cd sr", ...change }, [{ name: "src", isDir: true }])).toEqual([]);
  });

  it("allows active SFTP completion for persistent SSH sessions", () => {
    expect(canRequestRemoteCompletion({ ...base, draft: "cd sr", persistent: true })).toBe(true);
  });

  it.each([
    ["space name", "cd 'space name'"],
    ["quote'name", "cd 'quote'\\''name'"],
    ["price$", "cd 'price$'"],
    ["semi;colon", "cd 'semi;colon'"],
    ["back\\slash", "cd 'back\\slash'"],
  ])("shell-quotes remote basename %s", (name, command) => {
    const [suggestion] = remotePathSuggestions(
      { ...base, draft: `cd ${name.slice(0, 1)}` },
      [{ name, isDir: false }],
      "host",
      10,
    );
    expect(suggestion.command).toBe(command);
  });

  it("discards stale generations", () => {
    expect(isRemoteResultCurrent(3, 3)).toBe(true);
    expect(isRemoteResultCurrent(3, 4)).toBe(false);
  });

  it("rejects a result from an old generation or missing context", () => {
    expect(isRemoteResultCurrent(3, 4)).toBe(false);
    expect(isRemoteResultCurrent(3, 3, "request-context", null)).toBe(false);
  });
});
