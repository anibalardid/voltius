// Diagnostic: read a Chromium IndexedDB LevelDB the way the Termius importer
// does. Unlike `DB::open`, the reader tolerates the custom `idb_cmp1`
// comparator Chromium uses, so it also works on multi-level databases.
//
//   cargo run --manifest-path src-tauri/Cargo.toml --example termius_probe -- <db-dir>
//
// The reader module is crate-private, so this example includes its source
// directly rather than duplicating the parsing.
#[path = "../src/commands/termius/raw_leveldb.rs"]
mod raw_leveldb;

use std::path::{Path, PathBuf};

fn copy_db_to_temp(src: &Path) -> std::io::Result<PathBuf> {
    let temp = std::env::temp_dir().join(format!("termius-probe-{}", std::process::id()));
    if temp.exists() {
        let _ = std::fs::remove_dir_all(&temp);
    }
    std::fs::create_dir_all(&temp)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        if entry.file_name().to_string_lossy() == "LOCK" {
            continue;
        }
        std::fs::copy(entry.path(), temp.join(entry.file_name()))?;
    }
    Ok(temp)
}

fn main() {
    let src = std::env::args()
        .nth(1)
        .expect("usage: termius_probe <db-dir>");
    let src = PathBuf::from(src);
    println!("source: {}", src.display());

    let dir = copy_db_to_temp(&src).expect("copy failed");
    println!("temp:   {}", dir.display());

    match raw_leveldb::read_all_entries(&dir) {
        Ok(entries) => {
            println!("read {} entries", entries.len());
            for (index, (key, value)) in entries.iter().enumerate().take(5) {
                println!(
                    "  entry {index}: key_len={} val_len={} key0={:02x?}",
                    key.len(),
                    value.len(),
                    &key[..key.len().min(8)],
                );
            }
        }
        Err(error) => println!("read error: {error}"),
    }
}
