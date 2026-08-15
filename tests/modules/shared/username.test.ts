import { describe, expect, test } from "vitest";
import { usernameSchema } from "../../../src/modules/shared/username.js";

describe("usernameSchema", () => {
  test("aceita letras, números, ponto, traço e sublinhado", () => {
    for (const value of ["wladimir", "maria.souza", "joao_2", "ana-paula", "abc"]) {
      expect(usernameSchema.parse(value)).toBe(value);
    }
  });

  test("normaliza para minúsculas", () => {
    expect(usernameSchema.parse("Maria")).toBe("maria");
    expect(usernameSchema.parse("WLADIMIR")).toBe("wladimir");
    expect(usernameSchema.parse("Maria.Souza")).toBe("maria.souza");
  });

  test("remove espaço em volta antes de normalizar", () => {
    expect(usernameSchema.parse("  Maria  ")).toBe("maria");
  });

  test("recusa curto ou longo demais", () => {
    expect(usernameSchema.safeParse("ab").success).toBe(false);
    expect(usernameSchema.safeParse("a".repeat(31)).success).toBe(false);
    expect(usernameSchema.safeParse("a".repeat(30)).success).toBe(true);
  });

  test("recusa caractere fora do conjunto permitido", () => {
    for (const value of ["maria souza", "maria@example.com", "maria+1", "maria/souza", "maríá"]) {
      expect(usernameSchema.safeParse(value).success).toBe(false);
    }
  });

  test("recusa vazio", () => {
    expect(usernameSchema.safeParse("").success).toBe(false);
  });

  test("valida o conjunto de caracteres depois de normalizar a caixa", () => {
    expect(usernameSchema.parse("MARIA.SOUZA")).toBe("maria.souza");
  });
});
