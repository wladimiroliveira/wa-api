import { describe, expect, it } from "vitest";
import { toOptionalDateString } from "../../src/lib/dates.js";

describe("toOptionalDateString", () => {
  it("answers the day of a date", () => {
    expect(toOptionalDateString(new Date("2026-03-01T00:00:00.000Z"))).toBe("2026-03-01");
  });

  it("answers null for no date", () => {
    expect(toOptionalDateString(null)).toBeNull();
  });
});
