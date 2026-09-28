import { beforeEach, describe, expect, it } from "vitest";
import { useTerminalSettingsStore } from "./terminalSettingsStore";

describe("remote path completion setting", () => {
  beforeEach(() => {
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: false });
    localStorage.removeItem("voltius-terminal-settings");
  });

  it("defaults on for new installs and migrates legacy persisted defaults", () => {
    const merge = useTerminalSettingsStore.persist.getOptions().merge!;
    const migrate = useTerminalSettingsStore.persist.getOptions().migrate!;
    const current = { ...useTerminalSettingsStore.getState(), remotePathCompletionEnabled: true };

    expect(useTerminalSettingsStore.getInitialState().remotePathCompletionEnabled).toBe(true);
    expect(migrate({ remotePathCompletionEnabled: false }, 0)).toMatchObject({
      remotePathCompletionEnabled: true,
      remotePathCompletionConfigured: false,
    });
    expect(merge({}, current).remotePathCompletionEnabled).toBe(true);
    expect(merge({ remotePathCompletionEnabled: false }, current).remotePathCompletionEnabled).toBe(true);
  });

  it("can be enabled and records an explicit configuration", () => {
    expect(useTerminalSettingsStore.getState().remotePathCompletionEnabled).toBe(false);
    useTerminalSettingsStore.getState().setRemotePathCompletionEnabled(true);
    expect(useTerminalSettingsStore.getState().remotePathCompletionEnabled).toBe(true);
    expect(useTerminalSettingsStore.getState().remotePathCompletionConfigured).toBe(true);
    expect(JSON.parse(localStorage.getItem("voltius-terminal-settings")!).state.remotePathCompletionConfigured).toBe(true);
  });

  it("preserves an explicit false across persisted merge", () => {
    const merge = useTerminalSettingsStore.persist.getOptions().merge!;
    const current = useTerminalSettingsStore.getState();
    expect(merge({ remotePathCompletionEnabled: false, remotePathCompletionConfigured: true }, current).remotePathCompletionEnabled).toBe(false);
    expect(merge({ remotePathCompletionEnabled: true, remotePathCompletionConfigured: true }, current).remotePathCompletionEnabled).toBe(true);
  });
});
