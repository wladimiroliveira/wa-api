import { PrismaClient } from "../generated/prisma/index.js";
import { loadEnv } from "./env.js";

loadEnv();

export const prisma = new PrismaClient();
