import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TERMINAL_NOTIFICATION_DESTINATIONS,
  useTerminalNotificationSettingsStore,
} from "./terminalNotificationSettingsStore";

describe("terminal notification settings", () => {
  beforeEach(() => {
    useTerminalNotificationSettingsStore.setState({ destinations: { ...DEFAULT_TERMINAL_NOTIFICATION_DESTINATIONS } });
  });

  it("starts with every lifecycle destination disabled", () => {
    expect(useTerminalNotificationSettingsStore.getState().destinations).toEqual({
      terminal: false,
      inApp: false,
      system: false,
    });
  });

  it("changes one destination without changing the others", () => {
    useTerminalNotificationSettingsStore.getState().setDestination("system", true);
    expect(useTerminalNotificationSettingsStore.getState().destinations).toEqual({
      terminal: false,
      inApp: false,
      system: true,
    });
  });
});
