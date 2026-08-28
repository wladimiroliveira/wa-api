import "dotenv/config";
import { defineConfig } from "vitest/config";

// src/lib/prisma.ts builds its client at import time, from DATABASE_URL. Handing the workers the
// test URL here is what keeps the suite off the development database: setting it inside a test file
// would already be too late, because the import chain ran first.
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/**/*.integration.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/**/*.integration.test.ts"],
          globalSetup: ["tests/support/database.global-setup.ts"],
          env: { DATABASE_URL: testDatabaseUrl },
          fileParallelism: false,
        },
      },
    ],
  },
});
