import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";

export const TERMINAL_NOTIFICATION_DESTINATIONS = ["terminal", "inApp", "system"] as const;
export type TerminalNotificationDestination = (typeof TERMINAL_NOTIFICATION_DESTINATIONS)[number];

export const DEFAULT_TERMINAL_NOTIFICATION_DESTINATIONS: Record<TerminalNotificationDestination, boolean> = {
  terminal: false,
  inApp: false,
  system: false,
};

interface TerminalNotificationSettingsState {
  destinations: Record<TerminalNotificationDestination, boolean>;
  setDestination: (destination: TerminalNotificationDestination, enabled: boolean) => void;
}

export const useTerminalNotificationSettingsStore = create<TerminalNotificationSettingsState>()(
  persist(
    (set) => ({
      destinations: { ...DEFAULT_TERMINAL_NOTIFICATION_DESTINATIONS },
      setDestination: (destination, enabled) => {
        set((state) => ({ destinations: { ...state.destinations, [destination]: enabled } }));
        useAppSettingsTimestampStore.getState().touch();
      },
    }),
    {
      name: "voltius-terminal-notification-settings",
      merge: (persisted, current) => ({
        ...current,
        destinations: {
          ...DEFAULT_TERMINAL_NOTIFICATION_DESTINATIONS,
          ...((persisted as Partial<TerminalNotificationSettingsState> | undefined)?.destinations ?? {}),
        },
      }),
    },
  ),
);

export function getTerminalNotificationPolicy(): Record<TerminalNotificationDestination, boolean> {
  return useTerminalNotificationSettingsStore.getState().destinations;
}
