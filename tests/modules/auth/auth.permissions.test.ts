import { describe, expect, it } from "vitest";
import { Permission } from "../../../src/generated/prisma/index.js";
import { effectivePermissions, hasPermission } from "../../../src/modules/auth/auth.permissions.js";

describe("effectivePermissions", () => {
  it("unites what the role grants with what the user carries", () => {
    const permissions = effectivePermissions({
      rolePermissions: [Permission.SALES_READ, Permission.SALES_CREATE],
      extraPermissions: [Permission.REPORTS_READ],
    });

    expect([...permissions].sort()).toEqual([Permission.REPORTS_READ, Permission.SALES_CREATE, Permission.SALES_READ]);
  });

  it("keeps a permission present on both sides once", () => {
    const permissions = effectivePermissions({
      rolePermissions: [Permission.CATALOG_READ],
      extraPermissions: [Permission.CATALOG_READ],
    });

    expect(permissions).toEqual([Permission.CATALOG_READ]);
  });

  it("answers with the user's own permissions when there is no role", () => {
    expect(effectivePermissions({ rolePermissions: [], extraPermissions: [Permission.ENTRIES_CREATE] })).toEqual([
      Permission.ENTRIES_CREATE,
    ]);
  });

  it("answers empty for a user with neither role nor permissions", () => {
    expect(effectivePermissions({ rolePermissions: [], extraPermissions: [] })).toEqual([]);
  });
});

describe("hasPermission", () => {
  it("confirms a permission the user holds", () => {
    expect(hasPermission([Permission.SALES_READ], Permission.SALES_READ)).toBe(true);
  });

  it("denies a permission the user does not hold", () => {
    expect(hasPermission([Permission.SALES_READ], Permission.SALES_CREATE)).toBe(false);
  });
});
