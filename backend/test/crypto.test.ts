import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  decryptToken,
  encryptToken,
  signSession,
  verifySession,
} from "../src/infra/crypto.js";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("crypto", () => {
  it("round-trips encrypted tokens", () => {
    const enc = encryptToken("refresh-token-value", KEY);
    expect(decryptToken(enc, KEY)).toBe("refresh-token-value");
  });

  it("signs and verifies sessions", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signSession({ iat: now, exp: now + 3600 }, "secret-secret-secret-secret-secret!!");
    const parsed = verifySession(token, "secret-secret-secret-secret-secret!!");
    expect(parsed?.iat).toBe(now);
  });

  it("rejects tampered sessions", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signSession({ iat: now, exp: now + 3600 }, "secret-secret-secret-secret-secret!!");
    expect(verifySession(token + "x", "secret-secret-secret-secret-secret!!")).toBeNull();
  });

  it("constant-time compares", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "ab")).toBe(false);
  });
});
