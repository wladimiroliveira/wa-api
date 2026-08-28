import { describe, expect, it } from "vitest";
import {
  createRefreshToken,
  hashRefreshToken,
  refreshTokenExpiration,
} from "../../../src/modules/auth/auth.refresh-token.js";

describe("createRefreshToken", () => {
  it("carries 32 bytes of randomness", () => {
    expect(Buffer.from(createRefreshToken().token, "base64url")).toHaveLength(32);
  });

  it("never repeats a token", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => createRefreshToken().token));

    expect(tokens.size).toBe(100);
  });

  it("pairs the token with the hash that will be stored in its place", () => {
    const { token, tokenHash } = createRefreshToken();

    expect(tokenHash).toBe(hashRefreshToken(token));
    expect(tokenHash).not.toBe(token);
  });
});

describe("hashRefreshToken", () => {
  it("answers the same hash for the same token", () => {
    expect(hashRefreshToken("a-token")).toBe(hashRefreshToken("a-token"));
  });

  it("answers a different hash for a different token", () => {
    expect(hashRefreshToken("a-token")).not.toBe(hashRefreshToken("another-token"));
  });
});

describe("refreshTokenExpiration", () => {
  it("adds the configured number of days to the moment it is called", () => {
    const now = new Date("2026-08-26T12:00:00.000Z");

    expect(refreshTokenExpiration(now, 30).toISOString()).toBe("2026-09-25T12:00:00.000Z");
  });
});
