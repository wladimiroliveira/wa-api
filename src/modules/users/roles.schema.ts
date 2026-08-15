import { z } from "zod";
import { Permission } from "../../generated/prisma/index.js";
import { timestampSchema } from "../shared/response.js";

export const permissionSchema = z.enum(Permission);

export const createRoleSchema = z.object({
  name: z.string().min(1),
  permissions: z.array(permissionSchema).default([]),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1).optional(),
  permissions: z.array(permissionSchema).optional(),
});

export const roleIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const roleResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  permissions: z.array(permissionSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const roleListResponseSchema = z.array(roleResponseSchema);
