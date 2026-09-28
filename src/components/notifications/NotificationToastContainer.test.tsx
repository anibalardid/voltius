import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useNotificationStore } from "@/stores/notificationStore";
import { NotificationToastContainer } from "./NotificationToastContainer";

vi.mock("@iconify/react", () => ({ Icon: () => null }));

beforeEach(() => {
  vi.useFakeTimers();
  useNotificationStore.setState({ toasts: [], banners: [], history: [], inbox: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function addToast() {
  return useNotificationStore.getState().addToast({
    source: { kind: "app", area: "terminal" },
    type: "toast",
    message: "Connection notice",
    severity: "warning",
    duration: 8_000,
  });
}

describe("notification toasts", () => {
  it("closes immediately on X and removes the toast after its fade", () => {
    const id = addToast();
    const screen = render(<NotificationToastContainer />);
    fireEvent.click(screen.getByRole("button", { name: "common.action.close" }));
    act(() => vi.advanceTimersByTime(260));
    expect(useNotificationStore.getState().toasts.some((toast) => toast.id === id)).toBe(false);
  });

  it("resumes from the remaining time instead of restarting the progress bar", () => {
    const id = addToast();
    const screen = render(<NotificationToastContainer />);
    const container = screen.container.querySelector(".fixed")!;
    const bar = screen.container.querySelector<HTMLElement>('[style*="toast-timer-drain"]')!;
    act(() => vi.advanceTimersByTime(3_000));
    fireEvent.mouseEnter(container);
    expect(bar.style.animationPlayState).toBe("paused");
    act(() => vi.advanceTimersByTime(5_000));
    expect(useNotificationStore.getState().toasts.some((toast) => toast.id === id)).toBe(true);
    fireEvent.mouseLeave(container);
    expect(bar.style.animationPlayState).toBe("running");
    expect(screen.container.querySelector('[style*="toast-timer-drain"]')).toBe(bar);
    act(() => vi.advanceTimersByTime(4_999));
    expect(useNotificationStore.getState().toasts.some((toast) => toast.id === id)).toBe(true);
    act(() => vi.advanceTimersByTime(261));
    expect(useNotificationStore.getState().toasts.some((toast) => toast.id === id)).toBe(false);
  });
});
