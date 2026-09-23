import { describe, expect, it } from "vitest";
import { detectKeyInfo } from "./keyDetection";

const RSA_PEM = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIB",
  "-----END RSA PRIVATE KEY-----",
].join("\n");

const PKCS8_PEM = [
  "-----BEGIN PRIVATE KEY-----",
  "MIIB",
  "-----END PRIVATE KEY-----",
].join("\n");

const PPK_RSA = [
  "PuTTY-User-Key-File-3: ssh-rsa",
  "Encryption: none",
  "Comment: fixture",
  "Public-Lines: 1",
  "AAAA",
  "Private-Lines: 1",
  "AAAA",
  "Private-MAC: fixture",
].join("\n");

const OPENSSH_FIXTURE = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAADwAAAAtzc2gtZWQyNTUxOQAAAAEA",
  "-----END OPENSSH PRIVATE KEY-----",
].join("\n");

describe("detectKeyInfo", () => {
  it.each([
    [RSA_PEM, "RSA"],
    [PKCS8_PEM, "PKCS8"],
    [PPK_RSA, "RSA"],
    [OPENSSH_FIXTURE, "ED25519"],
  ])("accepts the supported %s key shape", (privateKey, type) => {
    expect(detectKeyInfo(privateKey, "")).toMatchObject({ type, valid: true });
  });

  it("accepts encrypted PEM and PPK shapes for backend passphrase validation", () => {
    const encryptedPem = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "Proc-Type: 4,ENCRYPTED",
      "DEK-Info: AES-256-CBC,fixture",
      "MIIB",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const encryptedPpk = PPK_RSA.replace("Encryption: none", "Encryption: aes256-cbc");

    expect(detectKeyInfo(encryptedPem, "")).toMatchObject({ type: "RSA", valid: true });
    expect(detectKeyInfo(encryptedPpk, "")).toMatchObject({ type: "RSA", valid: true });
  });

  it("rejects malformed and unknown key input", () => {
    expect(detectKeyInfo(
      "-----BEGIN RSA PRIVATE KEY-----\nnot-base64!\n-----END RSA PRIVATE KEY-----",
      "",
    ).valid).toBe(false);
    expect(detectKeyInfo("not a private key", "").valid).toBe(false);
  });
});
