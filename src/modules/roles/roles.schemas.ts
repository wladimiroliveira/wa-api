import { z } from "zod";
import { Permission } from "../../generated/prisma/index.js";

export const roleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  permissions: z.array(z.enum(Permission)),
});

export const createRoleBodySchema = z.object({
  name: z.string().min(1).max(60),
  permissions: z.array(z.enum(Permission)),
});

export const updateRoleBodySchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    permissions: z.array(z.enum(Permission)).optional(),
  })
  .refine((body) => body.name !== undefined || body.permissions !== undefined, {
    message: "Nothing to update.",
  });

export const roleIdParamsSchema = z.object({ id: z.uuid() });
