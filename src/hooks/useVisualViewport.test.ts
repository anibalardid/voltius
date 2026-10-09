import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useVisualViewport } from "./useVisualViewport";

const originalInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
const originalVisualViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
const originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalInnerHeight) Object.defineProperty(window, "innerHeight", originalInnerHeight);
  if (originalVisualViewport) Object.defineProperty(window, "visualViewport", originalVisualViewport);
  else delete (window as { visualViewport?: VisualViewport }).visualViewport;
  if (originalVisibilityState) Object.defineProperty(document, "visibilityState", originalVisibilityState);
});

test("dismisses the keyboard and resets scroll on the first window focus after being hidden", () => {
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const input = document.createElement("input");
  document.body.append(input);
  input.focus();
  renderHook(() => useVisualViewport());

  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(document.activeElement).toBe(input);

  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  act(() => window.dispatchEvent(new Event("focus")));

  expect(document.activeElement).not.toBe(input);
  expect(scrollTo).toHaveBeenCalledWith(0, 0);
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
