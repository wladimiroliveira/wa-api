import { describe, expect, it } from "vitest";
import { Prisma } from "../../../src/generated/prisma/index.js";
import { allocate, costOfShortfall, inOrderOfUse, owedOf } from "../../../src/modules/stock/stock.allocation.js";

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

describe("inOrderOfUse", () => {
  const held = (id: string, expiresAt: string | null, createdAt: string) => ({
    id,
    expiresAt: expiresAt === null ? null : new Date(expiresAt),
    createdAt: new Date(createdAt),
  });
  const ids = (lots: { id: string }[]) => lots.map(({ id }) => id);

  it("puts the first to expire first, whatever the order they came in", () => {
    const lots = [held("a", "2026-03-01", "2026-01-01T10:00:00Z"), held("b", "2026-02-01", "2026-01-02T10:00:00Z")];

    expect(ids(inOrderOfUse(lots))).toEqual(["b", "a"]);
  });

  it("puts the ones that never expire last", () => {
    const lots = [held("a", null, "2026-01-01T10:00:00Z"), held("b", "2099-12-31", "2026-01-02T10:00:00Z")];

    expect(ids(inOrderOfUse(lots))).toEqual(["b", "a"]);
  });

  it("puts the one that came in earlier ahead of another expiring on the same day", () => {
    const lots = [
      held("a", "2026-03-01", "2026-01-02T10:00:00Z"),
      held("b", "2026-03-01", "2026-01-01T10:00:00Z"),
      held("d", null, "2026-01-02T10:00:00Z"),
      held("c", null, "2026-01-01T10:00:00Z"),
    ];

    expect(ids(inOrderOfUse(lots))).toEqual(["b", "a", "c", "d"]);
  });

  it("settles lots that came in at the same instant by their id", () => {
    const lots = [held("b", "2026-03-01", "2026-01-01T10:00:00Z"), held("a", "2026-03-01", "2026-01-01T10:00:00Z")];

    expect(ids(inOrderOfUse(lots))).toEqual(["a", "b"]);
  });

  it("leaves the list it was given as it was", () => {
    const lots = [held("a", null, "2026-01-01T10:00:00Z"), held("b", "2026-02-01", "2026-01-02T10:00:00Z")];

    inOrderOfUse(lots);

    expect(ids(lots)).toEqual(["a", "b"]);
  });
});

describe("owedOf", () => {
  it.each([
    ["nothing when the balance matches what the lots hold", "10", "10", "0"],
    ["what the lots hold beyond the balance", "10", "7.5", "2.5"],
    ["the whole negative balance when no lot holds anything", "0", "-4", "4"],
    ["nothing when the balance is above what the lots hold", "3", "5", "0"],
  ])("is %s", (_label, held, quantity, owed) => {
    expect(owedOf({ held: decimal(held), quantity: decimal(quantity) }).toString()).toBe(owed);
  });
});

describe("costOfShortfall", () => {
  const cost = (value: string | null) => (value === null ? null : decimal(value));

  it.each([
    ["the last lot taken from", "3", "4", "5", "3"],
    ["the newest lot the product had when none was taken from", null, "4", "5", "4"],
    ["the last entry when the product never had a lot", null, null, "5", "5"],
    ["nothing when the product never came in", null, null, null, "0"],
  ])("is the cost of %s", (_label, lastLotTaken, newestLot, lastEntry, expected) => {
    expect(
      costOfShortfall({
        lastLotTaken: cost(lastLotTaken),
        newestLot: cost(newestLot),
        lastEntry: cost(lastEntry),
      }).toString(),
    ).toBe(expected);
  });
});
