use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::storage::config::config_dir;

/// The app's own account metadata (`master_password`, `account_id`, `mode`)
/// lives here instead of the OS keychain, so launch never prompts for keychain
/// access. A JSON object of string → string, beside the other config files.
fn store_path() -> PathBuf {
    config_dir().join("local_keys.json")
}

fn read_map(path: &Path) -> Result<BTreeMap<String, String>, String> {
    match std::fs::read(path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|e| format!("Local store parse error: {e}"))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(e) => Err(format!("Local store read error: {e}")),
    }
}

fn write_map(path: &Path, map: &BTreeMap<String, String>) -> Result<(), String> {
    let bytes = serde_json::to_vec(map).map_err(|e| format!("Local store encode error: {e}"))?;
    write_atomic(path, &bytes)
}

fn get_at(path: &Path, key: &str) -> Result<Option<String>, String> {
    Ok(read_map(path)?.remove(key))
}

fn set_at(path: &Path, key: &str, value: &str) -> Result<(), String> {
    let mut map = read_map(path)?;
    map.insert(key.to_string(), value.to_string());
    write_map(path, &map)
}

fn delete_at(path: &Path, key: &str) -> Result<(), String> {
    let mut map = read_map(path)?;
    // Nothing to write when the key was never there — deleting from a fresh
    // install must not create the file.
    if map.remove(key).is_none() {
        return Ok(());
    }
    write_map(path, &map)
}

// ─── Atomic write ─────────────────────────────────────────────────────────────

/// Sibling scratch path, so the rename stays on one filesystem and is atomic.
fn temp_path(path: &Path) -> Result<PathBuf, String> {
    let dir = path.parent().ok_or("Local store path has no parent")?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Local store path has no file name")?;
    Ok(dir.join(format!("{name}.tmp")))
}

/// Staged sibling write, so an interrupted save leaves the previous store
/// intact rather than a truncated one. Deliberately not shared with
/// `storage::secrets`: that helper inherits the target's existing mode, while
/// this file is always owner-only.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = temp_path(path)?;
    if let Err(e) = stage(&tmp, bytes) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Local store write error: {e}")
    })
}

/// Materialise and flush `bytes` before the caller renames: without the sync
/// the rename can land ahead of the data it commits.
fn stage(tmp: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let mut file = open_owner_only(tmp).map_err(|e| format!("Local store write error: {e}"))?;
    file.write_all(bytes)
        .map_err(|e| format!("Local store write error: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("Local store write error: {e}"))?;
    Ok(())
}

#[cfg(unix)]
fn open_owner_only(tmp: &Path) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(tmp)?;
    // A leftover scratch file keeps its own mode through open(): set it either way.
    file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    Ok(file)
}

#[cfg(not(unix))]
fn open_owner_only(tmp: &Path) -> std::io::Result<std::fs::File> {
    std::fs::File::create(tmp)
}

// ─── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn local_kv_get(key: String) -> Result<Option<String>, String> {
    get_at(&store_path(), &key)
}

#[tauri::command]
pub fn local_kv_set(key: String, value: String) -> Result<(), String> {
    set_at(&store_path(), &key, &value)
}

#[tauri::command]
pub fn local_kv_delete(key: String) -> Result<(), String> {
    delete_at(&store_path(), &key)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(dir: &tempfile::TempDir) -> PathBuf {
        dir.path().join("local_keys.json")
    }

    #[test]
    fn set_then_get_round_trips_a_value() {
        let dir = tempfile::tempdir().unwrap();
        let path = store(&dir);

        set_at(&path, "master_password", "hunter2").unwrap();

        assert_eq!(
            get_at(&path, "master_password").unwrap(),
            Some("hunter2".to_string())
        );
    }

    #[test]
    fn get_returns_none_for_a_missing_file_and_a_missing_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = store(&dir);

        assert_eq!(get_at(&path, "mode").unwrap(), None);
        assert!(!path.exists(), "a read must not create the file");

        set_at(&path, "mode", "local").unwrap();
        assert_eq!(get_at(&path, "account_id").unwrap(), None);
    }

    #[test]
    fn set_keeps_the_other_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = store(&dir);

        set_at(&path, "master_password", "pw").unwrap();
        set_at(&path, "account_id", "acc").unwrap();

        assert_eq!(get_at(&path, "master_password").unwrap(), Some("pw".into()));
        assert_eq!(get_at(&path, "account_id").unwrap(), Some("acc".into()));
    }

    #[test]
    fn delete_removes_only_its_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = store(&dir);

        set_at(&path, "master_password", "pw").unwrap();
        set_at(&path, "mode", "local").unwrap();

        delete_at(&path, "master_password").unwrap();

        assert_eq!(get_at(&path, "master_password").unwrap(), None);
        assert_eq!(get_at(&path, "mode").unwrap(), Some("local".into()));
    }

    #[test]
    fn delete_of_a_missing_key_is_a_no_op() {
        let dir = tempfile::tempdir().unwrap();
        let path = store(&dir);

        delete_at(&path, "master_password").unwrap();

        assert!(!path.exists(), "a delete must not create the file");
    }

    #[test]
    fn values_persist_across_reads() {
        let dir = tempfile::tempdir().unwrap();
        let path = store(&dir);
        set_at(&path, "account_id", "acc-1").unwrap();

        // A second helper run reads the file from disk, not a cache.
        assert_eq!(get_at(&path, "account_id").unwrap(), Some("acc-1".into()));
        assert_eq!(
            read_map(&path)
                .unwrap()
                .get("account_id")
                .map(String::as_str),
            Some("acc-1")
        );
    }

    #[test]
    fn a_replace_updates_in_place_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = store(&dir);

        set_at(&path, "mode", "local-nopassword").unwrap();
        set_at(&path, "mode", "local").unwrap();

        assert_eq!(get_at(&path, "mode").unwrap(), Some("local".into()));
        let strays: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(strays.is_empty(), "temp file left behind: {strays:?}");
    }

    #[test]
    fn the_temp_file_sits_beside_the_store() {
        let dir = tempfile::tempdir().unwrap();
        let path = store(&dir);
        assert_eq!(
            temp_path(&path).unwrap(),
            dir.path().join("local_keys.json.tmp")
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_store_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = store(&dir);

        set_at(&path, "master_password", "pw").unwrap();

        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "local_keys.json must stay owner-only");
    }
}
