import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SessionLogRetention {
  maxFileBytes: number;
  maxTotalBytes: number;
  maxAgeDays: number;
}

export interface SessionLogConfig {
  enabled: boolean;
  directory: string;
  isDefault: boolean;
  retention: SessionLogRetention;
}

interface SessionLoggingState {
  enabled: boolean;
  config: SessionLogConfig | null;
  setEnabled: (enabled: boolean) => void;
  setConfig: (config: SessionLogConfig) => void;
}

/** Local-only preference. It is intentionally not part of the user-data bundle. */
export const useSessionLoggingStore = create<SessionLoggingState>()(
  persist(
    (set) => ({
      enabled: false,
      config: null,
      setEnabled: (enabled) => set({ enabled }),
      setConfig: (config) => set({ config }),
    }),
    {
      name: "voltius-session-logging",
      partialize: (state) => ({ enabled: state.enabled }),
    },
  ),
);
