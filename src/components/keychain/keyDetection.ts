// ─────────────────────────────────────────────────────────────────
// SSH key detection
// ─────────────────────────────────────────────────────────────────

export const PUB_TYPE_MAP: Record<string, string> = {
  "ssh-ed25519": "ED25519",
  "ssh-rsa": "RSA",
  "ecdsa-sha2-nistp256": "ECDSA P-256",
  "ecdsa-sha2-nistp384": "ECDSA P-384",
  "ecdsa-sha2-nistp521": "ECDSA P-521",
  "ssh-dss": "DSA",
};

const PEM_TYPE_MAP: Record<string, string> = {
  "OPENSSH PRIVATE KEY": "OpenSSH",
  "RSA PRIVATE KEY": "RSA",
  "EC PRIVATE KEY": "ECDSA",
  "DSA PRIVATE KEY": "DSA",
  "PRIVATE KEY": "PKCS8",
  "ENCRYPTED PRIVATE KEY": "PKCS8",
};

const PPK_TYPE_MAP = PUB_TYPE_MAP;

type KeyInfo = { type: string | null; valid: boolean; error?: string };

function invalid(error: string): KeyInfo {
  return { type: null, valid: false, error };
}

function isBase64(value: string): boolean {
  return value.length > 0
    && value.length % 4 !== 1
    && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

function decodeBase64(value: string): string | null {
  const compact = value.replace(/\s/g, "");
  if (!isBase64(compact)) return null;
  try {
    return atob(compact);
  } catch {
    return null;
  }
}

function detectOpenSsh(body: string, publicKey: string): KeyInfo {
  const bin = decodeBase64(body);
  if (!bin) return invalid("Malformed OpenSSH private key");

  const magic = "openssh-key-v1\0";
  if (!bin.startsWith(magic)) return invalid("Malformed OpenSSH private key");

  const readU32 = (position: number): number => {
    if (position + 4 > bin.length) throw new Error("truncated");
    return (((bin.charCodeAt(position) << 24) | (bin.charCodeAt(position + 1) << 16)
      | (bin.charCodeAt(position + 2) << 8) | bin.charCodeAt(position + 3)) >>> 0);
  };
  const skipString = (position: number): number => {
    const length = readU32(position);
    const end = position + 4 + length;
    if (end > bin.length) throw new Error("truncated");
    return end;
  };

  try {
    let position = magic.length;
    position = skipString(position); // cipher
    position = skipString(position); // kdf
    position = skipString(position); // kdf options
    const keyCount = readU32(position);
    position += 4;
    if (keyCount < 1) return invalid("Malformed OpenSSH private key");

    const publicBlockEnd = skipString(position);
    const privateBlockLength = readU32(publicBlockEnd);
    if (privateBlockLength < 1 || publicBlockEnd + 4 + privateBlockLength > bin.length) {
      return invalid("Malformed OpenSSH private key");
    }
    const typeLength = readU32(position + 4);
    const typeStart = position + 8;
    if (typeStart + typeLength > publicBlockEnd) throw new Error("truncated");
    const keyType = bin.slice(typeStart, typeStart + typeLength);
    if (!keyType) return invalid("Malformed OpenSSH private key");

    const suppliedPublicKey = publicKey.trim();
    for (const [prefix, type] of Object.entries(PUB_TYPE_MAP)) {
      if (suppliedPublicKey.startsWith(prefix)) return { type, valid: true };
    }
    return { type: PUB_TYPE_MAP[keyType] ?? keyType, valid: true };
  } catch {
    return invalid("Malformed OpenSSH private key");
  }
}

function detectPem(privateKey: string, publicKey: string): KeyInfo | null {
  const match = /^-----BEGIN ([A-Z0-9 ]+)-----\s*([\s\S]*?)\s*-----END \1-----$/.exec(privateKey);
  if (!match) return null;

  const label = match[1];
  const type = PEM_TYPE_MAP[label];
  if (!type) return invalid("Unsupported private key format");

  const body = match[2]
    .split(/\r?\n/)
    .filter((line) => !/^(Proc-Type|DEK-Info):/i.test(line.trim()))
    .join("")
    .replace(/\s/g, "");
  if (!isBase64(body)) return invalid("Malformed private key");

  if (label === "OPENSSH PRIVATE KEY") return detectOpenSsh(body, publicKey);
  return { type, valid: true };
}

function detectPpk(privateKey: string): KeyInfo | null {
  if (!privateKey.startsWith("PuTTY-User-Key-File-")) return null;
  const lines = privateKey.split(/\r?\n/).map((line) => line.trim());
  const header = /^PuTTY-User-Key-File-[23]:\s*(\S+)$/.exec(lines[0] ?? "");
  if (!header) return invalid("Malformed PPK private key");

  const type = PPK_TYPE_MAP[header[1]];
  if (!type) return invalid("Unsupported PPK key type");
  if (!lines.some((line) => /^Encryption:\s*\S+$/i.test(line))) {
    return invalid("Malformed PPK private key");
  }

  const readBlock = (name: "Public-Lines" | "Private-Lines"): string[] | null => {
    const index = lines.findIndex((line) => line.startsWith(`${name}:`));
    if (index < 0) return null;
    const count = Number(lines[index].slice(name.length + 1).trim());
    if (!Number.isInteger(count) || count < 1) return null;
    const block = lines.slice(index + 1, index + 1 + count);
    return block.length === count && block.every(Boolean) ? block : null;
  };

  const publicLines = readBlock("Public-Lines");
  const privateLines = readBlock("Private-Lines");
  if (!publicLines || !privateLines || !lines.some((line) => line.startsWith("Private-MAC:"))) {
    return invalid("Malformed PPK private key");
  }
  if (!isBase64(publicLines.join("")) || !isBase64(privateLines.join(""))) {
    return invalid("Malformed PPK private key");
  }
  return { type, valid: true };
}

export function detectKeyInfo(
  privateKey: string,
  publicKey: string,
): KeyInfo {
  const pk = privateKey.trim();
  if (!pk) return { type: null, valid: true };

  const ppk = detectPpk(pk);
  if (ppk) return ppk;

  const pem = detectPem(pk, publicKey);
  if (pem) return pem;

  return invalid("Unrecognized key format");
}
