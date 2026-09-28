import { invoke } from "@tauri-apps/api/core";
import { useSessionLoggingStore, type SessionLogConfig } from "@/stores/sessionLoggingStore";

export interface SessionRecording {
  fileName: string;
  size: number;
  modifiedAt: number;
}

/**
 * Fire-and-forget output recording. The terminal callback must never wait for
 * disk I/O or receive a rejection from this best-effort privacy feature.
 */
export function recordSessionOutput(sessionId: string, data: Uint8Array): void {
  if (!useSessionLoggingStore.getState().enabled || data.byteLength === 0) return;
  try {
    void invoke("session_log_append", { sessionId, data: Array.from(data) }).catch(() => {
      // A full disk, closed directory, or unavailable backend must not interrupt
      // terminal rendering or transport I/O.
    });
  } catch {
    // Serialization or command-dispatch failures are also best-effort.
  }
}

export async function getSessionLogConfig(): Promise<SessionLogConfig> {
  const config = await invoke<SessionLogConfig>("session_log_get_config");
  useSessionLoggingStore.getState().setConfig(config);
  useSessionLoggingStore.getState().setEnabled(config.enabled);
  return config;
}

export async function setSessionLoggingEnabled(enabled: boolean): Promise<SessionLogConfig> {
  const config = await invoke<SessionLogConfig>("session_log_set_enabled", { enabled });
  useSessionLoggingStore.getState().setConfig(config);
  useSessionLoggingStore.getState().setEnabled(config.enabled);
  return config;
}

export async function setSessionLogDirectory(directory: string | null): Promise<SessionLogConfig> {
  const config = await invoke<SessionLogConfig>("session_log_set_directory", { directory });
  useSessionLoggingStore.getState().setConfig(config);
  return config;
}

export async function setSessionLogRetention(retention: SessionLogConfig["retention"]): Promise<SessionLogConfig> {
  const config = await invoke<SessionLogConfig>("session_log_set_retention", { ...retention });
  useSessionLoggingStore.getState().setConfig(config);
  return config;
}

export function listSessionRecordings(): Promise<SessionRecording[]> {
  return invoke<SessionRecording[]>("session_log_list");
}

export function clearSessionRecording(fileName: string): Promise<void> {
  return invoke("session_log_clear", { fileName });
}

export function clearAllSessionRecordings(): Promise<void> {
  return invoke("session_log_clear_all");
}
