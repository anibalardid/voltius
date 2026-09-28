import { beforeEach, describe, expect, it } from "vitest";
import { appSettingsHandler } from "./appSettings";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";

describe("appSettings terminal.remotePathCompletion", () => {
  beforeEach(() => {
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: false });
  });

  it("exports and imports valid boolean values", async () => {
    useTerminalSettingsStore.getState().setRemotePathCompletionEnabled(true);
    const exported = appSettingsHandler.export() as { terminal?: { remotePathCompletion?: boolean } };
    expect(exported.terminal?.remotePathCompletion).toBe(true);

    useTerminalSettingsStore.getState().setRemotePathCompletionEnabled(false);
    await appSettingsHandler.import(exported);
    expect(useTerminalSettingsStore.getState().remotePathCompletionEnabled).toBe(true);

    await appSettingsHandler.import({ terminal: { remotePathCompletion: false } });
    expect(useTerminalSettingsStore.getState().remotePathCompletionEnabled).toBe(false);
    expect("remotePathCompletionConfigured" in useTerminalSettingsStore.getState()).toBe(true);
  });

  it("ignores invalid values", async () => {
    useTerminalSettingsStore.getState().setRemotePathCompletionEnabled(true);

    await appSettingsHandler.import({ terminal: { remotePathCompletion: "yes" } });
    expect(useTerminalSettingsStore.getState().remotePathCompletionEnabled).toBe(true);

    await appSettingsHandler.import({ terminal: { remotePathCompletion: 1 } });
    expect(useTerminalSettingsStore.getState().remotePathCompletionEnabled).toBe(true);
  });

  it("leaves the current value unchanged when the setting is absent", async () => {
    useTerminalSettingsStore.getState().setRemotePathCompletionEnabled(true);

    await appSettingsHandler.import({ terminal: { preferredShell: "/bin/zsh" } });

    expect(useTerminalSettingsStore.getState().remotePathCompletionEnabled).toBe(true);
  });
});
