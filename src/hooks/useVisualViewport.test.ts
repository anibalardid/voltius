import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useVisualViewport } from "./useVisualViewport";

const originalInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
const originalVisualViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
const originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalInnerHeight) Object.defineProperty(window, "innerHeight", originalInnerHeight);
  if (originalVisualViewport) Object.defineProperty(window, "visualViewport", originalVisualViewport);
  else delete (window as { visualViewport?: VisualViewport }).visualViewport;
  if (originalVisibilityState) Object.defineProperty(document, "visibilityState", originalVisibilityState);
});

test.each(["visibilitychange", "focus"] as const)(
  "re-measures stale keyboard geometry on app %s",
  (lifecycleEvent) => {
    const viewport = Object.assign(new EventTarget(), { height: 460, offsetTop: 220 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });

    let pendingFrame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      pendingFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const { result } = renderHook(() => useVisualViewport());
    expect(result.current).toMatchObject({ usableHeight: 460, offsetTop: 220 });

    viewport.height = 800;
    viewport.offsetTop = 0;
    act(() => {
      if (lifecycleEvent === "visibilitychange") document.dispatchEvent(new Event(lifecycleEvent));
      else window.dispatchEvent(new Event(lifecycleEvent));
      pendingFrame?.(0);
    });

    expect(result.current).toMatchObject({ usableHeight: 800, offsetTop: 0, keyboardVisible: false });
  },
);
