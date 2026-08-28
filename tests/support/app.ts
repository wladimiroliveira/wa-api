import { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { Permission } from "../../src/generated/prisma/index.js";
import { hashPassword } from "../../src/modules/auth/auth.password.js";
import { testPrisma } from "./database.js";

export async function startTestApp(): Promise<FastifyInstance> {
  return buildApp();
}

// Creates a user holding exactly the permissions the test needs and logs in as that user. Tests
// that need a permission say so; nothing is granted by accident.
export async function authenticateAs(
  app: FastifyInstance,
  permissions: Permission[],
  username = "tester",
): Promise<{ userId: string; headers: { authorization: string } }> {
  const user = await testPrisma.user.create({
    data: {
      name: "Test Person",
      username,
      passwordHash: await hashPassword("correct horse battery"),
      extraPermissions: permissions,
    },
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/sessions/signin",
    payload: { username, password: "correct horse battery" },
  });

  return { userId: user.id, headers: { authorization: `Bearer ${response.json().accessToken}` } };
}
