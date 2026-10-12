import { describe, expect, it } from "vitest";
import { Prisma } from "../../../src/generated/prisma/index.js";
import { allocate } from "../../../src/modules/stock/stock.allocation.js";

const decimal = (value: string) => new Prisma.Decimal(value);
const lot = (id: string, quantity: string) => ({ id, quantity: decimal(quantity) });

const read = ({ takes, shortfall }: ReturnType<typeof allocate<{ id: string; quantity: Prisma.Decimal }>>) => ({
  takes: takes.map(({ lot: { id }, quantity }) => `${id}:${quantity}`),
  shortfall: shortfall.toString(),
});

describe("allocate", () => {
  it("takes everything from the first lot when it covers the quantity", () => {
    expect(read(allocate([lot("a", "5"), lot("b", "5")], decimal("3")))).toEqual({ takes: ["a:3"], shortfall: "0" });
  });

  it("empties each lot in turn until the quantity is covered", () => {
    expect(read(allocate([lot("a", "1"), lot("b", "2"), lot("c", "5")], decimal("4")))).toEqual({
      takes: ["a:1", "b:2", "c:1"],
      shortfall: "0",
    });
  });

  it("tells what the lots did not cover", () => {
    expect(read(allocate([lot("a", "1.5")], decimal("4")))).toEqual({ takes: ["a:1.5"], shortfall: "2.5" });
  });

  it("takes nothing when there is no lot", () => {
    expect(read(allocate([], decimal("4")))).toEqual({ takes: [], shortfall: "4" });
  });
});
