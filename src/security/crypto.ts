import { constantTimeBytesEqual } from "./constant-time";

const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[a-f\d]{64}$/i.test(value)) {
    return null;
  }

  const pairs = value.match(/.{2}/g);
  if (pairs === null) {
    return null;
  }

  return Uint8Array.from(pairs.map((pair) => Number.parseInt(pair, 16)));
}

export async function sha256Hex(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return bytesToHex(new Uint8Array(digest));
}

export async function verifyMetaSignature(
  rawBody: ArrayBuffer,
  signatureHeader: string | null,
  appSecret: string,
): Promise<boolean> {
  if (signatureHeader === null || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const suppliedSignature = hexToBytes(signatureHeader.slice("sha256=".length));
  if (suppliedSignature === null) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, rawBody),
  );

  return constantTimeBytesEqual(expected, suppliedSignature);
}
