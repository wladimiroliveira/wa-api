import { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";

export async function startTestApp(): Promise<FastifyInstance> {
  return buildApp();
}
