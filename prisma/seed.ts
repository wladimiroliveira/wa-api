import "../src/lib/env.js";
import prisma from "../src/lib/prisma.js";
import { hashPassword } from "../src/modules/auth/auth.password.js";
import { Permission } from "../src/generated/prisma/index.js";
import { usernameSchema } from "../src/modules/shared/username.js";

const ALL_PERMISSIONS = Object.values(Permission);
const OWNER_ROLE_NAME = "Owner";

async function main() {
  const username = process.env.OWNER_USERNAME;
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;

  if (!username || !email || !password) {
    throw new Error("Defina OWNER_USERNAME, OWNER_EMAIL e OWNER_PASSWORD para rodar o seed");
  }

  const role = await prisma.role.upsert({
    where: { name: OWNER_ROLE_NAME },
    update: { permissions: ALL_PERMISSIONS },
    create: { name: OWNER_ROLE_NAME, permissions: ALL_PERMISSIONS },
  });

  const normalizedUsername = usernameSchema.parse(username);

  await prisma.user.upsert({
    where: { username: normalizedUsername },
    update: { roleId: role.id, isActive: true },
    create: {
      name: "Owner",
      username: normalizedUsername,
      email,
      passwordHash: await hashPassword(password),
      roleId: role.id,
    },
  });

  console.log(`Seed pronto: papel ${OWNER_ROLE_NAME} e usuário ${normalizedUsername}`);
}

await main();
await prisma.$disconnect();
