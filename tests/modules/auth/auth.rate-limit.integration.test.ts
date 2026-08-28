import { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "../../support/database.js";
import { startTestApp } from "../../support/app.js";

let app: FastifyInstance;

const attemptLogin = (username: string) =>
  app.inject({ method: "POST", url: "/sessions", payload: { username, password: "wrong" } });

beforeAll(async () => {
  app = await startTestApp();
});

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await app.close();
  await testPrisma.$disconnect();
});

describe("POST /sessions rate limit", () => {
  it("answers 429 once the attempts for one username run out", async () => {
    const codes: number[] = [];

    for (let attempt = 0; attempt < 6; attempt += 1) {
      codes.push((await attemptLogin("target")).statusCode);
    }

    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes[5]).toBe(429);
  });

  it("does not spend another username's attempts", async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) await attemptLogin("target");

    expect((await attemptLogin("someone-else")).statusCode).toBe(401);
  });
});
