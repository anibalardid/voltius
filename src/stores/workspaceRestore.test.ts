import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  reconnect: vi.fn(async () => undefined),
  restoreSessions: vi.fn(),
  removeSession: vi.fn(),
  hydrate: vi.fn(),
  resumeIfStranded: vi.fn(),
  snapshot: {
    version: 1,
    sessions: [{ id: "s1", connectionId: "c1", connectionName: "host", title: "deploy", type: "ssh", persist: true }],
    layout: { splitTabs: [], activeSplitTabId: null, splitTabActive: false, titlebarOrder: [] },
    activeSessionId: "s1",
  },
}));

vi.mock("./workspaceSnapshotStore", () => ({
  readWorkspaceSnapshot: () => h.snapshot,
  clearWorkspaceSnapshot: vi.fn(),
  startWorkspaceSnapshotSync: vi.fn(),
}));
vi.mock("./toggleSettingsStore", () => ({ getToggle: () => true }));
vi.mock("./sessionStore", () => ({
  useSessionStore: {
    getState: () => ({
      sessions: [],
      restoreSessions: h.restoreSessions,
      removeSession: h.removeSession,
      reconnect: h.reconnect,
      markConnected: vi.fn(),
      markError: vi.fn(),
    }),
  },
}));
vi.mock("./reconnectBackoff", () => ({ resumeIfStranded: h.resumeIfStranded }));
vi.mock("./layoutStore", () => ({
  useLayoutStore: { getState: () => ({ splitTabs: [], hydrate: h.hydrate, removeSession: h.removeSession }) },
  getPaneSessionIds: () => [],
}));
vi.mock("./uiStore", () => ({
  useUIStore: { getState: () => ({ setActiveNav: vi.fn(), setSidebarOpen: vi.fn() }) },
}));
vi.mock("@/services/local", () => ({ localConnect: vi.fn(async () => undefined) }));
vi.mock("@/hooks/useTerminal", () => ({ setRestoreScrollOffset: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules(); // workspaceRestore is one-shot per module instance
});

test("a normal launch reconnects without waiting on sync", async () => {
  const { restoreWorkspaceOnLaunch } = await import("./workspaceRestore");

  await restoreWorkspaceOnLaunch();

  expect(h.reconnect).toHaveBeenCalledWith("s1", { restore: true });
});

test("a restored tab comes back under the name the user gave it", async () => {
  const { restoreWorkspaceOnLaunch } = await import("./workspaceRestore");

  await restoreWorkspaceOnLaunch();

  expect(h.restoreSessions).toHaveBeenCalledWith(
    [expect.objectContaining({ id: "s1", title: "deploy" })],
    "s1",
  );
});

test("a restored ssh tab the launch could not reach is handed to the reconnect loop", async () => {
  const { restoreWorkspaceOnLaunch } = await import("./workspaceRestore");

  await restoreWorkspaceOnLaunch();

  expect(h.resumeIfStranded).toHaveBeenCalledWith("s1", { restore: true });
});
