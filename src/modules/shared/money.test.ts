import { describe, expect, test } from "vitest";
import { Prisma } from "../../generated/prisma/index.js";
import { ONE_REAL, roundUpToNearest } from "./money.js";

describe("money.roundUpToNearest", () => {
  test("arredonda 103,73 para cima → 104", () => {
    expect(roundUpToNearest(new Prisma.Decimal("103.73"), ONE_REAL).equals(104)).toBe(true);
  });

  test("valor já inteiro não muda", () => {
    expect(roundUpToNearest(new Prisma.Decimal("52"), ONE_REAL).equals(52)).toBe(true);
  });

  test("52,01 → 53", () => {
    expect(roundUpToNearest(new Prisma.Decimal("52.01"), ONE_REAL).equals(53)).toBe(true);
  });
});
