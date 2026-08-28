import fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerAccessToken, signAccessToken, verifyAccessToken } from "../../../src/modules/auth/auth.jwt.js";

const SECRET = "a-secret-long-enough-to-be-taken-seriously";
const USER_ID = "0199a1f0-0000-7000-8000-000000000001";

async function appWithAccessToken() {
  const app = fastify();
  await registerAccessToken(app, { secret: SECRET, ttlMinutes: 15 });
  await app.ready();

  return app;
}

describe("access token", () => {
  it("carries the user id and nothing else", async () => {
    const app = await appWithAccessToken();

    const payload = verifyAccessToken(app, signAccessToken(app, USER_ID));

    expect(payload?.sub).toBe(USER_ID);
    expect(Object.keys(payload ?? {}).sort()).toEqual(["exp", "iat", "sub"]);

    await app.close();
  });

  it("answers null for a token signed with another secret", async () => {
    const app = await appWithAccessToken();
    const stranger = fastify();
    await registerAccessToken(stranger, { secret: "another-secret-long-enough-to-be-used", ttlMinutes: 15 });
    await stranger.ready();

    expect(verifyAccessToken(app, signAccessToken(stranger, USER_ID))).toBeNull();

    await app.close();
    await stranger.close();
  });

  it("answers null for an expired token", async () => {
    const app = await appWithAccessToken();

    const expired = app.jwt.sign({ sub: USER_ID }, { expiresIn: "-1s" });

    expect(verifyAccessToken(app, expired)).toBeNull();

    await app.close();
  });

  it("answers null for a token that is not a token", async () => {
    const app = await appWithAccessToken();

    expect(verifyAccessToken(app, "garbage")).toBeNull();

    await app.close();
  });
});
