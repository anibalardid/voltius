import { invoke } from "@tauri-apps/api/core";
import { buildUserDataBundle } from "@/services/user-data/registry";

/**
 * The local-only replacement for the removed cloud sync engine's plugin-facing
 * surface. Plugin blob export/import still exists — it is what the opt-in,
 * default-disabled gist-sync plugin uses to hand the user's data to a
 * destination the user configured — but there is no app cloud sync behind it:
 * status is always idle, nothing is excluded, and settings are written whole.
 */

export interface BlobPayload {
  files: Record<string, string>;
  secrets: Record<string, string>;
  /** Per-secret last-write timestamps; a key here but not in `secrets` is a deletion tombstone. */
  secret_clocks?: Record<string, string>;
}

/** Must mirror ENTITY_FILES in src-tauri/src/commands/sync.rs. */
export const ENTITY_FILES = [
  "connections.json",
  "identities.json",
  "ssh_keys.json",
  "folders.json",
  "snippets.json",
  "snippet_folders.json",
  "port_forwarding_rules.json",
] as const;

export type SyncStatus = "idle" | "syncing" | "success" | "error" | "offline";

let _status: SyncStatus = "idle";
const _listeners = new Set<() => void>();

export function getSyncState() {
  return { status: _status, lastSync: null as Date | null, error: null as string | null, cloudActive: false, blobSizeBytes: null as number | null };
}

export function onSyncStateChange(fn: () => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

/** No cloud sync exists locally, so nothing is ever excluded from an export. */
export function getExcludedObjectIds(): string[] {
  return [];
}

/** No cloud sync exists locally, so no config file is withheld. */
export function getPluginSkippedSyncFiles(): string[] {
  return [];
}

/** Flush the current settings bundle to disk before any `backup_export` caller reads it. */
export async function writeFilteredSettings(): Promise<void> {
  const bundle = buildUserDataBundle();
  await invoke("settings_save", { state: JSON.stringify(bundle) });
}
