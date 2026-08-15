import { describe, expect, test } from "vitest";
import { generateRefreshToken, hashRefreshToken } from "../../../src/modules/auth/auth.tokens.js";

describe("refresh tokens", () => {
  test("gera token opaco com entropia suficiente", () => {
    expect(generateRefreshToken().length).toBeGreaterThanOrEqual(43);
  });

  test("dois tokens gerados nunca são iguais", () => {
    expect(generateRefreshToken()).not.toBe(generateRefreshToken());
  });

  test("o hash é determinístico e não revela o token", () => {
    const token = generateRefreshToken();
    const hash = hashRefreshToken(token);

    expect(hash).toBe(hashRefreshToken(token));
    expect(hash).not.toBe(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
