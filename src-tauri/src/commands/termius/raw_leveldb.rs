//! Comparator-free LevelDB reader for Chromium IndexedDB databases.
//!
//! Chromium builds its IndexedDB LevelDB with a custom comparator (`idb_cmp1`,
//! numeric prefix ordering with type-aware suffixes). `rusty_leveldb::DB::open`
//! ignores the comparator *name* and always uses bytewise ordering, so on a
//! database with more than one level the SST files appear to overlap and
//! `VersionSet::recover` trips an internal ordering assertion.
//!
//! We sidestep the version set (and therefore the comparator) entirely: parse
//! the SSTables and write-ahead logs directly, in scan order, and resolve the
//! newest value per user key by sequence number. Ordering never matters because
//! LevelDB sequence numbers are globally unique across all files.
//!
//! Layout notes, verified against `rusty-leveldb-4.0.1` and the real Chromium
//! database (see tests):
//!   * SSTable trailer CRC is `mask_crc(crc32c(stored_block_bytes ++ compression))`.
//!   * Log record CRC is `mask_crc(crc32c(record_type ++ payload))`.
//!   * Index and data blocks are ordinary LevelDB blocks, possibly Snappy-framed.

use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use rusty_leveldb::compressor::SnappyCompressor;
use rusty_leveldb::Compressor;

/// SSTable footer magic `0xdb4775248b80fb57` in little-endian byte order.
const SST_MAGIC: [u8; 8] = [0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb];
const SST_FOOTER_LEN: usize = 48;
const SST_MAGIC_OFFSET: usize = 40;
/// One compression-type byte followed by a 4-byte (masked) CRC32C.
const BLOCK_TRAILER_LEN: usize = 5;
/// Internal keys carry an 8-byte little-endian `(sequence << 8 | value_type)`.
const INTERNAL_KEY_SUFFIX_LEN: usize = 8;

const LOG_BLOCK_SIZE: usize = 32 * 1024;
const LOG_HEADER_LEN: usize = 4 + 2 + 1;
const CRC_MASK_DELTA: u32 = 0xa282_ead8;

const LOG_TYPE_FULL: u8 = 1;
const LOG_TYPE_FIRST: u8 = 2;
const LOG_TYPE_MIDDLE: u8 = 3;
const LOG_TYPE_LAST: u8 = 4;

const VALUE_TYPE_DELETION: u8 = 0;
const VALUE_TYPE_VALUE: u8 = 1;

/// Newest version seen for one user key.
struct Version {
    sequence: u64,
    deleted: bool,
    value: Vec<u8>,
}

/// Reads every `(user_key, value)` pair from a LevelDB directory, keeping only
/// the newest version of each user key and dropping the ones whose newest entry
/// is a deletion. Returns an error if an SSTable is unreadable or corrupt; a
/// damaged log tail (normal after a crash) silently ends that log's scan.
pub(super) fn read_all_entries(dir: &Path) -> Result<Vec<(Vec<u8>, Vec<u8>)>, String> {
    let (sst_files, log_files) = collect_data_files(dir)?;
    if sst_files.is_empty() && log_files.is_empty() {
        return Err(format!(
            "No LevelDB data files (.ldb/.log) in {}",
            dir.display()
        ));
    }

    // Sequence numbers order writes globally, so the file order is irrelevant.
    let mut versions: HashMap<Vec<u8>, Version> = HashMap::new();
    for path in &sst_files {
        read_sstable(path, &mut versions)?;
    }
    for path in &log_files {
        read_log(path, &mut versions);
    }

    Ok(survivors(versions))
}

fn collect_data_files(dir: &Path) -> Result<(Vec<PathBuf>, Vec<PathBuf>), String> {
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("Cannot read {}: {e}", dir.display()))?;
    let mut sst_files = Vec::new();
    let mut log_files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Cannot read an entry in {}: {e}", dir.display()))?;
        let path = entry.path();
        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase);
        match extension.as_deref() {
            Some("ldb") | Some("sst") => sst_files.push(path),
            Some("log") => log_files.push(path),
            _ => {}
        }
    }
    sst_files.sort();
    log_files.sort();
    Ok((sst_files, log_files))
}

fn survivors(versions: HashMap<Vec<u8>, Version>) -> Vec<(Vec<u8>, Vec<u8>)> {
    versions
        .into_iter()
        .filter(|(_, version)| !version.deleted)
        .map(|(key, version)| (key, version.value))
        .collect()
}

fn insert_version(
    versions: &mut HashMap<Vec<u8>, Version>,
    user_key: Vec<u8>,
    sequence: u64,
    deleted: bool,
    value: Vec<u8>,
) {
    match versions.entry(user_key) {
        Entry::Occupied(mut slot) => {
            if sequence >= slot.get().sequence {
                slot.insert(Version {
                    sequence,
                    deleted,
                    value,
                });
            }
        }
        Entry::Vacant(slot) => {
            slot.insert(Version {
                sequence,
                deleted,
                value,
            });
        }
    }
}

// ─── SSTable ──────────────────────────────────────────────────────────────────

fn read_sstable(path: &Path, versions: &mut HashMap<Vec<u8>, Version>) -> Result<(), String> {
    let data = std::fs::read(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    if data.len() < SST_FOOTER_LEN {
        return Err(format!("{} is too small to be an SSTable", path.display()));
    }
    let footer = &data[data.len() - SST_FOOTER_LEN..];
    if footer[SST_MAGIC_OFFSET..] != SST_MAGIC {
        return Err(format!("Bad SSTable magic in {}", path.display()));
    }

    // The footer holds a metaindex handle (unused) then the index handle, each
    // encoded as an offset varint followed by a size varint.
    let bad_footer = || format!("Bad SSTable footer in {}", path.display());
    let (_, metaindex_offset_len) =
        decode_varint(&footer[..SST_MAGIC_OFFSET]).ok_or_else(bad_footer)?;
    let (_, metaindex_size_len) =
        decode_varint(&footer[metaindex_offset_len..SST_MAGIC_OFFSET]).ok_or_else(bad_footer)?;
    let index_handle_start = metaindex_offset_len + metaindex_size_len;
    let (index_offset, index_offset_len) =
        decode_varint(&footer[index_handle_start..SST_MAGIC_OFFSET]).ok_or_else(bad_footer)?;
    let (index_size, _) =
        decode_varint(&footer[index_handle_start + index_offset_len..SST_MAGIC_OFFSET])
            .ok_or_else(bad_footer)?;

    let index_block = read_table_block(&data, index_offset as usize, index_size as usize, path)?;
    for (_, handle) in parse_block_entries(&index_block)? {
        let (offset, size) = decode_block_handle(&handle)?;
        let block = read_table_block(&data, offset, size, path)?;
        for (internal_key, value) in parse_block_entries(&block)? {
            let Some((user_key, sequence, value_type)) = split_internal_key(&internal_key) else {
                return Err(format!(
                    "Internal key shorter than 8 bytes in {}",
                    path.display()
                ));
            };
            match value_type {
                VALUE_TYPE_VALUE => {
                    insert_version(versions, user_key.to_vec(), sequence, false, value)
                }
                VALUE_TYPE_DELETION => {
                    insert_version(versions, user_key.to_vec(), sequence, true, Vec::new())
                }
                // LevelDB defines no other type; ignore anything else rather than
                // inventing a value for it.
                _ => {}
            }
        }
    }
    Ok(())
}

fn read_table_block(
    data: &[u8],
    offset: usize,
    size: usize,
    path: &Path,
) -> Result<Vec<u8>, String> {
    let block_end = offset
        .checked_add(size)
        .and_then(|end| end.checked_add(BLOCK_TRAILER_LEN))
        .ok_or_else(|| format!("Block handle overflow in {}", path.display()))?;
    if block_end > data.len() {
        return Err(format!(
            "Block at offset {offset} runs past end of file in {}",
            path.display()
        ));
    }

    let block = &data[offset..offset + size];
    let compression = data[offset + size];
    let mut crc_bytes = [0u8; 4];
    crc_bytes.copy_from_slice(&data[offset + size + 1..offset + size + 5]);
    let stored_crc = u32::from_le_bytes(crc_bytes);

    let mut checksum_input = Vec::with_capacity(block.len() + 1);
    checksum_input.extend_from_slice(block);
    checksum_input.push(compression);
    if mask_crc(crc32c(&checksum_input)) != stored_crc {
        return Err(format!(
            "Block checksum mismatch at offset {offset} in {}",
            path.display()
        ));
    }

    match compression {
        0 => Ok(block.to_vec()),
        1 => SnappyCompressor
            .decode(block.to_vec())
            .map_err(|e| format!("Snappy decode failed in {}: {e}", path.display())),
        other => Err(format!(
            "Unsupported block compression type {other} in {}",
            path.display()
        )),
    }
}

fn decode_block_handle(buf: &[u8]) -> Result<(usize, usize), String> {
    let (offset, offset_len) =
        decode_varint(buf).ok_or_else(|| "Corrupt block handle".to_string())?;
    let (size, _) =
        decode_varint(&buf[offset_len..]).ok_or_else(|| "Corrupt block handle".to_string())?;
    Ok((offset as usize, size as usize))
}

/// Parses a LevelDB block's entries, reconstructing full keys from the
/// prefix-shared delta encoding. Restart points are only used to locate the end
/// of the entry region; they are never seeked, so no comparator is involved.
fn parse_block_entries(block: &[u8]) -> Result<Vec<(Vec<u8>, Vec<u8>)>, String> {
    if block.len() < 4 {
        return Err("Block is too small".to_string());
    }
    let last_four = &block[block.len() - 4..];
    let restart_count =
        u32::from_le_bytes([last_four[0], last_four[1], last_four[2], last_four[3]]) as usize;
    let restarts_len = restart_count
        .checked_mul(4)
        .ok_or_else(|| "Corrupt block restart count".to_string())?;
    let entries_end = block
        .len()
        .checked_sub(4 + restarts_len)
        .ok_or_else(|| "Corrupt block restart count".to_string())?;

    let corrupt = || "Corrupt block entry".to_string();
    let mut entries = Vec::new();
    let mut offset = 0usize;
    let mut previous_key: Vec<u8> = Vec::new();
    while offset < entries_end {
        let (shared, shared_len) =
            decode_varint(&block[offset..entries_end]).ok_or_else(corrupt)?;
        let (non_shared, non_shared_len) =
            decode_varint(&block[offset + shared_len..entries_end]).ok_or_else(corrupt)?;
        let (value_len, value_len_len) =
            decode_varint(&block[offset + shared_len + non_shared_len..entries_end])
                .ok_or_else(corrupt)?;

        let shared = shared as usize;
        let key_start = offset + shared_len + non_shared_len + value_len_len;
        let key_end = key_start
            .checked_add(non_shared as usize)
            .ok_or_else(corrupt)?;
        let value_end = key_end
            .checked_add(value_len as usize)
            .ok_or_else(corrupt)?;
        if value_end > entries_end || shared > previous_key.len() {
            return Err(corrupt());
        }

        let mut key = Vec::with_capacity(shared + non_shared as usize);
        key.extend_from_slice(&previous_key[..shared]);
        key.extend_from_slice(&block[key_start..key_end]);
        entries.push((key.clone(), block[key_end..value_end].to_vec()));
        previous_key = key;
        offset = value_end;
    }
    Ok(entries)
}

/// Splits an internal key into `(user_key, sequence, value_type)`.
fn split_internal_key(key: &[u8]) -> Option<(&[u8], u64, u8)> {
    let split = key.len().checked_sub(INTERNAL_KEY_SUFFIX_LEN)?;
    let tag = u64::from_le_bytes(key[split..].try_into().ok()?);
    Some((&key[..split], tag >> 8, (tag & 0xff) as u8))
}

// ─── Write-ahead log ──────────────────────────────────────────────────────────

/// Scans a log file. A partial or corrupt record ends the scan: LevelDB treats
/// everything after the first bad record as discarded on recovery, and a crash
/// routinely leaves just such a tail.
fn read_log(path: &Path, versions: &mut HashMap<Vec<u8>, Version>) {
    let Ok(data) = std::fs::read(path) else {
        return;
    };

    let mut offset = 0usize;
    let mut logical_record: Vec<u8> = Vec::new();
    let mut in_fragmented_record = false;

    while offset < data.len() {
        let space_left = LOG_BLOCK_SIZE - offset % LOG_BLOCK_SIZE;
        if space_left < LOG_HEADER_LEN {
            offset += space_left; // zero padding at the end of a block
            continue;
        }
        let Some(header_end) = offset.checked_add(LOG_HEADER_LEN) else {
            break;
        };
        if header_end > data.len() {
            break;
        }
        let header = &data[offset..header_end];
        let stored_crc = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
        let length = u16::from_le_bytes([header[4], header[5]]) as usize;
        let record_type = header[6];

        let Some(record_end) = header_end.checked_add(length) else {
            break;
        };
        let block_end = (offset / LOG_BLOCK_SIZE + 1) * LOG_BLOCK_SIZE;
        if record_end > data.len() || record_end > block_end {
            break;
        }
        let payload = &data[header_end..record_end];
        let mut checksum_input = Vec::with_capacity(payload.len() + 1);
        checksum_input.push(record_type);
        checksum_input.extend_from_slice(payload);
        if mask_crc(crc32c(&checksum_input)) != stored_crc {
            break;
        }

        match record_type {
            LOG_TYPE_FULL => {
                if parse_write_batch(payload, versions).is_err() {
                    break;
                }
                logical_record.clear();
                in_fragmented_record = false;
            }
            LOG_TYPE_FIRST => {
                logical_record.clear();
                logical_record.extend_from_slice(payload);
                in_fragmented_record = true;
            }
            LOG_TYPE_MIDDLE => {
                if !in_fragmented_record {
                    break;
                }
                logical_record.extend_from_slice(payload);
            }
            LOG_TYPE_LAST => {
                if !in_fragmented_record {
                    break;
                }
                logical_record.extend_from_slice(payload);
                if parse_write_batch(&logical_record, versions).is_err() {
                    break;
                }
                logical_record.clear();
                in_fragmented_record = false;
            }
            _ => break,
        }
        offset = record_end;
    }
}

/// A logical log record is a `WriteBatch`: `u64` sequence, `u32` count, then
/// `count` entries of `[type, varint key_len, key, (varint value_len, value)?]`.
/// Entry `i` carries sequence `batch_sequence + i`.
fn parse_write_batch(bytes: &[u8], versions: &mut HashMap<Vec<u8>, Version>) -> Result<(), String> {
    if bytes.len() < 12 {
        return Err("WriteBatch header is truncated".to_string());
    }
    let batch_sequence = u64::from_le_bytes([
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
    ]);
    let count = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]) as usize;
    // Every entry needs at least a type byte and a key-length varint.
    if count > bytes.len() {
        return Err("WriteBatch count exceeds record size".to_string());
    }

    let mut offset = 12usize;
    for index in 0..count {
        if offset >= bytes.len() {
            return Err("WriteBatch entry is truncated".to_string());
        }
        let entry_type = bytes[offset];
        offset += 1;

        let (key_len, key_len_len) = decode_varint(&bytes[offset..])
            .ok_or_else(|| "WriteBatch key length is truncated".to_string())?;
        offset += key_len_len;
        let key_end = offset
            .checked_add(key_len as usize)
            .ok_or_else(|| "WriteBatch key length overflows".to_string())?;
        if key_end > bytes.len() {
            return Err("WriteBatch key runs past end of record".to_string());
        }
        let sequence = batch_sequence + index as u64;

        match entry_type {
            VALUE_TYPE_VALUE => {
                let (value_len, value_len_len) = decode_varint(&bytes[key_end..])
                    .ok_or_else(|| "WriteBatch value length is truncated".to_string())?;
                let value_start = key_end + value_len_len;
                let value_end = value_start
                    .checked_add(value_len as usize)
                    .ok_or_else(|| "WriteBatch value length overflows".to_string())?;
                if value_end > bytes.len() {
                    return Err("WriteBatch value runs past end of record".to_string());
                }
                insert_version(
                    versions,
                    bytes[offset..key_end].to_vec(),
                    sequence,
                    false,
                    bytes[value_start..value_end].to_vec(),
                );
                offset = value_end;
            }
            VALUE_TYPE_DELETION => {
                insert_version(
                    versions,
                    bytes[offset..key_end].to_vec(),
                    sequence,
                    true,
                    Vec::new(),
                );
                offset = key_end;
            }
            other => return Err(format!("Unknown WriteBatch entry type {other}")),
        }
    }
    Ok(())
}

// ─── Primitives ───────────────────────────────────────────────────────────────

/// Decodes an unsigned LEB128 varint, returning `(value, bytes_consumed)`.
fn decode_varint(buf: &[u8]) -> Option<(u64, usize)> {
    let mut result = 0u64;
    let mut shift = 0u32;
    for (index, &byte) in buf.iter().enumerate() {
        if index >= 10 || shift >= 64 {
            return None;
        }
        result |= ((byte & 0x7f) as u64) << shift;
        if byte & 0x80 == 0 {
            return Some((result, index + 1));
        }
        shift += 7;
    }
    None
}

/// CRC32C (Castagnoli), matching LevelDB's checksum polynomial.
fn crc32c(data: &[u8]) -> u32 {
    static TABLE: OnceLock<[u32; 256]> = OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let mut table = [0u32; 256];
        for (index, slot) in table.iter_mut().enumerate() {
            let mut crc = index as u32;
            for _ in 0..8 {
                crc = if crc & 1 != 0 {
                    (crc >> 1) ^ 0x82f6_3b78
                } else {
                    crc >> 1
                };
            }
            *slot = crc;
        }
        table
    });

    let mut crc = 0xffff_ffffu32;
    for &byte in data {
        crc = table[((crc ^ byte as u32) & 0xff) as usize] ^ (crc >> 8);
    }
    !crc
}

/// LevelDB's log/table checksum mask.
fn mask_crc(crc: u32) -> u32 {
    crc.rotate_right(15).wrapping_add(CRC_MASK_DELTA)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_varint(mut value: u64, out: &mut Vec<u8>) {
        loop {
            let mut byte = (value & 0x7f) as u8;
            value >>= 7;
            if value != 0 {
                byte |= 0x80;
            }
            out.push(byte);
            if value == 0 {
                return;
            }
        }
    }

    fn internal_key(user_key: &[u8], sequence: u64, value_type: u8) -> Vec<u8> {
        let mut key = user_key.to_vec();
        key.extend_from_slice(&((sequence << 8) | value_type as u64).to_le_bytes());
        key
    }

    fn common_prefix_len(a: &[u8], b: &[u8]) -> usize {
        a.iter().zip(b).take_while(|(x, y)| x == y).count()
    }

    /// Minimal block encoder mirroring LevelDB's block format, with a restart
    /// every 16 entries (one restart for the small fixtures below).
    fn encode_block(entries: &[(Vec<u8>, Vec<u8>)]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut restart_offsets = vec![0u32];
        let mut previous: &[u8] = &[];
        for (index, (key, value)) in entries.iter().enumerate() {
            if index > 0 && index % 16 == 0 {
                restart_offsets.push(out.len() as u32);
                previous = &[];
            }
            let shared = common_prefix_len(previous, key);
            write_varint(shared as u64, &mut out);
            write_varint((key.len() - shared) as u64, &mut out);
            write_varint(value.len() as u64, &mut out);
            out.extend_from_slice(&key[shared..]);
            out.extend_from_slice(value);
            previous = key;
        }
        for restart in &restart_offsets {
            out.extend_from_slice(&restart.to_le_bytes());
        }
        out.extend_from_slice(&(restart_offsets.len() as u32).to_le_bytes());
        out
    }

    fn append_block_with_trailer(file: &mut Vec<u8>, block: &[u8], compression: u8) {
        file.extend_from_slice(block);
        file.push(compression);
        let mut checksum_input = block.to_vec();
        checksum_input.push(compression);
        file.extend_from_slice(&mask_crc(crc32c(&checksum_input)).to_le_bytes());
    }

    fn sst_block_handle(offset: usize, size: usize) -> Vec<u8> {
        let mut handle = Vec::new();
        write_varint(offset as u64, &mut handle);
        write_varint(size as u64, &mut handle);
        handle
    }

    #[test]
    fn crc32c_matches_known_vectors() {
        assert_eq!(crc32c(&[0u8; 32]), 0x8a91_36aa);
        assert_eq!(crc32c(&[0xffu8; 32]), 0x62a8_ab43);
    }

    #[test]
    fn varint_decodes_and_rejects_malformed_input() {
        assert_eq!(decode_varint(&[0x00]), Some((0, 1)));
        assert_eq!(decode_varint(&[0x7f]), Some((127, 1)));
        assert_eq!(decode_varint(&[0x80, 0x01]), Some((128, 2)));
        assert_eq!(
            decode_varint(&[0xff, 0xff, 0xff, 0xff, 0x0f]),
            Some((u32::MAX as u64, 5))
        );
        assert_eq!(decode_varint(&[]), None);
        assert_eq!(decode_varint(&[0x80]), None);
        assert_eq!(decode_varint(&[0x80; 11]), None);
    }

    #[test]
    fn block_entries_reconstruct_prefix_shared_keys() {
        let entries = vec![
            (b"\x00\x10\x01\x01host-alpha".to_vec(), b"one".to_vec()),
            (b"\x00\x10\x01\x01host-beta".to_vec(), b"two".to_vec()),
            (b"\x00\x10\x01\x01host-gamma".to_vec(), b"three".to_vec()),
        ];
        let block = encode_block(&entries);
        // Prefix sharing must make the block smaller than full keys + values.
        let unshared_len: usize = entries
            .iter()
            .map(|(key, value)| key.len() + value.len() + 3)
            .sum();
        assert!(block.len() < unshared_len);

        let parsed = parse_block_entries(&block).unwrap();
        assert_eq!(parsed, entries);
    }

    #[test]
    fn block_entries_reject_truncated_block() {
        let mut block = vec![1, 2, 3];
        block.extend_from_slice(&0u32.to_le_bytes());
        // Declares one restart but carries no restart array.
        assert!(parse_block_entries(&block).is_err());
    }

    #[test]
    fn sstable_reader_extracts_user_keys_and_values() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("000007.ldb");

        let data_entries = vec![
            (
                internal_key(b"\x00\x10\x01\x01alpha", 7, 1),
                b"first".to_vec(),
            ),
            (
                internal_key(b"\x00\x10\x01\x01beta", 8, 1),
                b"second".to_vec(),
            ),
        ];
        let data_block = encode_block(&data_entries);

        let mut file = Vec::new();
        let data_offset = file.len();
        append_block_with_trailer(&mut file, &data_block, 0);

        let index_entries = vec![(
            internal_key(b"\xff\xff", 9, 1),
            sst_block_handle(data_offset, data_block.len()),
        )];
        let index_block = encode_block(&index_entries);
        let index_offset = file.len();
        let index_size = index_block.len();
        append_block_with_trailer(&mut file, &index_block, 0);

        let mut footer = vec![0u8; SST_FOOTER_LEN];
        // Metaindex handle is unused by the reader; point it at the index block.
        let meta_handle = sst_block_handle(index_offset, index_size);
        let index_handle = sst_block_handle(index_offset, index_size);
        footer[..meta_handle.len()].copy_from_slice(&meta_handle);
        footer[meta_handle.len()..meta_handle.len() + index_handle.len()]
            .copy_from_slice(&index_handle);
        footer[SST_MAGIC_OFFSET..].copy_from_slice(&SST_MAGIC);
        file.extend_from_slice(&footer);

        std::fs::write(&path, &file).unwrap();

        let entries = read_all_entries(dir.path()).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries.contains(&(b"\x00\x10\x01\x01alpha".to_vec(), b"first".to_vec())));
        assert!(entries.contains(&(b"\x00\x10\x01\x01beta".to_vec(), b"second".to_vec())));
    }

    #[test]
    fn sstable_reader_rejects_bad_magic() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("000008.ldb");
        let mut file = vec![0u8; SST_FOOTER_LEN];
        file[SST_MAGIC_OFFSET..].copy_from_slice(b"notmagic");
        std::fs::write(&path, &file).unwrap();

        let error = read_all_entries(dir.path()).unwrap_err();
        assert!(error.contains("magic"), "unexpected error: {error}");
    }

    #[test]
    fn write_batch_log_record_inserts_values() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("000009.log");

        let mut batch = Vec::new();
        batch.extend_from_slice(&42u64.to_le_bytes());
        batch.extend_from_slice(&2u32.to_le_bytes());
        batch.push(VALUE_TYPE_VALUE);
        write_varint(3, &mut batch);
        batch.extend_from_slice(b"abc");
        write_varint(3, &mut batch);
        batch.extend_from_slice(b"def");
        batch.push(VALUE_TYPE_DELETION);
        write_varint(3, &mut batch);
        batch.extend_from_slice(b"xyz");

        let mut file = Vec::new();
        file.extend_from_slice(
            &mask_crc(crc32c(&[&[LOG_TYPE_FULL], batch.as_slice()].concat())).to_le_bytes(),
        );
        file.extend_from_slice(&(batch.len() as u16).to_le_bytes());
        file.push(LOG_TYPE_FULL);
        file.extend_from_slice(&batch);
        std::fs::write(&path, &file).unwrap();

        let entries = read_all_entries(dir.path()).unwrap();
        assert_eq!(entries, vec![(b"abc".to_vec(), b"def".to_vec())]);
    }

    #[test]
    fn log_scan_stops_at_a_corrupt_tail() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("000010.log");

        let mut batch = Vec::new();
        batch.extend_from_slice(&1u64.to_le_bytes());
        batch.extend_from_slice(&1u32.to_le_bytes());
        batch.push(VALUE_TYPE_VALUE);
        write_varint(3, &mut batch);
        batch.extend_from_slice(b"key");
        write_varint(5, &mut batch);
        batch.extend_from_slice(b"value");

        let mut file = Vec::new();
        file.extend_from_slice(
            &mask_crc(crc32c(&[&[LOG_TYPE_FULL], batch.as_slice()].concat())).to_le_bytes(),
        );
        file.extend_from_slice(&(batch.len() as u16).to_le_bytes());
        file.push(LOG_TYPE_FULL);
        file.extend_from_slice(&batch);
        // A torn trailing record: valid header shape, garbage payload.
        file.extend_from_slice(&[0xde, 0xad, 0xbe, 0xef, 0x10, 0x00, LOG_TYPE_FULL]);
        file.extend_from_slice(&[0u8; 16]);
        std::fs::write(&path, &file).unwrap();

        let entries = read_all_entries(dir.path()).unwrap();
        assert_eq!(entries, vec![(b"key".to_vec(), b"value".to_vec())]);
    }

    #[test]
    fn newest_sequence_wins_and_deletions_drop_keys() {
        let mut versions = HashMap::new();
        insert_version(&mut versions, b"a".to_vec(), 1, false, b"old".to_vec());
        insert_version(&mut versions, b"a".to_vec(), 5, false, b"new".to_vec());
        insert_version(&mut versions, b"a".to_vec(), 3, false, b"mid".to_vec());
        insert_version(&mut versions, b"b".to_vec(), 1, false, b"v".to_vec());
        insert_version(&mut versions, b"b".to_vec(), 2, true, Vec::new());
        // A delete followed by a newer put must resurrect the key.
        insert_version(&mut versions, b"c".to_vec(), 1, true, Vec::new());
        insert_version(&mut versions, b"c".to_vec(), 2, false, b"back".to_vec());

        let mut result = survivors(versions);
        result.sort();
        assert_eq!(
            result,
            vec![
                (b"a".to_vec(), b"new".to_vec()),
                (b"c".to_vec(), b"back".to_vec()),
            ]
        );
    }
}
