import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { Permission } from "../../generated/prisma/index.js";
import { toPage } from "../../lib/pagination.js";
import { listStockMovements } from "./stock.repository.js";
import { listStockMovementsQuerySchema, stockMovementPageSchema } from "./stock.schemas.js";

export default async function stockRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/stock-movements",
    {
      config: { auth: Permission.ENTRIES_READ },
      schema: {
        tags: ["stock"],
        summary: "Lista as movimentações de estoque, das mais recentes para as mais antigas",
        querystring: listStockMovementsQuerySchema,
        response: { 200: stockMovementPageSchema },
      },
    },
    async (request, reply) => {
      const { items, nextCursor } = toPage(await listStockMovements(request.query), request.query);

      return reply.send({
        items: items.map((movement) => ({
          ...movement,
          quantity: movement.quantity.toString(),
          unitCost: movement.unitCost.toString(),
          createdAt: movement.createdAt.toISOString(),
        })),
        nextCursor,
      });
    },
  );
}
