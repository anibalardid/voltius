import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLifecycleNotificationRouter,
  type LifecycleNotificationPolicy,
  type TerminalLifecycleSignal,
} from "./terminalLifecycleNotifications";

const signal = (overrides: Partial<Extract<TerminalLifecycleSignal, { kind: "session-ended" }>> = {}): TerminalLifecycleSignal => ({
  kind: "session-ended",
  sessionId: "session-1",
  sessionName: "build host",
  sessionType: "ssh",
  reason: "disconnect",
  ...overrides,
});

function router(policy: Partial<LifecycleNotificationPolicy> = {}, sinks = {}) {
  return createLifecycleNotificationRouter({
    getPolicy: () => ({ terminal: false, inApp: false, system: false, ...policy }),
    sinks,
  });
}

describe("terminal lifecycle notification policy", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("keeps the safe default off without invoking any destination", async () => {
    const inApp = vi.fn();
    const system = vi.fn();
    const result = await router({}, { inApp, system }).publish(signal());

    expect(result.notified).toBe(false);
    expect(inApp).not.toHaveBeenCalled();
    expect(system).not.toHaveBeenCalled();
  });

  it("enables destinations independently", async () => {
    const terminal = vi.fn();
    const inApp = vi.fn();
    const result = await router({ terminal: true, inApp: true }, { terminal, inApp }).publish(signal());

    expect(result.delivered).toEqual(["inApp", "terminal"]);
    expect(terminal).toHaveBeenCalledOnce();
    expect(inApp).toHaveBeenCalledOnce();
  });

  it("deduplicates a close across repeated reconnect/reattach delivery, then permits a new close after connect", async () => {
    const inApp = vi.fn();
    const lifecycle = router({ inApp: true }, { inApp });

    await lifecycle.publish(signal());
    await lifecycle.publish(signal());
    expect(inApp).toHaveBeenCalledOnce();

    lifecycle.resetSession("session-1");
    await lifecycle.publish(signal());
    expect(inApp).toHaveBeenCalledTimes(2);
  });

  it("uses one bell key for a broadcast group even when panes report it separately", async () => {
    const inApp = vi.fn();
    const lifecycle = router({ inApp: true }, { inApp });
    const bell = (sessionId: string): TerminalLifecycleSignal => ({
      kind: "terminal-bell",
      sessionId,
      sessionName: "shared shell",
      sessionType: "ssh",
      eventId: "broadcast-event-1",
      broadcastGroupId: "session-a,session-b",
    });

    await lifecycle.publish(bell("session-a"));
    await lifecycle.publish(bell("session-b"));
    expect(inApp).toHaveBeenCalledOnce();
  });

  it("falls back when the system destination is unavailable or permission is denied", async () => {
    const system = vi.fn(async () => false);
    const inApp = vi.fn();
    const result = await router({ system: true, inApp: true }, { system, inApp }).publish(signal());

    expect(result.systemFailed).toBe(true);
    expect(result.delivered).toEqual(["inApp"]);
    expect(inApp).toHaveBeenCalledOnce();
  });

  it("falls back when the system adapter is unsupported", async () => {
    const inApp = vi.fn();
    const result = await router({ system: true, inApp: true }, { inApp }).publish(signal());

    expect(result.systemFailed).toBe(true);
    expect(result.delivered).toEqual(["inApp"]);
  });

  it("does not classify a disconnect as command success", async () => {
    const inApp = vi.fn();
    const lifecycle = router({ inApp: true }, { inApp });

    await lifecycle.publish(signal({ reason: "disconnect" }));
    await lifecycle.publish({
      kind: "command-finished",
      sessionId: "session-1",
      sessionName: "build host",
      sessionType: "ssh",
      commandId: "unknown-command",
      exitCode: null,
    });

    expect(inApp).toHaveBeenCalledOnce();
    expect(inApp.mock.calls[0][0].severity).toBe("warning");
    expect(inApp.mock.calls[0][0].body).toContain("unknown");
  });
});
