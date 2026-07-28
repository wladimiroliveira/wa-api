import prisma from "../../lib/prisma.js";

export function listProductions() {
  return prisma.production.findMany({ orderBy: { createdAt: "desc" } });
}

export function getProduction(id: string) {
  return prisma.production.findUnique({
    where: { id },
    include: { movements: true },
  });
}
