import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findSchemaConventionViolations } from "../../scripts/schema-convention.js";

const SCHEMA = readFileSync(fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)), "utf8");

const PERMISSIONS = [
  "CATALOG_READ",
  "CATALOG_CREATE",
  "CATALOG_UPDATE",
  "ENTRIES_READ",
  "ENTRIES_CREATE",
  "PRODUCTION_READ",
  "PRODUCTION_CREATE",
  "SALES_READ",
  "SALES_CREATE",
  "REPORTS_READ",
  "ACCESS_READ",
  "ACCESS_CREATE",
  "ACCESS_UPDATE",
];

describe("auth schema", () => {
  it("declares every permission the spec lists, and nothing else", () => {
    const block = /enum Permission \{([\s\S]*?)\n\}/.exec(SCHEMA);
    expect(block).not.toBeNull();

    const values = block![1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("@@"));

    expect(values.sort()).toEqual([...PERMISSIONS].sort());
  });

  it("maps the enum type to snake_case", () => {
    expect(SCHEMA).toMatch(/enum Permission \{[\s\S]*?@@map\("permission"\)/);
  });

  it("declares the three auth tables", () => {
    expect(SCHEMA).toMatch(/model Role \{[\s\S]*?@@map\("roles"\)/);
    expect(SCHEMA).toMatch(/model User \{[\s\S]*?@@map\("users"\)/);
    expect(SCHEMA).toMatch(/model RefreshToken \{[\s\S]*?@@map\("refresh_tokens"\)/);
  });

  it("keeps the user's own permissions under a name that cannot be read as the effective set", () => {
    expect(SCHEMA).toMatch(/extraPermissions\s+Permission\[\]\s+@map\("extra_permissions"\)/);
  });

  it("indexes refresh tokens by user, because revoking in bulk is routine", () => {
    expect(SCHEMA).toMatch(/@@index\(\[userId\], map: "idx_refresh_tokens_user_id"\)/);
  });

  it("violates no rule of the table convention", () => {
    expect(findSchemaConventionViolations(SCHEMA)).toEqual([]);
  });
});
