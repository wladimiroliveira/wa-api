import { describe, expect, it } from "vitest";
import { planQuantity } from "../../../src/modules/pre-weighings/pre-weighings.plan.js";

const plan = (recipeQuantity: string, yieldQuantity: string, quantity: string) =>
  planQuantity({ recipeQuantity, yieldQuantity, quantity })?.toString() ?? null;

describe("planQuantity", () => {
  it("scales the quantity of the recipe by how much is to be produced", () => {
    expect(plan("15", "25", "50")).toBe("30");
    expect(plan("15", "25", "5")).toBe("3");
    expect(plan("15", "25", "25")).toBe("15");
  });

  it("rounds to the six decimal places a quantity holds", () => {
    expect(plan("1", "3", "1")).toBe("0.333333");
    expect(plan("2", "3", "1")).toBe("0.666667");
  });

  it("does not lose a cent of precision the way a float would", () => {
    expect(plan("0.1", "1", "3")).toBe("0.3");
  });

  it("gives no plan for a quantity too small to weigh", () => {
    expect(plan("0.000001", "1000", "1")).toBeNull();
  });

  it("gives no plan for a quantity too large to store", () => {
    expect(plan("999999999999", "0.000001", "999999999999")).toBeNull();
  });
});
