import { describe, expect, it } from "vitest";
import { rankCommandHistory, subsequenceScore } from "./commandHistorySearch";
import type { CommandHistoryEntry } from "@/stores/commandHistoryStore";

const entry = (id: string, command: string, timestamp: number, connectionId = "c1", sessionName = "web-01"): CommandHistoryEntry => ({
  id, command, timestamp, sessionId: `s-${id}`, sessionName, connectionId,
});

describe("command history search", () => {
  it("scores contiguous and word-boundary matches above scattered matches", () => {
    expect(subsequenceScore("git st", "git status")).toBeGreaterThan(subsequenceScore("git st", "git show --stat")!);
  });

  it("returns recent entries for an empty query", () => {
    expect(rankCommandHistory([entry("old", "pwd", 1), entry("new", "ls", 2)], "").map((e) => e.id))
      .toEqual(["new", "old"]);
  });

  it("prioritizes command text, then matches session/connection labels", () => {
    expect(rankCommandHistory([
      entry("label", "echo hello", 3, "prod", "web-01"),
      entry("command", "ssh prod", 1, "c1", "local"),
    ], "prod").map((e) => e.id)).toEqual(["command", "label"]);
  });

  it("uses recency to break equal scores", () => {
    expect(rankCommandHistory([entry("old", "ls", 10), entry("new", "ls", 20)], "ls").map((e) => e.id))
      .toEqual(["new", "old"]);
  });

  it("leaves connection filtering to the caller while ranking all supplied entries", () => {
    const current = [entry("current", "tail app.log", 1, "c1"), entry("other", "tail db.log", 2, "c2")]
      .filter((e) => e.connectionId === "c1");
    expect(rankCommandHistory(current, "tail").map((e) => e.id)).toEqual(["current"]);
    expect(rankCommandHistory([entry("current", "tail app.log", 1, "c1"), entry("other", "tail db.log", 2, "c2")], "tail")
      .map((e) => e.id)).toEqual(["other", "current"]);
  });
});
