import { Permission, PrismaClient } from "../src/generated/prisma/index.js";
import { hashPassword } from "../src/modules/auth/auth.password.js";

const OWNER_ROLE = "Owner";

// Idempotent on purpose: running it again on a live database must not resurrect the bootstrap
// password of an account whose owner has already changed it.
export async function seed(prisma: PrismaClient, input: { username: string; password: string }): Promise<void> {
  const permissions = Object.values(Permission);

  const role = await prisma.role.upsert({
    where: { name: OWNER_ROLE },
    update: { permissions },
    create: { name: OWNER_ROLE, permissions },
  });

  const existing = await prisma.user.findUnique({ where: { username: input.username } });

  if (existing !== null) return;

  await prisma.user.create({
    data: {
      name: "Owner",
      username: input.username,
      passwordHash: await hashPassword(input.password),
      roleId: role.id,
    },
  });
}

// Runs only when the file is executed directly, so importing it from a test does not touch the
// developer's own database.
if (process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js")) {
  const username = process.env.OWNER_USERNAME;
  const password = process.env.OWNER_PASSWORD;

  if (username === undefined || password === undefined) {
    throw new Error("OWNER_USERNAME and OWNER_PASSWORD are required to seed the first user. See .example.env.");
  }

  const prisma = new PrismaClient();

  await seed(prisma, { username, password });
  await prisma.$disconnect();

  console.log(`Seeded the ${OWNER_ROLE} role and the user "${username}".`);
}
