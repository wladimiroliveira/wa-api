import { PrismaClient } from "../generated/prisma/index.js";
import { loadEnv } from "./env.js";

// Fail fast: an invalid environment breaks here, at import time, instead of at the first query.
loadEnv();

export const prisma = new PrismaClient();
