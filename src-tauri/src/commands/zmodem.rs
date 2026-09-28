//! Native file adapters for the bounded ZMODEM terminal seam.
//!
//! Receive files are held behind opaque, session-bound handles. The frontend
//! never supplies a filesystem path for a temporary file, so a stale or
//! hand-crafted `.voltius-zmodem-*` path cannot be reopened by a command.
//! Temporary files are created beside the user-selected destination so a
//! successful hard link is same-filesystem and never replaces an existing
//! destination.

use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

const MAX_FILE_SIZE: u64 = 256 * 1024 * 1024;
const MAX_CHUNK_SIZE: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZmodemSourceInfo {
    pub name: String,
    pub size: u64,
}

struct TempTransfer {
    session_id: String,
    destination: PathBuf,
    path: PathBuf,
    file: Option<File>,
    size: u64,
}

pub struct ZmodemTempManager {
    transfers: Mutex<HashMap<String, TempTransfer>>,
}

impl ZmodemTempManager {
    pub fn new() -> Self {
        Self {
            transfers: Mutex::new(HashMap::new()),
        }
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, TempTransfer>>, String> {
        self.transfers
            .lock()
            .map_err(|_| "Zmodem temporary-file state is unavailable".to_string())
    }

    fn create(&self, session_id: &str, destination: &str) -> Result<String, String> {
        let (parent, destination) = canonical_destination(destination)?;
        let mut transfers = self.lock()?;
        for _ in 0..5 {
            let path = parent.join(format!(".voltius-zmodem-{}.part", Uuid::new_v4()));
            let mut options = OpenOptions::new();
            options.read(true).write(true).create_new(true);
            #[cfg(unix)]
            options.mode(0o600);
            match options.open(&path) {
                Ok(file) => {
                    let handle = format!("zmodem-temp-{}", Uuid::new_v4());
                    transfers.insert(
                        handle.clone(),
                        TempTransfer {
                            session_id: session_id.to_string(),
                            destination,
                            path,
                            file: Some(file),
                            size: 0,
                        },
                    );
                    return Ok(handle);
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("Cannot create Zmodem temporary file: {error}")),
            }
        }
        Err("Could not allocate a unique Zmodem temporary file".into())
    }

    fn write(&self, session_id: &str, handle: &str, data: &[u8]) -> Result<(), String> {
        if data.is_empty() || data.len() > MAX_CHUNK_SIZE {
            return Err("Invalid Zmodem temporary write".into());
        }
        let mut transfers = self.lock()?;
        let transfer = transfers
            .get_mut(handle)
            .ok_or("Unknown Zmodem temporary handle")?;
        if transfer.session_id != session_id {
            return Err("Zmodem temporary handle belongs to another session".into());
        }
        if transfer.size + data.len() as u64 > MAX_FILE_SIZE {
            return Err("Zmodem temporary file is too large".into());
        }
        transfer
            .file
            .as_mut()
            .ok_or("Zmodem temporary file is no longer writable")?
            .seek(SeekFrom::Start(transfer.size))
            .map_err(|e| format!("Cannot seek temporary file: {e}"))?;
        transfer
            .file
            .as_mut()
            .ok_or("Zmodem temporary file is no longer writable")?
            .write_all(data)
            .map_err(|e| format!("Cannot write temporary file: {e}"))?;
        transfer
            .file
            .as_mut()
            .ok_or("Zmodem temporary file is no longer writable")?
            .flush()
            .map_err(|e| format!("Cannot flush temporary file: {e}"))?;
        transfer.size += data.len() as u64;
        Ok(())
    }

    fn abort(&self, session_id: &str, handle: &str) -> Result<(), String> {
        let mut transfers = self.lock()?;
        let transfer = transfers
            .get_mut(handle)
            .ok_or("Unknown Zmodem temporary handle")?;
        if transfer.session_id != session_id {
            return Err("Zmodem temporary handle belongs to another session".into());
        }
        let path = transfer.path.clone();
        drop(transfer.file.take());
        match fs::remove_file(&path) {
            Ok(()) => {
                transfers.remove(handle);
                Ok(())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                transfers.remove(handle);
                Ok(())
            }
            Err(error) => Err(format!("Cannot remove Zmodem temporary file: {error}")),
        }
    }

    fn commit(&self, session_id: &str, handle: &str, destination: &str) -> Result<(), String> {
        let (_, requested_destination) = canonical_destination(destination)?;
        let mut transfers = self.lock()?;
        let temp_path = {
            let transfer = transfers
                .get_mut(handle)
                .ok_or("Unknown Zmodem temporary handle")?;
            if transfer.session_id != session_id {
                return Err("Zmodem temporary handle belongs to another session".into());
            }
            if transfer.destination != requested_destination {
                return Err("Zmodem destination does not match the selected destination".into());
            }
            if requested_destination.exists() {
                return Err("Zmodem destination already exists".into());
            }
            let file = transfer
                .file
                .as_mut()
                .ok_or("Zmodem temporary file is no longer writable")?;
            file.flush()
                .and_then(|_| file.sync_all())
                .map_err(|e| format!("Cannot flush Zmodem temporary file: {e}"))?;
            fs::hard_link(&transfer.path, &requested_destination).map_err(|e| {
                format!("Cannot finalize Zmodem transfer without replacing an existing file: {e}")
            })?;
            let path = transfer.path.clone();
            drop(transfer.file.take());
            path
        };

        match fs::remove_file(&temp_path) {
            Ok(()) => {
                transfers.remove(handle);
                Ok(())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                transfers.remove(handle);
                Ok(())
            }
            Err(error) => Err(format!(
                "Cannot clean the completed Zmodem temporary file: {error}"
            )),
        }
    }
}

impl Drop for ZmodemTempManager {
    fn drop(&mut self) {
        if let Ok(transfers) = self.transfers.get_mut() {
            for transfer in transfers.values() {
                let _ = fs::remove_file(&transfer.path);
            }
            transfers.clear();
        }
    }
}

fn canonical_destination(destination: &str) -> Result<(PathBuf, PathBuf), String> {
    let destination = PathBuf::from(destination);
    if destination.as_os_str().is_empty() || destination.to_string_lossy().contains('\0') {
        return Err("Invalid Zmodem destination".into());
    }
    let file_name = destination
        .file_name()
        .ok_or("Zmodem destination has no file name")?;
    let parent = destination
        .parent()
        .ok_or("Zmodem destination has no parent directory")?;
    let parent_meta = fs::symlink_metadata(parent)
        .map_err(|e| format!("Cannot inspect destination directory: {e}"))?;
    if parent_meta.file_type().is_symlink() || !parent_meta.is_dir() {
        return Err("Zmodem destination directory is not a regular directory".into());
    }
    let parent = fs::canonicalize(parent)
        .map_err(|e| format!("Cannot resolve destination directory: {e}"))?;
    Ok((parent.clone(), parent.join(file_name)))
}

fn regular_file(path: &Path) -> Result<fs::Metadata, String> {
    let link_meta =
        fs::symlink_metadata(path).map_err(|e| format!("Cannot inspect source file: {e}"))?;
    if link_meta.file_type().is_symlink() || !link_meta.is_file() {
        return Err("Zmodem only supports regular files, not symlinks or directories".into());
    }
    if link_meta.len() > MAX_FILE_SIZE {
        return Err("Selected file exceeds the 256 MiB Zmodem limit".into());
    }
    Ok(link_meta)
}

fn open_read_only(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW);
    options.open(path)
}

#[tauri::command]
pub fn zmodem_source_info(path: String) -> Result<ZmodemSourceInfo, String> {
    let path = PathBuf::from(path);
    let metadata = regular_file(&path)?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("Selected file name is not valid Unicode")?
        .to_string();
    if name.is_empty() || name.len() > 255 || name.contains(['/', '\\', '\0']) {
        return Err("Selected file has an unsafe name".into());
    }
    Ok(ZmodemSourceInfo {
        name,
        size: metadata.len(),
    })
}

#[tauri::command]
pub fn zmodem_source_read(path: String, offset: u64, length: usize) -> Result<Vec<u8>, String> {
    if length == 0 || length > MAX_CHUNK_SIZE || offset > MAX_FILE_SIZE {
        return Err("Invalid Zmodem source read".into());
    }
    let metadata = regular_file(Path::new(&path))?;
    if offset > metadata.len() {
        return Err("Source file changed during transfer".into());
    }
    let mut file =
        open_read_only(Path::new(&path)).map_err(|e| format!("Cannot open source file: {e}"))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("Cannot seek source file: {e}"))?;
    let mut bytes = vec![0u8; length.min((metadata.len() - offset) as usize)];
    file.read_exact(&mut bytes)
        .map_err(|e| format!("Cannot read source file: {e}"))?;
    Ok(bytes)
}

#[tauri::command]
pub fn zmodem_temp_create(
    manager: tauri::State<'_, ZmodemTempManager>,
    session_id: String,
    destination: String,
) -> Result<String, String> {
    if session_id.is_empty() {
        return Err("Invalid Zmodem session".into());
    }
    manager.create(&session_id, &destination)
}

#[tauri::command]
pub fn zmodem_temp_write(
    manager: tauri::State<'_, ZmodemTempManager>,
    session_id: String,
    temp_handle: String,
    data: Vec<u8>,
) -> Result<(), String> {
    manager.write(&session_id, &temp_handle, &data)
}

#[tauri::command]
pub fn zmodem_temp_abort(
    manager: tauri::State<'_, ZmodemTempManager>,
    session_id: String,
    temp_handle: String,
) -> Result<(), String> {
    manager.abort(&session_id, &temp_handle)
}

#[tauri::command]
pub fn zmodem_temp_commit(
    manager: tauri::State<'_, ZmodemTempManager>,
    session_id: String,
    temp_handle: String,
    destination: String,
) -> Result<(), String> {
    manager.commit(&session_id, &temp_handle, &destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_reads_are_bounded() {
        assert!(zmodem_source_read("missing".into(), 0, MAX_CHUNK_SIZE + 1).is_err());
    }

    #[test]
    fn temporary_handles_are_opaque_and_session_bound() {
        let manager = ZmodemTempManager::new();
        let dir = tempfile::tempdir().unwrap();
        let destination = dir.path().join("received.bin");
        let handle = manager
            .create("session-a", destination.to_string_lossy().as_ref())
            .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let transfers = manager.transfers.lock().unwrap();
            let path = &transfers.get(&handle).unwrap().path;
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        assert!(manager.write("session-b", &handle, &[1]).is_err());
        assert!(manager.write("session-a", &handle, &[1, 2, 3]).is_ok());
        manager.abort("session-a", &handle).unwrap();
        assert!(!destination.exists());
    }

    #[test]
    fn temporary_file_commits_without_overwriting() {
        let manager = ZmodemTempManager::new();
        let dir = tempfile::tempdir().unwrap();
        let destination = dir.path().join("received.bin");
        let handle = manager
            .create("session-a", destination.to_string_lossy().as_ref())
            .unwrap();
        manager.write("session-a", &handle, &[1, 2, 3]).unwrap();
        manager
            .commit("session-a", &handle, destination.to_string_lossy().as_ref())
            .unwrap();
        assert_eq!(fs::read(&destination).unwrap(), vec![1, 2, 3]);

        let second = manager
            .create("session-a", destination.to_string_lossy().as_ref())
            .unwrap();
        assert!(manager
            .commit("session-a", &second, destination.to_string_lossy().as_ref())
            .is_err());
        manager.abort("session-a", &second).unwrap();
    }
}
