import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../../src/modules/auth/auth.password.js";

const PASSWORD = "correct horse battery";

describe("hashPassword", () => {
  it("writes the parameters into the digest, so raising the cost later keeps old hashes valid", async () => {
    const digest = await hashPassword(PASSWORD);

    expect(digest).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  });

  it("salts each hash, so the same password never produces the same digest", async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it("never contains the password itself", async () => {
    expect(await hashPassword(PASSWORD)).not.toContain(PASSWORD);
  });
});

describe("verifyPassword", () => {
  it("accepts the password that produced the digest", async () => {
    expect(await verifyPassword(PASSWORD, await hashPassword(PASSWORD))).toBe(true);
  });

  it("rejects a different password", async () => {
    expect(await verifyPassword("wrong password", await hashPassword(PASSWORD))).toBe(false);
  });

  it("rejects a digest it cannot parse instead of throwing", async () => {
    expect(await verifyPassword(PASSWORD, "not-a-digest")).toBe(false);
  });

  it("rejects a digest whose algorithm it does not know", async () => {
    expect(await verifyPassword(PASSWORD, "bcrypt$16384$8$1$c2FsdA$aGFzaA")).toBe(false);
  });
});
