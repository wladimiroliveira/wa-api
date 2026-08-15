import prisma from "../../lib/prisma.js";

// Consulta trivial: confirma que a conexão com o banco responde, sem tocar em nenhuma tabela.
export function pingDatabase() {
  return prisma.$queryRaw`SELECT 1`;
}
