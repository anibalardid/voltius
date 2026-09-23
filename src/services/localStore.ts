import { invoke } from "@tauri-apps/api/core";

/**
 * The app's own account metadata, stored in a local JSON file under the config
 * directory — never the OS keychain. Same shape as the keychain commands it
 * replaces, so callers only swap the transport.
 */
export async function localGet(key: string): Promise<string | null> {
  return invoke<string | null>("local_kv_get", { key });
}

export async function localSet(key: string, value: string): Promise<void> {
  return invoke("local_kv_set", { key, value });
}

export async function localDelete(key: string): Promise<void> {
  return invoke("local_kv_delete", { key });
}
