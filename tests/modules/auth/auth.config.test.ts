import { describe, expect, test } from "vitest";
import { loadAuthConfig } from "../../../src/modules/auth/auth.config.js";

const validEnv = {
  JWT_SECRET: "a".repeat(32),
  CORS_ORIGINS: "http://localhost:5173",
};

describe("loadAuthConfig", () => {
  test("aplica os padrões de vida útil dos tokens e do limite de login", () => {
    const config = loadAuthConfig(validEnv);

    expect(config.accessTokenTtl).toBe("15m");
    expect(config.refreshTokenTtlDays).toBe(30);
    expect(config.loginRateLimitMax).toBe(5);
    expect(config.refreshRateLimitMax).toBe(60);
  });

  test("quebra a lista de origens do CORS por vírgula, ignorando espaços", () => {
    const config = loadAuthConfig({ ...validEnv, CORS_ORIGINS: "http://a.test , http://b.test" });

    expect(config.corsOrigins).toEqual(["http://a.test", "http://b.test"]);
  });

  test("recusa segredo curto demais", () => {
    expect(() => loadAuthConfig({ ...validEnv, JWT_SECRET: "curto" })).toThrow(/JWT_SECRET/);
  });

  test("recusa ausência de JWT_SECRET", () => {
    expect(() => loadAuthConfig({ CORS_ORIGINS: "http://a.test" })).toThrow(/JWT_SECRET/);
  });

  test("recusa ausência de CORS_ORIGINS", () => {
    expect(() => loadAuthConfig({ JWT_SECRET: "a".repeat(32) })).toThrow(/CORS_ORIGINS/);
  });

  test("aceita sobrescrita da vida útil e dos limites de tentativa", () => {
    const config = loadAuthConfig({
      ...validEnv,
      ACCESS_TOKEN_TTL: "5m",
      REFRESH_TOKEN_TTL_DAYS: "7",
      LOGIN_RATE_LIMIT_MAX: "1000",
      REFRESH_RATE_LIMIT_MAX: "900",
    });

    expect(config.accessTokenTtl).toBe("5m");
    expect(config.refreshTokenTtlDays).toBe(7);
    expect(config.loginRateLimitMax).toBe(1000);
    expect(config.refreshRateLimitMax).toBe(900);
  });
});
