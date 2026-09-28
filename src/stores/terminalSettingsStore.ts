import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";
import { clampScrollbackLines, DEFAULT_SCROLLBACK_LINES } from "./terminalSettingsUtils";

export const CURSOR_STYLES = ["bar", "block", "underline"] as const;
export type TerminalCursorStyle = (typeof CURSOR_STYLES)[number];
export const DEFAULT_CURSOR_STYLE: TerminalCursorStyle = "bar";
export const DEFAULT_REMOTE_PATH_COMPLETION_ENABLED = true;

const TERMINAL_SETTINGS_VERSION = 1;

interface TerminalSettingsStore {
  preferredShell: string | null;
  scrollbackLines: number;
  cursorStyle: TerminalCursorStyle;
  zmodemEnabled: boolean;
  remotePathCompletionEnabled: boolean;
  remotePathCompletionConfigured: boolean;
  setPreferredShell: (shell: string | null) => void;
  setScrollbackLines: (lines: number) => void;
  setCursorStyle: (style: TerminalCursorStyle) => void;
  setZmodemEnabled: (enabled: boolean) => void;
  setRemotePathCompletionEnabled: (enabled: boolean) => void;
}

export const useTerminalSettingsStore = create<TerminalSettingsStore>()(
  persist(
    (set) => ({
      preferredShell: null,
      scrollbackLines: DEFAULT_SCROLLBACK_LINES,
      cursorStyle: DEFAULT_CURSOR_STYLE,
      zmodemEnabled: false,
      remotePathCompletionEnabled: DEFAULT_REMOTE_PATH_COMPLETION_ENABLED,
      remotePathCompletionConfigured: false,
      setPreferredShell: (shell) => { set({ preferredShell: shell }); useAppSettingsTimestampStore.getState().touch(); },
      setScrollbackLines: (lines) => { set({ scrollbackLines: clampScrollbackLines(lines) }); useAppSettingsTimestampStore.getState().touch(); },
      setCursorStyle: (style) => { set({ cursorStyle: style }); useAppSettingsTimestampStore.getState().touch(); },
      setZmodemEnabled: (enabled) => { set({ zmodemEnabled: enabled }); useAppSettingsTimestampStore.getState().touch(); },
      setRemotePathCompletionEnabled: (enabled) => {
        set({ remotePathCompletionEnabled: enabled, remotePathCompletionConfigured: true });
        useAppSettingsTimestampStore.getState().touch();
      },
    }),
    {
      name: "voltius-terminal-settings",
      version: TERMINAL_SETTINGS_VERSION,
      migrate: (persisted) => {
        const state = persisted as Partial<TerminalSettingsStore>;
        if (state.remotePathCompletionConfigured === true) return state;
        return {
          ...state,
          remotePathCompletionEnabled: DEFAULT_REMOTE_PATH_COMPLETION_ENABLED,
          remotePathCompletionConfigured: false,
        };
      },
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<TerminalSettingsStore>;
        const configured = persistedState.remotePathCompletionConfigured === true;
        const state = { ...current, ...persistedState };
        state.scrollbackLines = clampScrollbackLines(state.scrollbackLines);
        if (!CURSOR_STYLES.includes(state.cursorStyle)) state.cursorStyle = DEFAULT_CURSOR_STYLE;
        state.zmodemEnabled = state.zmodemEnabled === true;
        state.remotePathCompletionConfigured = configured;
        state.remotePathCompletionEnabled = configured
          ? state.remotePathCompletionEnabled === true
          : DEFAULT_REMOTE_PATH_COMPLETION_ENABLED;
        return state;
      },
    },
  ),
);
