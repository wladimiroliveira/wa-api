import { describe, expect, test } from "vitest";
import { effectivePermissions } from "../../../src/modules/auth/auth.permissions.js";
import { Permission } from "../../../src/generated/prisma/index.js";

const empty = { rolePermissions: [], grantedPermissions: [], deniedPermissions: [] };

describe("effectivePermissions", () => {
  test("herda as permissões do papel", () => {
    const result = effectivePermissions({ ...empty, rolePermissions: [Permission.STOCK_READ] });

    expect([...result]).toEqual([Permission.STOCK_READ]);
  });

  test("soma as exceções concedidas ao usuário", () => {
    const result = effectivePermissions({
      ...empty,
      rolePermissions: [Permission.STOCK_READ],
      grantedPermissions: [Permission.PRICING_READ],
    });

    expect([...result].sort()).toEqual([Permission.PRICING_READ, Permission.STOCK_READ].sort());
  });

  test("subtrai as exceções negadas ao usuário", () => {
    const result = effectivePermissions({
      ...empty,
      rolePermissions: [Permission.STOCK_READ, Permission.STOCK_WRITE],
      deniedPermissions: [Permission.STOCK_WRITE],
    });

    expect([...result]).toEqual([Permission.STOCK_READ]);
  });

  test("negação ganha da concessão explícita", () => {
    const result = effectivePermissions({
      ...empty,
      grantedPermissions: [Permission.USERS_WRITE],
      deniedPermissions: [Permission.USERS_WRITE],
    });

    expect(result.has(Permission.USERS_WRITE)).toBe(false);
  });

  test("usuário sem papel fica só com o que foi concedido", () => {
    const result = effectivePermissions({ ...empty, grantedPermissions: [Permission.WASTE_READ] });

    expect([...result]).toEqual([Permission.WASTE_READ]);
  });

  test("usuário sem papel e sem exceção não tem permissão nenhuma", () => {
    expect(effectivePermissions(empty).size).toBe(0);
  });

  test("permissão repetida entre papel e concessão aparece uma vez só", () => {
    const result = effectivePermissions({
      ...empty,
      rolePermissions: [Permission.RECIPES_READ],
      grantedPermissions: [Permission.RECIPES_READ],
    });

    expect(result.size).toBe(1);
  });

  test("negar uma permissão que ninguém tem não quebra nada", () => {
    const result = effectivePermissions({
      ...empty,
      rolePermissions: [Permission.RECIPES_READ],
      deniedPermissions: [Permission.USERS_WRITE],
    });

    expect([...result]).toEqual([Permission.RECIPES_READ]);
  });
});
