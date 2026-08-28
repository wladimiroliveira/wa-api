import { Permission } from "../../generated/prisma/index.js";

export type PermissionSources = {
  rolePermissions: Permission[];
  extraPermissions: Permission[];
};

// The single source of the answer. No route recomputes this: a second implementation is a second
// chance to get authorisation wrong.
export function effectivePermissions({ rolePermissions, extraPermissions }: PermissionSources): Permission[] {
  return [...new Set([...rolePermissions, ...extraPermissions])];
}

export function hasPermission(permissions: Permission[], required: Permission): boolean {
  return permissions.includes(required);
}
