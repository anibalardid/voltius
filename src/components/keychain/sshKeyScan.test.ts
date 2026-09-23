import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));

import {
  isCandidateKeyFile,
  looksLikePrivateKey,
  scanSshKeys,
  loadSshKeyPair,
  KEY_HEAD_BYTES,
} from "./sshKeyScan";
import type { LocalFile } from "@/services/sftp";

const RSA_PEM =
  "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----\n";
const OPENSSH_PEM =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n";
const PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 user@host\n";

function entry(name: string, isDir = false): LocalFile {
  return { name, path: `/home/u/.ssh/${name}`, size: 10, is_dir: isDir, modified: null };
}

beforeEach(() => {
  h.invoke.mockReset();
});

// ─── pure filtering ──────────────────────────────────────────────────────────

test("isCandidateKeyFile rejects directories, public halves and non-key files", () => {
  expect(isCandidateKeyFile("id_rsa", false)).toBe(true);
  expect(isCandidateKeyFile("id_ed25519", false)).toBe(true);
  expect(isCandidateKeyFile("id_rsa.pub", false)).toBe(false);
  expect(isCandidateKeyFile("known_hosts", false)).toBe(false);
  expect(isCandidateKeyFile("known_hosts.old", false)).toBe(false);
  expect(isCandidateKeyFile("authorized_keys", false)).toBe(false);
  expect(isCandidateKeyFile("authorized_keys2", false)).toBe(false);
  expect(isCandidateKeyFile("config", false)).toBe(false);
  expect(isCandidateKeyFile("environment", false)).toBe(false);
  expect(isCandidateKeyFile("rc", false)).toBe(false);
  expect(isCandidateKeyFile(".DS_Store", false)).toBe(false);
  expect(isCandidateKeyFile("id_rsa.old", false)).toBe(false);
  expect(isCandidateKeyFile("id_rsa.bak", false)).toBe(false);
  expect(isCandidateKeyFile("nested", true)).toBe(false);
});

test("looksLikePrivateKey accepts PEM and PuTTY headers only", () => {
  expect(looksLikePrivateKey(RSA_PEM)).toBe(true);
  expect(looksLikePrivateKey(OPENSSH_PEM)).toBe(true);
  expect(looksLikePrivateKey("-----BEGIN ENCRYPTED PRIVATE KEY-----\n")).toBe(true);
  expect(looksLikePrivateKey("PuTTY-User-Key-File-3: ssh-rsa\n")).toBe(true);
  expect(looksLikePrivateKey(PUBLIC_KEY)).toBe(false);
  expect(looksLikePrivateKey("hello")).toBe(false);
});

// ─── scan ────────────────────────────────────────────────────────────────────

function routeScan(files: LocalFile[], contents: Record<string, string>) {
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    switch (cmd) {
      case "fs_home_dir":
        return "/home/u";
      case "fs_list_dir":
        return files;
      case "fs_read_text_home": {
        const path = args.path as string;
        const content = contents[path];
        if (content === undefined) throw new Error("not readable");
        return content;
      }
      default:
        return undefined;
    }
  });
}

test("scanSshKeys lists only private keys, with their detected type", async () => {
  routeScan(
    [
      entry("id_rsa"),
      entry("id_rsa.pub"),
      entry("id_ed25519"),
      entry("known_hosts"),
      entry("config"),
      entry("nested", true),
      entry("notes.txt"),
    ],
    {
      "/home/u/.ssh/id_rsa": RSA_PEM,
      "/home/u/.ssh/id_rsa.pub": PUBLIC_KEY,
      "/home/u/.ssh/id_ed25519": OPENSSH_PEM,
      "/home/u/.ssh/notes.txt": "just a note",
    },
  );

  const keys = await scanSshKeys();

  expect(keys.map((k) => k.name)).toEqual(["id_rsa", "id_ed25519"]);
  expect(keys[0].type).toBe("RSA");
  expect(keys[1].type).toBeNull(); // header matches, body is not a real key
  // A .pub file is never read as a private-key candidate.
  expect(h.invoke).not.toHaveBeenCalledWith("fs_read_text_home", {
    path: "/home/u/.ssh/id_rsa.pub",
  });
});

test("scanSshKeys returns an empty list when ~/.ssh is missing or unreadable", async () => {
  h.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "fs_home_dir") return "/home/u";
    if (cmd === "fs_list_dir") throw new Error("Cannot read directory");
    return undefined;
  });

  await expect(scanSshKeys()).resolves.toEqual([]);
});

test("scanSshKeys skips a candidate that cannot be read", async () => {
  routeScan([entry("id_rsa"), entry("id_ed25519")], {
    "/home/u/.ssh/id_ed25519": OPENSSH_PEM,
  });

  const keys = await scanSshKeys();
  expect(keys.map((k) => k.name)).toEqual(["id_ed25519"]);
});

test("scanSshKeys inspects only the head of a candidate", async () => {
  // A private-key header beyond the head window must not be detected.
  const padding = "x".repeat(KEY_HEAD_BYTES);
  routeScan([entry("late")], { "/home/u/.ssh/late": `${padding}${RSA_PEM}` });

  await expect(scanSshKeys()).resolves.toEqual([]);
});

// ─── loading a pair ──────────────────────────────────────────────────────────

test("loadSshKeyPair reads the private key and its sibling .pub", async () => {
  routeScan([], {
    "/home/u/.ssh/id_rsa": RSA_PEM,
    "/home/u/.ssh/id_rsa.pub": PUBLIC_KEY,
  });

  await expect(loadSshKeyPair("/home/u/.ssh/id_rsa")).resolves.toEqual({
    privateKey: RSA_PEM,
    publicKey: PUBLIC_KEY,
  });
  expect(h.invoke).toHaveBeenCalledWith("fs_read_text_home", {
    path: "/home/u/.ssh/id_rsa.pub",
  });
});

test("loadSshKeyPair returns a null public half when there is no sibling .pub", async () => {
  routeScan([], { "/home/u/.ssh/id_rsa": RSA_PEM });

  await expect(loadSshKeyPair("/home/u/.ssh/id_rsa")).resolves.toEqual({
    privateKey: RSA_PEM,
    publicKey: null,
  });
});

test("loadSshKeyPair rejects when the private key itself cannot be read", async () => {
  routeScan([], {});
  await expect(loadSshKeyPair("/home/u/.ssh/missing")).rejects.toThrow("not readable");
});
