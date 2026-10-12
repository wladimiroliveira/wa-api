import { z } from "zod";

export const supplierSchema = z.object({ id: z.uuid(), name: z.string() });

export const createSupplierBodySchema = z.object({ name: z.string().trim().min(1).max(120) });
