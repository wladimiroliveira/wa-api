import { expect, test } from "vitest";
import { Prisma } from "../generated/prisma/index.js";

test("Prisma.Decimal faz aritmética exata", () => {
  const total = new Prisma.Decimal("0.1").add("0.2");
  expect(total.equals("0.3")).toBe(true);
});
