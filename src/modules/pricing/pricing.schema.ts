import { z } from "zod";
import { decimalSchema } from "../shared/response.js";

/**
 * O handler já formata: custos e preços com duas casas, `exactPrice` sem
 * arredondamento. `decimalSchema` converte essas strings em number, então
 * "65.00" chega ao cliente como 65 — formatar é trabalho do front.
 */
export const pricingResponseSchema = z.object({
  suppliesCostPerHundred: decimalSchema,
  totalCostPerHundred: decimalSchema,
  exactPrice: decimalSchema,
  pricePerHundred: decimalSchema,
  pricePerHalfHundred: decimalSchema,
});
