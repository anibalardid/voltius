import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { recordSessionOutput } from "./sessionLogging";
import { useSessionLoggingStore } from "@/stores/sessionLoggingStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));

describe("session logging output adapter", () => {
  beforeEach(() => {
    useSessionLoggingStore.setState({ enabled: false, config: null });
    vi.mocked(invoke).mockClear();
  });

  it("is default-off and does not send output when disabled", () => {
    recordSessionOutput("session-1", new Uint8Array([0xff, 0x1b, 0x00]));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sends raw output bytes only after explicit opt-in", () => {
    useSessionLoggingStore.getState().setEnabled(true);
    const bytes = new Uint8Array([0xff, 0x00, 0x1b, 0x5b, 0x32, 0x4a]);

    recordSessionOutput("session-1", bytes);

    expect(invoke).toHaveBeenCalledWith("session_log_append", {
      sessionId: "session-1",
      data: [255, 0, 27, 91, 50, 74],
    });
  });

  it("swallows recorder failures so output delivery cannot reject", async () => {
    useSessionLoggingStore.getState().setEnabled(true);
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));

    expect(() => recordSessionOutput("session-1", new Uint8Array([1]))).not.toThrow();
    await Promise.resolve();
  });

  it("also swallows synchronous command-dispatch failures", () => {
    useSessionLoggingStore.getState().setEnabled(true);
    vi.mocked(invoke).mockImplementationOnce(() => { throw new Error("bridge unavailable"); });

    expect(() => recordSessionOutput("session-1", new Uint8Array([1]))).not.toThrow();
  });
});
