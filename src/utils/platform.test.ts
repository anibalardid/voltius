import { beforeEach, describe, expect, it, vi } from "vitest";
import { isMobileOs } from "./platform";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

describe("getPlatformSync", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
  });

  it("is null before the platform resolves", async () => {
    invoke.mockReturnValue(new Promise(() => {}));
    const { getPlatform, getPlatformSync } = await import("./platform");
    getPlatform();
    expect(getPlatformSync()).toBeNull();
  });

  it("returns the resolved platform once known", async () => {
    invoke.mockResolvedValue("android");
    const { getPlatform, getPlatformSync } = await import("./platform");
    await getPlatform();
    expect(getPlatformSync()).toBe("android");
  });

  it("reports the fallback when the backend call fails", async () => {
    invoke.mockRejectedValue(new Error("no backend"));
    const { getPlatform, getPlatformSync } = await import("./platform");
    await getPlatform();
    expect(getPlatformSync()).toBe("unknown");
  });
});

describe("isMobileOs", () => {
  it("treats iOS as mobile", () => {
    // Regression: the shell routed on `platform === "android"`, so iOS booted
    // into a 1200x800 desktop window on a 390pt screen. `get_platform` returns
    // the host OS verbatim, so "ios" has to be a first-class case here.
    expect(isMobileOs("ios")).toBe(true);
  });

  it("treats Android as mobile", () => {
    expect(isMobileOs("android")).toBe(true);
  });

  it.each(["linux", "macos", "windows"])("treats %s as desktop", (os) => {
    expect(isMobileOs(os)).toBe(false);
  });

  it("is false while the platform is still resolving", () => {
    // Callers gate on `usePlatform() === null` and render nothing; a truthy
    // answer here would flash the desktop shell before the first resolve.
    expect(isMobileOs(null)).toBe(false);
    expect(isMobileOs(undefined)).toBe(false);
  });

  it("is false for the unknown fallback when the backend call fails", () => {
    expect(isMobileOs("unknown")).toBe(false);
  });
});
