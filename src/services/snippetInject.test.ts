import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  active: vi.fn(() => false),
  targets: vi.fn(() => [] as Array<{ id: string; type: "ssh" }>),
  writable: vi.fn((_id: string) => true),
  send: vi.fn(async () => {}),
  paste: vi.fn(async () => true),
}));

vi.mock("@/stores/layoutStore", () => ({ broadcastActiveForSession: h.active }));
vi.mock("@/services/broadcast", () => ({
  broadcastTargets: h.targets,
  hasInputControl: h.writable,
}));
vi.mock("@/services/sessionInput", () => ({ sendSessionInput: h.send }));
vi.mock("@/services/terminalPaste", () => ({ pasteToSession: h.paste }));

import { broadcastSnippetInject } from "./snippetInject";

describe("broadcastSnippetInject", () => {
  const origin = { id: "s1", type: "ssh" as const };

  beforeEach(() => {
    h.active.mockReset().mockReturnValue(false);
    h.targets.mockReset().mockReturnValue([]);
    h.writable.mockReset().mockReturnValue(true);
    h.send.mockClear();
    h.paste.mockClear();
  });

  it("inserts only into the selected origin even when broadcast is active", async () => {
    h.active.mockReturnValue(true);
    h.targets.mockReturnValue([{ id: "s1", type: "ssh" }, { id: "s2", type: "ssh" }]);
    const result = await broadcastSnippetInject([origin], "echo hi", false);
    expect(result.targetCount).toBe(1);
    expect(h.paste).toHaveBeenCalledWith("s1", "echo hi");
  });

  it("executes only against the current broadcast targets and reports the count", async () => {
    h.active.mockReturnValue(true);
    h.targets.mockReturnValue([{ id: "s1", type: "ssh" }, { id: "s2", type: "ssh" }]);
    const result = await broadcastSnippetInject([origin], "echo hi", true);
    expect(result.targetCount).toBe(2);
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it("does not execute a target that fails input validation", async () => {
    h.active.mockReturnValue(false);
    h.writable.mockImplementation((id: string) => id !== "s1");
    const result = await broadcastSnippetInject([origin], "echo hi", true);
    expect(result.targetCount).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
  });
});
