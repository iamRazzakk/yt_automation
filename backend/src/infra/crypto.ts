import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALGO = "aes-256-gcm";

export function encryptToken(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptToken(payload: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function signSession(
  payload: { iat: number; exp: number },
  secret: string,
): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(
  token: string,
  secret: string,
): { iat: number; exp: number } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      iat: number;
      exp: number;
    };
    if (typeof parsed.iat !== "number" || typeof parsed.exp !== "number") return null;
    if (Date.now() / 1000 > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    // still compare to avoid leaking length via timing of early return alone
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}
