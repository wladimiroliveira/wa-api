import { describe, expect, test } from "vitest";
import { hashPassword, verifyPassword } from "../../../src/modules/auth/auth.password.js";

describe("password hashing", () => {
  test("o hash não contém a senha em claro", async () => {
    const hash = await hashPassword("senha-secreta");

    expect(hash).not.toContain("senha-secreta");
    expect(hash.startsWith("scrypt:")).toBe(true);
  });

  test("a mesma senha gera hashes diferentes por causa do salt", async () => {
    expect(await hashPassword("senha-secreta")).not.toBe(await hashPassword("senha-secreta"));
  });

  test("verifica a senha correta", async () => {
    const hash = await hashPassword("senha-secreta");

    expect(await verifyPassword("senha-secreta", hash)).toBe(true);
  });

  test("recusa a senha errada", async () => {
    const hash = await hashPassword("senha-secreta");

    expect(await verifyPassword("senha-errada", hash)).toBe(false);
  });

  test("recusa hash malformado sem estourar", async () => {
    expect(await verifyPassword("senha-secreta", "")).toBe(false);
    expect(await verifyPassword("senha-secreta", "senha-secreta")).toBe(false);
    expect(await verifyPassword("senha-secreta", "bcrypt:aa:bb")).toBe(false);
    expect(await verifyPassword("senha-secreta", "scrypt:aa")).toBe(false);
    expect(await verifyPassword("senha-secreta", "scrypt:aa:bb")).toBe(false);
  });
});
