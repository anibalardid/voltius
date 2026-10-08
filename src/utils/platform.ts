import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Host OS reported by the Rust backend (`get_platform`): "android" | "ios" |
 * "linux" | "macos" | "windows". Resolved once and cached for the session.
 *
 * Used to hide host-integration features the platform sandbox can't support
 * (local terminal, serial, local Docker). This is UX gating only — the backend
 * already fails those operations cleanly; never rely on it for security.
 */
let cached: Promise<string> | null = null;
let resolved: string | null = null;

export function getPlatform(): Promise<string> {
  if (!cached) {
    cached = invoke<string>("get_platform")
      .catch(() => "unknown")
      .then((p) => {
        resolved = p;
        return p;
      });
  }
  return cached;
}

/** The platform if `get_platform` has already resolved, else null. For sync
 *  callers (the plugin runtime) that cannot await; never a security gate. */
export function getPlatformSync(): string | null {
  return resolved;
}

/** True when App is rendering MobileShell rather than DesktopShell. Sync, for
 *  non-React callers; false until `get_platform` resolves, so prime it with
 *  `await getPlatform()` first where a wrong answer on the first pass matters. */
export function isMobileShell(): boolean {
  return isMobileOs(getPlatformSync());
}

/** React hook: the OS string, or `null` until it resolves. */
export function usePlatform(): string | null {
  const [os, setOs] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getPlatform().then((p) => alive && setOs(p));
    return () => {
      alive = false;
    };
  }, []);
  return os;
}

/** The OS strings that get the mobile shell. `get_platform` returns the host OS
 *  verbatim, so "ios" has to be listed explicitly — testing for "android" alone
 *  silently drops iOS onto DesktopShell, which is how the whole iOS port booted
 *  into a 1200x800 desktop window on a 390pt screen. */
const MOBILE_OS = new Set(["android", "ios"]);

/** Whether an OS string is a mobile (non-desktop) platform. `null` — still
 *  resolving — is deliberately false: callers that must not guess gate on
 *  `usePlatform() === null` and render nothing on the first pass. */
export function isMobileOs(os: string | null | undefined): boolean {
  return os != null && MOBILE_OS.has(os);
}

/** True when running on Android or iOS. Use this for "is this not a desktop?"
 *  questions — the mobile shell, hiding local-terminal/serial/WSL affordances,
 *  bottom sheets. False while loading. */
export function useIsMobile(): boolean {
  return isMobileOs(usePlatform());
}

/** True only for Android. Reserve for the Android-only native bridges — the IME
 *  overlay and the SAF download directory — which have no iOS equivalent yet.
 *  For anything that merely means "phone or tablet", use `useIsMobile`. */
export function useIsAndroid(): boolean {
  return usePlatform() === "android";
}
