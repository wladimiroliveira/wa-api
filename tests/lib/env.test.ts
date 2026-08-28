import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "../../src/lib/env.js";

const DATABASE_URL = "postgres://user:pass@localhost:5432/wa_api";
const JWT_SECRET = "a-secret-long-enough-to-be-taken-seriously";
const REQUIRED = { DATABASE_URL, JWT_SECRET };

async function importEnv() {
  vi.resetModules();
  return import("../../src/lib/env.js");
}

describe("parseEnv", () => {
  it("accepts a postgres connection string and defaults the port", () => {
    expect(parseEnv({ ...REQUIRED })).toEqual({
      API_PORT: 3333,
      DATABASE_URL,
      JWT_SECRET,
      ACCESS_TOKEN_TTL_MINUTES: 15,
      REFRESH_TOKEN_TTL_DAYS: 30,
      CORS_ORIGINS: [],
    });
  });

  it("names the offending variable when DATABASE_URL is missing", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects a connection string that is not postgres", () => {
    expect(() => parseEnv({ ...REQUIRED, DATABASE_URL: "mysql://user:pass@localhost:3306/wa_api" })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("coerces API_PORT from the string the environment provides", () => {
    const env = parseEnv({ ...REQUIRED, API_PORT: "4000" });
    expect(env.API_PORT).toBe(4000);
  });
});

describe("authentication variables", () => {
  it("rejects a JWT secret short enough to be guessed", () => {
    expect(() => parseEnv({ DATABASE_URL, JWT_SECRET: "short" })).toThrow(/JWT_SECRET/);
  });

  it("names JWT_SECRET when it is missing", () => {
    expect(() => parseEnv({ DATABASE_URL })).toThrow(/JWT_SECRET/);
  });

  it("splits CORS_ORIGINS on commas and trims each origin", () => {
    const env = parseEnv({ ...REQUIRED, CORS_ORIGINS: "http://localhost:5173, https://app.example.com" });

    expect(env.CORS_ORIGINS).toEqual(["http://localhost:5173", "https://app.example.com"]);
  });

  it("reads the token lifetimes from the environment", () => {
    const env = parseEnv({ ...REQUIRED, ACCESS_TOKEN_TTL_MINUTES: "5", REFRESH_TOKEN_TTL_DAYS: "7" });

    expect(env.ACCESS_TOKEN_TTL_MINUTES).toBe(5);
    expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(7);
  });
});

describe("loadEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // Every variable the assertion names is stubbed: the module loads the developer's .env, so a case
  // that left one of them to the default would pass or fail depending on the machine it runs on.
  it("reads the variables from the process environment", async () => {
    vi.stubEnv("DATABASE_URL", DATABASE_URL);
    vi.stubEnv("JWT_SECRET", JWT_SECRET);
    vi.stubEnv("API_PORT", "4100");
    vi.stubEnv("ACCESS_TOKEN_TTL_MINUTES", "5");
    vi.stubEnv("REFRESH_TOKEN_TTL_DAYS", "7");
    vi.stubEnv("CORS_ORIGINS", "https://app.example.com");
    const { loadEnv } = await importEnv();

    expect(loadEnv()).toEqual({
      API_PORT: 4100,
      DATABASE_URL,
      JWT_SECRET,
      ACCESS_TOKEN_TTL_MINUTES: 5,
      REFRESH_TOKEN_TTL_DAYS: 7,
      CORS_ORIGINS: ["https://app.example.com"],
    });
  });

  it("caches the first read instead of parsing the environment again", async () => {
    vi.stubEnv("DATABASE_URL", DATABASE_URL);
    vi.stubEnv("JWT_SECRET", JWT_SECRET);
    const { loadEnv } = await importEnv();
    const first = loadEnv();

    vi.stubEnv("DATABASE_URL", "postgres://user:pass@localhost:5432/other");

    expect(loadEnv()).toBe(first);
    expect(loadEnv().DATABASE_URL).toBe(DATABASE_URL);
  });
});
