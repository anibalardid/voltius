import { describe, test, expect } from "vitest";
import type { PluginAPI, PluginManifest } from "@/plugins/api";
import { loadPlugin, unloadPlugin } from "@/plugins/runtime";

function captureApi(manifest: PluginManifest): PluginAPI {
  let captured: PluginAPI | undefined;
  loadPlugin(manifest, (api) => {
    captured = api;
  }, true);
  if (!captured) throw new Error("register() did not receive an api");
  return captured;
}

describe("appSync reports a local-only install", () => {
  test("appSync.status() is idle with no cloud and no providers", () => {
    const manifest: PluginManifest = {
      id: "appsync-test",
      name: "AppSync Test",
      version: "1.0.0",
      permissions: ["sync:read"],
    };
    const api = captureApi(manifest);
    try {
      expect(api.appSync.status()).toMatchObject({
        status: "idle",
        lastSync: null,
        error: null,
        cloudActive: false,
        blobSizeBytes: null,
        providers: [],
      });
    } finally {
      unloadPlugin("appsync-test");
    }
  });

  test("the plugin-scoped sync object does not carry a status method", () => {
    const manifest: PluginManifest = {
      id: "appsync-test-2",
      name: "AppSync Test 2",
      version: "1.0.0",
      permissions: ["sync:read"],
    };
    const api = captureApi(manifest);
    try {
      expect("status" in api.sync).toBe(false);
    } finally {
      unloadPlugin("appsync-test-2");
    }
  });
});
