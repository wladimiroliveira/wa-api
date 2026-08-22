import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "../../src/lib/env.js";

const DATABASE_URL = "postgres://user:pass@localhost:5432/wa_api";

async function importEnv() {
  vi.resetModules();
  return import("../../src/lib/env.js");
}

describe("parseEnv", () => {
  it("accepts a postgres connection string and defaults the port", () => {
    expect(parseEnv({ DATABASE_URL: "postgresql://user:pass@localhost:5432/wa_api" })).toEqual({
      API_PORT: 3333,
      DATABASE_URL: "postgresql://user:pass@localhost:5432/wa_api",
    });
  });

  it("names the offending variable when DATABASE_URL is missing", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects a connection string that is not postgres", () => {
    expect(() => parseEnv({ DATABASE_URL: "mysql://user:pass@localhost:3306/wa_api" })).toThrow(/DATABASE_URL/);
  });

  it("coerces API_PORT from the string the environment provides", () => {
    const env = parseEnv({ DATABASE_URL: "postgres://user:pass@localhost:5432/wa_api", API_PORT: "4000" });
    expect(env.API_PORT).toBe(4000);
  });
});

describe("loadEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reads the variables from the process environment", async () => {
    vi.stubEnv("DATABASE_URL", DATABASE_URL);
    vi.stubEnv("API_PORT", "4100");
    const { loadEnv } = await importEnv();

    expect(loadEnv()).toEqual({ API_PORT: 4100, DATABASE_URL });
  });

  it("caches the first read instead of parsing the environment again", async () => {
    vi.stubEnv("DATABASE_URL", DATABASE_URL);
    const { loadEnv } = await importEnv();
    const first = loadEnv();

    vi.stubEnv("DATABASE_URL", "postgres://user:pass@localhost:5432/other");

    expect(loadEnv()).toBe(first);
    expect(loadEnv().DATABASE_URL).toBe(DATABASE_URL);
  });
});
