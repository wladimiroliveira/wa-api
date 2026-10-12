import { describe, expect, it } from "vitest";
import { Prisma } from "../../../src/generated/prisma/index.js";
import { expiryOf, lotStatusOf, statusOf, valueOf } from "../../../src/modules/stock/stock.position.js";

const TODAY = "2026-10-12";
const day = (date: string) => new Date(`${date}T00:00:00.000Z`);
const decimal = (value: string) => new Prisma.Decimal(value);

const lot = (quantity: string, expiresAt: string | null, unitCost = "4") => ({
  quantity: decimal(quantity),
  unitCost: decimal(unitCost),
  expiresAt: expiresAt === null ? null : day(expiresAt),
});

const balance = (quantity: string, minimumQuantity: string | null = null) => ({
  quantity: decimal(quantity),
  minimumQuantity: minimumQuantity === null ? null : decimal(minimumQuantity),
});

describe("expiryOf", () => {
  it.each([
    ["a lot with no expiry date", null, "OK"],
    ["a lot that expired yesterday", "2026-10-11", "EXPIRED"],
    ["a lot that expires today", "2026-10-12", "EXPIRING_SOON"],
    ["a lot that expires in thirty days", "2026-11-11", "EXPIRING_SOON"],
    ["a lot that expires in thirty-one days", "2026-11-12", "OK"],
  ])("reads %s", (_label, expiresAt, expected) => {
    expect(expiryOf(expiresAt === null ? null : day(expiresAt), TODAY)).toBe(expected);
  });
});

describe("lotStatusOf", () => {
  it("reads a lot with nothing left as depleted, whatever its date", () => {
    expect(lotStatusOf(lot("0", "2026-10-01"), TODAY)).toBe("DEPLETED");
  });

  it("reads a lot with something left by its date", () => {
    expect(lotStatusOf(lot("1", "2026-10-01"), TODAY)).toBe("EXPIRED");
    expect(lotStatusOf(lot("1", null), TODAY)).toBe("OK");
  });
});

describe("statusOf", () => {
  it.each([
    ["a negative balance first", balance("-1", "5"), [lot("1", "2026-10-01")], "NEGATIVE"],
    ["an empty balance next", balance("0", "5"), [], "EMPTY"],
    [
      "an expired lot before one about to expire",
      balance("9", "5"),
      [lot("1", "2026-10-01"), lot("8", "2026-10-20")],
      "EXPIRED",
    ],
    ["a lot about to expire before a low balance", balance("4", "5"), [lot("4", "2026-10-20")], "EXPIRING_SOON"],
    ["a low balance", balance("4", "5"), [lot("4", null)], "BELOW_MINIMUM"],
    ["a healthy balance", balance("5", "5"), [lot("5", "2027-10-20")], "OK"],
  ])("reads %s", (_label, stock, lots, expected) => {
    expect(statusOf(stock, lots, TODAY)).toBe(expected);
  });

  it("ignores the date of a lot with nothing left", () => {
    expect(statusOf(balance("5"), [lot("0", "2026-10-01"), lot("5", null)], TODAY)).toBe("OK");
  });
});

describe("valueOf", () => {
  it("adds up what is left of each lot at the cost of that lot, in cents", () => {
    expect(valueOf([lot("10.5", null, "4.25"), lot("2", null, "30.005")]).toFixed(2)).toBe("104.64");
  });

  it("is worth nothing with no lots", () => {
    expect(valueOf([]).toFixed(2)).toBe("0.00");
  });
});
