import { z } from "zod";
import { permissionSchema } from "./roles.schema.js";

export const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  roleId: z.string().uuid().nullable().optional(),
  grantedPermissions: z.array(permissionSchema).default([]),
  deniedPermissions: z.array(permissionSchema).default([]),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  roleId: z.string().uuid().nullable().optional(),
  grantedPermissions: z.array(permissionSchema).optional(),
  deniedPermissions: z.array(permissionSchema).optional(),
  isActive: z.boolean().optional(),
});

export const userIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
