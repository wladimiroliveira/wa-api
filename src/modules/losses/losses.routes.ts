import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { Permission } from "../../generated/prisma/index.js";
import { toOptionalDateString } from "../../lib/dates.js";
import { AUTHENTICATED } from "../auth/auth.access.js";
import { messageSchema } from "../auth/auth.schemas.js";
import {
  findLossReasonById,
  findLossReasonByName,
  insertLoss,
  insertLossReason,
  listLossReasons,
  updateLossReason,
} from "./losses.repository.js";
import {
  createLossBodySchema,
  createLossReasonBodySchema,
  lossReasonIdParamsSchema,
  lossReasonSchema,
  lossSchema,
  updateLossReasonBodySchema,
} from "./losses.schemas.js";

const LOT_FAILURES = {
  missing: { code: 404, message: "Lot not found." },
  insufficient: { code: 409, message: "The lot does not hold that much." },
} as const;

export default async function lossesRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/loss-reasons",
    {
      // Whoever records a loss and whoever manages the reasons both read this list, and a route
      // declares a single permission. The names of the reasons give nothing away.
      config: { auth: AUTHENTICATED },
      schema: {
        tags: ["losses"],
        summary: "Lista as modalidades de avaria",
        response: { 200: z.array(lossReasonSchema) },
      },
    },
    async (_request, reply) => reply.send(await listLossReasons()),
  );

  typed.post(
    "/loss-reasons",
    {
      config: { auth: Permission.LOSSES_UPDATE },
      schema: {
        tags: ["losses"],
        summary: "Cadastra uma modalidade de avaria",
        body: createLossReasonBodySchema,
        response: { 201: lossReasonSchema, 409: messageSchema },
      },
    },
    async (request, reply) => {
      if ((await findLossReasonByName(request.body.name)) !== null) {
        return reply.code(409).send({ message: "A loss reason with this name already exists." });
      }

      return reply.code(201).send(await insertLossReason(request.body));
    },
  );

  typed.patch(
    "/loss-reasons/:id",
    {
      config: { auth: Permission.LOSSES_UPDATE },
      schema: {
        tags: ["losses"],
        summary: "Edita, inativa ou reativa uma modalidade de avaria",
        params: lossReasonIdParamsSchema,
        body: updateLossReasonBodySchema,
        response: { 200: lossReasonSchema, 404: messageSchema, 409: messageSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      if ((await findLossReasonById(id)) === null) {
        return reply.code(404).send({ message: "Loss reason not found." });
      }

      if (request.body.name !== undefined) {
        const sameName = await findLossReasonByName(request.body.name);

        if (sameName !== null && sameName.id !== id) {
          return reply.code(409).send({ message: "A loss reason with this name already exists." });
        }
      }

      return reply.send(await updateLossReason(id, request.body));
    },
  );

  typed.post(
    "/losses",
    {
      config: { auth: Permission.LOSSES_CREATE },
      schema: {
        tags: ["losses"],
        summary: "Registra a avaria de parte de um lote e baixa do estoque",
        body: createLossBodySchema,
        response: { 201: lossSchema, 404: messageSchema, 409: messageSchema },
      },
    },
    async (request, reply) => {
      const reason = await findLossReasonById(request.body.reasonId);

      if (reason === null) {
        return reply.code(404).send({ message: "Loss reason not found." });
      }

      if (!reason.isActive) {
        return reply.code(409).send({ message: "Loss reason is inactive." });
      }

      const recorded = await insertLoss({ ...request.body, createdById: request.currentUser!.id });

      if ("failure" in recorded) {
        const { code, message } = LOT_FAILURES[recorded.failure];

        return reply.code(code).send({ message });
      }

      const { loss, lot } = recorded;

      return reply.code(201).send({
        id: loss.id,
        quantity: loss.movement.quantity.toString(),
        unitCost: lot.unitCost.toString(),
        note: loss.note,
        createdAt: loss.createdAt.toISOString(),
        reason: loss.reason,
        product: loss.lot.product,
        lot: {
          id: lot.id,
          expiresAt: toOptionalDateString(lot.expiresAt),
          quantity: lot.left.toString(),
        },
      });
    },
  );
}
