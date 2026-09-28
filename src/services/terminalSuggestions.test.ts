import { describe, expect, it } from "vitest";
import { getLocalSuggestions, suggestionInsertInput } from "./terminalSuggestions";

const entries = [
  { id: "1", command: "git status", timestamp: 3, sessionId: "s1", sessionName: "Work", connectionId: "c1" },
  { id: "2", command: "git stash", timestamp: 2, sessionId: "s1", sessionName: "Work", connectionId: "c1" },
  { id: "3", command: "git push", timestamp: 1, sessionId: "s2", sessionName: "Other", connectionId: "c2" },
  { id: "4", command: "deploy --token=secret", timestamp: 4, sessionId: "s1", sessionName: "Work", connectionId: "c1" },
];

const context = (overrides: Partial<Parameters<typeof getLocalSuggestions>[0]> = {}) => ({
  draft: "git st",
  entries,
  sessionId: "s1",
  connectionId: "c1",
  connectionName: "Work",
  sessionType: "ssh" as const,
  connected: true,
  cursorKnown: true,
  alternateScreen: false,
  mouseTracking: false,
  ...overrides,
});

describe("terminal local suggestions", () => {
  it("ranks the current connection and keeps command matching primary", () => {
    expect(getLocalSuggestions(context()).map((item) => item.command)).toEqual(["git status", "git stash"]);
  });

  it("does not index secret-like commands or claim remote completion", () => {
    expect(getLocalSuggestions(context({ draft: "deploy" })).map((item) => item.command)).toEqual([]);
  });

  it("falls back to no suggestions in unsafe contexts", () => {
    expect(getLocalSuggestions(context({ sessionType: "serial" }))).toEqual([]);
    expect(getLocalSuggestions(context({ alternateScreen: true }))).toEqual([]);
    expect(getLocalSuggestions(context({ mouseTracking: true }))).toEqual([]);
    expect(getLocalSuggestions(context({ connected: false }))).toEqual([]);
    expect(getLocalSuggestions(context({ cursorKnown: false }))).toEqual([]);
  });

  it("inserts explicitly without an execution newline", () => {
    const input = suggestionInsertInput("git st", "git status");
    expect(input).toBe("\x7f\x7f\x7f\x7f\x7f\x7fgit status");
    expect(input).not.toContain("\r");
    expect(input).not.toContain("\n");
  });
});
