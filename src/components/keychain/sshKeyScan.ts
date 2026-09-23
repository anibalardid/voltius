import { invoke } from "@tauri-apps/api/core";
import { fsHomeDir, fsListDir, type LocalFile } from "@/services/sftp";
import { detectKeyInfo } from "./keyDetection";

/** A private key found in the user's ~/.ssh. */
export interface DetectedSshKey {
  /** Private-key file name, e.g. `id_ed25519`. */
  name: string;
  path: string;
  /** Type label from `detectKeyInfo`, or null when it could not be classified. */
  type: string | null;
}

/** Names that are never a private key to import. */
const SKIP_NAMES = new Set(["config", "environment", "rc", ".DS_Store"]);

/**
 * A plausible private-key file: not a directory, not a public half, not a
 * known-hosts/authorized-keys file, and not a stale backup.
 */
export function isCandidateKeyFile(name: string, isDir: boolean): boolean {
  if (isDir) return false;
  if (name.endsWith(".pub") || name.endsWith(".old") || name.endsWith(".bak")) return false;
  if (name.startsWith("known_hosts") || name.startsWith("authorized_keys")) return false;
  return !SKIP_NAMES.has(name);
}

/** The headers OpenSSH and PuTTY private keys open with. */
const PRIVATE_KEY_HEADER = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|PuTTY-User-Key-File-/;

/** Only this much of a candidate is inspected: enough for the header, never the key. */
export const KEY_HEAD_BYTES = 4096;

export function looksLikePrivateKey(head: string): boolean {
  return PRIVATE_KEY_HEADER.test(head);
}

/** Read a file under home, or null when it is missing or unreadable. */
async function readHomeText(path: string): Promise<string | null> {
  return invoke<string>("fs_read_text_home", { path }).catch(() => null);
}

/**
 * Private keys found in the user's ~/.ssh, filtered and classified. Never
 * throws: a missing or unreadable directory yields an empty list, so the caller
 * simply hides the picker.
 */
export async function scanSshKeys(): Promise<DetectedSshKey[]> {
  let entries: LocalFile[];
  try {
    const home = await fsHomeDir();
    entries = await fsListDir(`${home}/.ssh`);
  } catch {
    return [];
  }

  const found: DetectedSshKey[] = [];
  for (const entry of entries) {
    if (!isCandidateKeyFile(entry.name, entry.is_dir)) continue;
    const text = await readHomeText(entry.path);
    if (text === null || !looksLikePrivateKey(text.slice(0, KEY_HEAD_BYTES))) continue;
    const info = detectKeyInfo(text, "");
    found.push({ name: entry.name, path: entry.path, type: info.valid ? info.type : null });
  }
  return found;
}

/**
 * Load a detected private key and its sibling public half, if one exists. Both
 * reads go through `fs_read_text_home`, which keeps them within the home dir.
 */
export async function loadSshKeyPair(
  privatePath: string,
): Promise<{ privateKey: string; publicKey: string | null }> {
  const privateKey = await invoke<string>("fs_read_text_home", { path: privatePath });
  const publicKey = await readHomeText(`${privatePath}.pub`);
  return { privateKey, publicKey };
}
