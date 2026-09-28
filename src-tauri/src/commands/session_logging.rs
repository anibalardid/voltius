use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use uuid::Uuid;

const DEFAULT_MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES: u64 = 100 * 1024 * 1024;
const DEFAULT_MAX_AGE_DAYS: u64 = 30;
const MIN_MAX_FILE_BYTES: u64 = 64 * 1024;
const MAX_MAX_FILE_BYTES: u64 = 100 * 1024 * 1024;
const MIN_MAX_TOTAL_BYTES: u64 = 1024 * 1024;
const MAX_MAX_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_MAX_AGE_DAYS: u64 = 3650;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RetentionPolicy {
    pub max_file_bytes: u64,
    pub max_total_bytes: u64,
    pub max_age_days: u64,
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        Self {
            max_file_bytes: DEFAULT_MAX_FILE_BYTES,
            max_total_bytes: DEFAULT_MAX_TOTAL_BYTES,
            max_age_days: DEFAULT_MAX_AGE_DAYS,
        }
    }
}

impl RetentionPolicy {
    fn normalized(self) -> Self {
        let max_file_bytes = self
            .max_file_bytes
            .clamp(MIN_MAX_FILE_BYTES, MAX_MAX_FILE_BYTES);
        Self {
            max_file_bytes,
            max_total_bytes: self
                .max_total_bytes
                .clamp(MIN_MAX_TOTAL_BYTES.max(max_file_bytes), MAX_MAX_TOTAL_BYTES),
            max_age_days: self.max_age_days.clamp(1, MAX_MAX_AGE_DAYS),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLogConfig {
    pub enabled: bool,
    pub directory: String,
    pub is_default: bool,
    pub retention: RetentionPolicy,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingInfo {
    pub file_name: String,
    pub size: u64,
    pub modified_at: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
struct StoredConfig {
    #[serde(default)]
    enabled: bool,
    directory: Option<String>,
    #[serde(default)]
    retention: RetentionPolicy,
}

struct ActiveRecording {
    path: PathBuf,
    file: File,
    size: u64,
}

/// Owns the small amount of mutable state needed to append output without
/// reopening a file for every terminal event. The public command surface is
/// deliberately narrow: callers provide opaque session ids and raw bytes only.
pub struct SessionLogManager {
    operation_gate: Mutex<()>,
    active: Mutex<HashMap<String, ActiveRecording>>,
}

impl SessionLogManager {
    pub fn new() -> Self {
        Self {
            operation_gate: Mutex::new(()),
            active: Mutex::new(HashMap::new()),
        }
    }

    fn with_gate<T>(&self, operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        let _gate = self
            .operation_gate
            .lock()
            .map_err(|_| "Session log state is unavailable".to_string())?;
        operation()
    }

    fn append_locked(
        &self,
        directory: &Path,
        session_id: &str,
        bytes: &[u8],
        policy: RetentionPolicy,
    ) -> Result<(), String> {
        if bytes.is_empty() {
            return Ok(());
        }
        ensure_directory(directory)?;
        let mut active = self
            .active
            .lock()
            .map_err(|_| "Session log state is unavailable".to_string())?;
        let mut offset = 0;

        while offset < bytes.len() {
            let needs_new_file = active
                .get(session_id)
                .map(|recording| {
                    recording.path.parent() != Some(directory)
                        || recording.size >= policy.max_file_bytes
                })
                .unwrap_or(true);
            if needs_new_file {
                active.insert(session_id.to_string(), new_recording(directory)?);
            }

            let recording = active
                .get_mut(session_id)
                .ok_or_else(|| "Session log state disappeared".to_string())?;
            let capacity = (policy.max_file_bytes - recording.size) as usize;
            let count = capacity.min(bytes.len() - offset);
            recording
                .file
                .write_all(&bytes[offset..offset + count])
                .map_err(|e| format!("session log write failed: {e}"))?;
            recording
                .file
                .sync_data()
                .map_err(|e| format!("session log sync failed: {e}"))?;
            recording.size += count as u64;
            offset += count;
        }

        prune_locked(directory, &active, policy);
        Ok(())
    }

    #[cfg(test)]
    fn append(
        &self,
        directory: &Path,
        session_id: &str,
        bytes: &[u8],
        policy: RetentionPolicy,
    ) -> Result<(), String> {
        self.with_gate(|| self.append_locked(directory, session_id, bytes, policy))
    }

    fn reset_locked(&self) {
        if let Ok(mut active) = self.active.lock() {
            active.clear();
        }
    }

    fn clear_file_locked(&self, directory: &Path, file_name: &str) -> Result<(), String> {
        validate_recording_name(file_name)?;
        let path = directory.join(file_name);
        let mut active = self
            .active
            .lock()
            .map_err(|_| "Session log state is unavailable".to_string())?;
        active.retain(|_, recording| recording.path != path);
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("session log delete failed: {e}")),
        }
    }

    #[cfg(test)]
    fn clear_file(&self, directory: &Path, file_name: &str) -> Result<(), String> {
        self.with_gate(|| self.clear_file_locked(directory, file_name))
    }

    /// Close and remove every recording in `directory`, including active files.
    /// The operation gate makes a later append observe the current configuration
    /// and create a fresh file instead of writing through a stale open handle.
    fn clear_all_locked(&self, directory: &Path) -> Result<(), String> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "Session log state is unavailable".to_string())?;
        active.retain(|_, recording| recording.path.parent() != Some(directory));
        let entries = match fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(format!("session log list failed: {e}")),
        };
        let mut first_error = None;
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if !is_recording_name(name) {
                continue;
            }
            if let Err(e) = fs::remove_file(path) {
                first_error.get_or_insert_with(|| format!("session log delete failed: {e}"));
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    #[cfg(test)]
    fn clear_all(&self, directory: &Path) -> Result<(), String> {
        self.with_gate(|| self.clear_all_locked(directory))
    }
}

fn default_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("session-recordings"))
        .map_err(|e| format!("no app data directory: {e}"))
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("session-logging.json"))
        .map_err(|e| format!("no app data directory: {e}"))
}

fn load_config(app: &tauri::AppHandle) -> Result<StoredConfig, String> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(StoredConfig::default());
    }
    let bytes = fs::read(&path).map_err(|e| format!("session log settings read failed: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("session log settings parse failed: {e}"))
}

fn save_config(app: &tauri::AppHandle, config: &StoredConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "session log settings path has no parent".to_string())?;
    ensure_directory(parent)?;
    let bytes = serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?;
    let tmp = config_temp_path(&path)?;
    write_owner_only(&tmp, &bytes)?;
    replace_file(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("session log settings write failed: {e}")
    })
}

fn config_temp_path(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "session log settings path has no parent".to_string())?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "session log settings path has no file name".to_string())?;
    Ok(parent.join(format!(".{name}.{}.tmp", Uuid::new_v4())))
}

fn replace_file(tmp: &Path, destination: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };

        let source: Vec<u16> = tmp
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let target: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let replaced = unsafe {
            MoveFileExW(
                source.as_ptr(),
                target.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if replaced == 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
    #[cfg(not(windows))]
    {
        fs::rename(tmp, destination)
    }
}

fn resolve_directory(
    app: &tauri::AppHandle,
    config: &StoredConfig,
) -> Result<(PathBuf, bool), String> {
    match config.directory.as_deref() {
        Some(directory) => Ok((PathBuf::from(directory), false)),
        None => Ok((default_directory(app)?, true)),
    }
}

fn canonicalize_with_existing_ancestor(path: &Path) -> Result<PathBuf, String> {
    let mut ancestor = path.to_path_buf();
    let mut unresolved = Vec::new();
    while !ancestor.exists() {
        let component = ancestor
            .file_name()
            .ok_or_else(|| "session log path has no existing ancestor".to_string())?;
        unresolved.push(component.to_os_string());
        ancestor = ancestor
            .parent()
            .ok_or_else(|| "session log path has no existing ancestor".to_string())?
            .to_path_buf();
    }

    let mut resolved = fs::canonicalize(&ancestor)
        .map_err(|e| format!("session log path canonicalization failed: {e}"))?;
    for component in unresolved.iter().rev() {
        match Path::new(component).components().next() {
            Some(Component::ParentDir) => {
                resolved.pop();
            }
            Some(Component::Normal(name)) => resolved.push(name),
            _ => {}
        }
    }
    Ok(resolved)
}

fn app_log_dir_is(directory: &Path, app: &tauri::AppHandle) -> Result<bool, String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("no application log directory: {e}"))?;
    path_resolves_inside(directory, &log_dir)
}

fn path_resolves_inside(path: &Path, root: &Path) -> Result<bool, String> {
    let path = canonicalize_with_existing_ancestor(path)?;
    let root = canonicalize_with_existing_ancestor(root)?;
    Ok(path == root || path.starts_with(&root))
}

fn ensure_directory(directory: &Path) -> Result<(), String> {
    let created = !directory.exists();
    if created {
        fs::create_dir_all(directory)
            .map_err(|e| format!("session log directory create failed: {e}"))?;
    }
    if !directory.is_dir() {
        return Err("session log path is not a directory".into());
    }
    #[cfg(unix)]
    if created {
        use std::os::unix::fs::PermissionsExt;
        // Newly-created default storage is private. Existing user-selected
        // directories are not made more restrictive; each recording remains 0600.
        let _ = fs::set_permissions(directory, fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

fn write_owner_only(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|e| format!("session log file open failed: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("session log permissions failed: {e}"))?;
    }
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("session log settings write failed: {e}"))
}

fn open_recording(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.write(true).create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(path)
        .map_err(|e| format!("session log file open failed: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("session log permissions failed: {e}"))?;
    }
    Ok(file)
}

fn new_recording(directory: &Path) -> Result<ActiveRecording, String> {
    for _ in 0..3 {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("session log clock failed: {e}"))?
            .as_millis();
        let path = directory.join(format!("session-{}-{stamp}.log", Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(_) => {
                let file = match open_recording(&path) {
                    Ok(file) => file,
                    Err(error) => {
                        let _ = fs::remove_file(&path);
                        return Err(error);
                    }
                };
                return Ok(ActiveRecording {
                    path,
                    file,
                    size: 0,
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("session log file create failed: {e}")),
        }
    }
    Err("session log file name collision".into())
}

fn is_recording_name(name: &str) -> bool {
    let Some(stem) = name
        .strip_suffix(".log")
        .and_then(|s| s.strip_prefix("session-"))
    else {
        return false;
    };
    !stem.is_empty()
        && stem
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn validate_recording_name(name: &str) -> Result<(), String> {
    if is_recording_name(name) {
        Ok(())
    } else {
        Err("invalid session recording name".into())
    }
}

fn modified_millis(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn list_recordings(directory: &Path) -> Vec<RecordingInfo> {
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut recordings: Vec<_> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            if !is_recording_name(&name) {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            Some(RecordingInfo {
                file_name: name,
                size: metadata.len(),
                modified_at: modified_millis(&metadata),
            })
        })
        .collect();
    recordings.sort_by(|a, b| {
        b.modified_at
            .cmp(&a.modified_at)
            .then_with(|| b.file_name.cmp(&a.file_name))
    });
    recordings
}

fn prune_locked(
    directory: &Path,
    active: &HashMap<String, ActiveRecording>,
    policy: RetentionPolicy,
) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let now = SystemTime::now();
    let max_age = Duration::from_secs(policy.max_age_days.saturating_mul(24 * 60 * 60));
    let mut files: Vec<(PathBuf, u64, SystemTime, bool)> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_str()?;
            if !is_recording_name(name) {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            let active_size = active
                .values()
                .find(|recording| recording.path == path)
                .map(|recording| recording.size);
            Some((
                path,
                active_size.unwrap_or(metadata.len()),
                metadata.modified().unwrap_or(UNIX_EPOCH),
                active_size.is_some(),
            ))
        })
        .collect();

    // An active file can briefly be absent from the directory listing if an
    // external actor removes it. Keep its bytes in the budget anyway; clear
    // operations close active files before deleting them, so Voltius itself
    // never intentionally leaves an unlinked open recording.
    let missing_active: Vec<_> = active
        .values()
        .filter(|recording| {
            recording.path.parent() == Some(directory)
                && !files.iter().any(|(path, _, _, _)| path == &recording.path)
        })
        .map(|recording| (recording.path.clone(), recording.size))
        .collect();
    for (path, size) in missing_active {
        files.push((path, size, UNIX_EPOCH, true));
    }

    files.sort_by_key(|(_, _, modified, _)| *modified);

    let mut total: u64 = files
        .iter()
        .fold(0, |sum, (_, size, _, _)| sum.saturating_add(*size));
    for (path, size, modified, protected) in files {
        if protected {
            continue;
        }
        let too_old = now
            .duration_since(modified)
            .map(|age| age > max_age)
            .unwrap_or(false);
        if (too_old || total > policy.max_total_bytes) && fs::remove_file(path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
}

#[tauri::command]
pub fn session_log_get_config(
    app: tauri::AppHandle,
    state: tauri::State<'_, SessionLogManager>,
) -> Result<SessionLogConfig, String> {
    state.with_gate(|| session_log_get_config_locked(&app))
}

fn session_log_get_config_locked(app: &tauri::AppHandle) -> Result<SessionLogConfig, String> {
    let stored = load_config(app)?;
    let (directory, is_default) = resolve_directory(app, &stored)?;
    Ok(SessionLogConfig {
        enabled: stored.enabled,
        directory: directory.to_string_lossy().into_owned(),
        is_default,
        retention: stored.retention.normalized(),
    })
}

#[tauri::command]
pub fn session_log_set_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, SessionLogManager>,
    enabled: bool,
) -> Result<SessionLogConfig, String> {
    state.with_gate(|| {
        let mut stored = load_config(&app)?;
        stored.enabled = enabled;
        save_config(&app, &stored)?;
        session_log_get_config_locked(&app)
    })
}

#[tauri::command]
pub fn session_log_set_directory(
    app: tauri::AppHandle,
    state: tauri::State<'_, SessionLogManager>,
    directory: Option<String>,
) -> Result<SessionLogConfig, String> {
    state.with_gate(|| {
        let path = directory.map(PathBuf::from);
        if let Some(path) = &path {
            if !path.is_absolute() {
                return Err("session log directory must be an absolute path".into());
            }
            if app_log_dir_is(path, &app)? {
                return Err("session recordings cannot use the application log directory".into());
            }
            if path.exists() && !path.is_dir() {
                return Err("session log path is not a directory".into());
            }
        }
        let mut stored = load_config(&app)?;
        stored.directory = path.map(|path| path.to_string_lossy().into_owned());
        save_config(&app, &stored)?;
        state.reset_locked();
        session_log_get_config_locked(&app)
    })
}

#[tauri::command]
pub fn session_log_set_retention(
    app: tauri::AppHandle,
    state: tauri::State<'_, SessionLogManager>,
    max_file_bytes: u64,
    max_total_bytes: u64,
    max_age_days: u64,
) -> Result<SessionLogConfig, String> {
    state.with_gate(|| {
        let mut stored = load_config(&app)?;
        stored.retention = RetentionPolicy {
            max_file_bytes,
            max_total_bytes,
            max_age_days,
        }
        .normalized();
        save_config(&app, &stored)?;
        session_log_get_config_locked(&app)
    })
}

#[tauri::command]
pub fn session_log_append(
    app: tauri::AppHandle,
    state: tauri::State<'_, SessionLogManager>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    state.with_gate(|| {
        let stored = load_config(&app)?;
        if !stored.enabled {
            return Ok(());
        }
        let (directory, _) = resolve_directory(&app, &stored)?;
        state.append_locked(
            &directory,
            &session_id,
            &data,
            stored.retention.normalized(),
        )
    })
}

#[tauri::command]
pub fn session_log_list(
    app: tauri::AppHandle,
    state: tauri::State<'_, SessionLogManager>,
) -> Result<Vec<RecordingInfo>, String> {
    state.with_gate(|| {
        let stored = load_config(&app)?;
        let (directory, _) = resolve_directory(&app, &stored)?;
        Ok(list_recordings(&directory))
    })
}

#[tauri::command]
pub fn session_log_clear(
    app: tauri::AppHandle,
    state: tauri::State<'_, SessionLogManager>,
    file_name: String,
) -> Result<(), String> {
    state.with_gate(|| {
        let stored = load_config(&app)?;
        let (directory, _) = resolve_directory(&app, &stored)?;
        state.clear_file_locked(&directory, &file_name)
    })
}

#[tauri::command]
pub fn session_log_clear_all(
    app: tauri::AppHandle,
    state: tauri::State<'_, SessionLogManager>,
) -> Result<(), String> {
    state.with_gate(|| {
        let stored = load_config(&app)?;
        let (directory, _) = resolve_directory(&app, &stored)?;
        state.clear_all_locked(&directory)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_policy(file: u64) -> RetentionPolicy {
        RetentionPolicy {
            max_file_bytes: file,
            max_total_bytes: 1024,
            max_age_days: 365,
        }
    }

    fn log_files(dir: &Path) -> Vec<PathBuf> {
        let mut paths: Vec<_> = fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| is_recording_name(path.file_name().unwrap().to_str().unwrap()))
            .collect();
        paths.sort_by_key(|path| fs::metadata(path).unwrap().modified().unwrap());
        paths
    }

    #[test]
    fn append_preserves_raw_bytes_without_utf8_conversion() {
        let dir = tempfile::tempdir().unwrap();
        let manager = SessionLogManager::new();
        let bytes = [0xff, 0x00, 0x1b, b'[', b'2', b'J'];

        manager
            .append(dir.path(), "session-id", &bytes, test_policy(1024))
            .unwrap();

        let files = log_files(dir.path());
        assert_eq!(files.len(), 1);
        assert_eq!(fs::read(&files[0]).unwrap(), bytes);
    }

    #[test]
    fn append_rotates_without_losing_or_decoding_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let manager = SessionLogManager::new();
        let bytes = [0xff, 0x01, 0x02, 0x1b, 0x03, 0x04, 0x05];

        manager
            .append(dir.path(), "session-id", &bytes, test_policy(3))
            .unwrap();

        let files = log_files(dir.path());
        assert_eq!(files.len(), 3);
        let joined: Vec<u8> = files
            .into_iter()
            .flat_map(|path| fs::read(path).unwrap())
            .collect();
        assert_eq!(joined, bytes);
    }

    #[test]
    fn active_recordings_count_toward_total_without_being_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let manager = SessionLogManager::new();
        let policy = RetentionPolicy {
            max_file_bytes: 64,
            max_total_bytes: 4,
            max_age_days: 365,
        };
        manager
            .append(dir.path(), "session-id", b"active", policy)
            .unwrap();
        fs::write(dir.path().join("session-old.log"), b"old").unwrap();

        manager
            .append(dir.path(), "session-id", b"!", policy)
            .unwrap();

        let files = log_files(dir.path());
        assert_eq!(files.len(), 1);
        assert_eq!(fs::read(&files[0]).unwrap(), b"active!");
    }

    #[test]
    fn append_reports_an_unwritable_path_without_panicking() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("not-a-directory");
        fs::write(&path, b"file").unwrap();

        let result =
            SessionLogManager::new().append(&path, "session-id", b"output", test_policy(1024));

        assert!(result.is_err());
    }

    #[test]
    fn clear_one_and_clear_all_only_remove_recordings() {
        let dir = tempfile::tempdir().unwrap();
        let manager = SessionLogManager::new();
        manager
            .append(dir.path(), "one", b"one", test_policy(1024))
            .unwrap();
        manager
            .append(dir.path(), "two", b"two", test_policy(1024))
            .unwrap();
        fs::write(dir.path().join("keep.txt"), b"keep").unwrap();
        let files = log_files(dir.path());

        manager
            .clear_file(dir.path(), files[0].file_name().unwrap().to_str().unwrap())
            .unwrap();
        assert_eq!(log_files(dir.path()).len(), 1);
        manager.clear_all(dir.path()).unwrap();
        assert!(log_files(dir.path()).is_empty());
        assert_eq!(fs::read(dir.path().join("keep.txt")).unwrap(), b"keep");
    }

    #[test]
    fn clear_all_closes_active_files_before_later_output_starts_a_new_recording() {
        let dir = tempfile::tempdir().unwrap();
        let manager = SessionLogManager::new();
        manager
            .append(dir.path(), "session-id", b"before", test_policy(1024))
            .unwrap();

        manager.clear_all(dir.path()).unwrap();
        assert!(log_files(dir.path()).is_empty());

        manager
            .append(dir.path(), "session-id", b"after", test_policy(1024))
            .unwrap();
        let files = log_files(dir.path());
        assert_eq!(files.len(), 1);
        assert_eq!(fs::read(&files[0]).unwrap(), b"after");
    }

    #[test]
    fn recording_names_cannot_escape_the_directory() {
        assert!(!is_recording_name("../session-one.log"));
        assert!(validate_recording_name("session-abc-123.log").is_ok());
        assert!(validate_recording_name("host-prod.log").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn nonexistent_child_of_symlinked_log_directory_is_rejected() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let app_log_dir = root.path().join("app-log");
        fs::create_dir(&app_log_dir).unwrap();
        let link = root.path().join("selected");
        symlink(&app_log_dir, &link).unwrap();

        assert!(path_resolves_inside(&link.join("new-child"), &app_log_dir).unwrap());
    }

    #[test]
    fn stored_configuration_is_default_off() {
        assert!(!StoredConfig::default().enabled);
    }

    #[test]
    fn configuration_temp_paths_are_unique_siblings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session-logging.json");
        let first = config_temp_path(&path).unwrap();
        let second = config_temp_path(&path).unwrap();

        assert_ne!(first, second);
        assert_eq!(first.parent(), path.parent());
        assert!(first
            .file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with(".tmp"));
    }

    #[cfg(unix)]
    #[test]
    fn recordings_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let manager = SessionLogManager::new();
        manager
            .append(dir.path(), "session-id", b"output", test_policy(1024))
            .unwrap();

        let mode = fs::metadata(log_files(dir.path()).first().unwrap())
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }
}
