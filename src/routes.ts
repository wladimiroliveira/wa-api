import { FastifyInstance } from "fastify";
import supplyRoutes from "./modules/supplies/supplies.routes.js";

export default async function (app: FastifyInstance) {
  await app.register(supplyRoutes);
}
