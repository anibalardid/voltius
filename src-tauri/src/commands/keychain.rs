// The app's own small values (account metadata, cached roles, tokens) live in
// the local file store beside the other config files, never the OS keychain:
// launching Voltius or writing a vault object must not prompt for keychain
// access. These commands keep their names so existing callers keep working.
use crate::commands::local_store::{local_kv_delete, local_kv_get, local_kv_set};

#[tauri::command]
pub fn keychain_get(key: String) -> Result<Option<String>, String> {
    local_kv_get(key)
}

#[tauri::command]
pub fn keychain_set(key: String, value: String) -> Result<(), String> {
    local_kv_set(key, value)
}

#[tauri::command]
pub fn keychain_delete(key: String) -> Result<(), String> {
    local_kv_delete(key)
}
