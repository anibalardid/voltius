import { describe, test, expect, vi, beforeEach } from "vitest";
import type { PluginAPI, PluginManifest } from "@/plugins/api";

// Spy on the Tauri bridge so we can inspect the args the plugin runtime forwards.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { loadPlugin, unloadPlugin } from "@/plugins/runtime";

function captureApi(manifest: PluginManifest): PluginAPI {
  let captured: PluginAPI | undefined;
  loadPlugin(manifest, (api) => {
    captured = api;
  }, true);
  if (!captured) throw new Error("register() did not receive an api");
  return captured;
}

async function exportOnce(): Promise<void> {
  const manifest: PluginManifest = {
    id: "gist-sync-test",
    name: "Gist Sync",
    version: "1.0.0",
    permissions: ["sync:write"],
  };
  const api = captureApi(manifest);
  try {
    await api.sync.exportState("aabb", "device-1");
  } finally {
    unloadPlugin("gist-sync-test");
  }
}

describe("plugin sync.exportState on a local-only install", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue([1, 2, 3]);
  });

  test("exports with no exclusions and no withheld files", async () => {
    await exportOnce();

    expect(invokeMock).toHaveBeenCalledWith(
      "backup_export",
      expect.objectContaining({ excludedIds: [], skipFiles: [] }),
    );
  });

  test("writes the settings bundle before calling backup_export", async () => {
    await exportOnce();
    expect(invokeMock).toHaveBeenCalledWith("settings_save", expect.anything());
  });
});
