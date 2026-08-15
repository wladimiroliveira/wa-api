import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { hashPassword } from "../src/modules/auth/auth.password.js";
import { Permission } from "../src/generated/prisma/index.js";

const ALL_PERMISSIONS = Object.values(Permission);
const OWNER_ROLE_NAME = "Owner";

async function main() {
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;

  if (!email || !password) throw new Error("Defina OWNER_EMAIL e OWNER_PASSWORD para rodar o seed");

  const role = await prisma.role.upsert({
    where: { name: OWNER_ROLE_NAME },
    update: { permissions: ALL_PERMISSIONS },
    create: { name: OWNER_ROLE_NAME, permissions: ALL_PERMISSIONS },
  });

  await prisma.user.upsert({
    where: { email },
    update: { roleId: role.id, isActive: true },
    create: { name: "Owner", email, passwordHash: await hashPassword(password), roleId: role.id },
  });

  console.log(`Seed pronto: papel ${OWNER_ROLE_NAME} e usuário ${email}`);
}

await main();
await prisma.$disconnect();
