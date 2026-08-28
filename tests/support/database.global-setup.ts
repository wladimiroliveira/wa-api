import { execSync } from "node:child_process";

// The test suite lives in its own Postgres schema of the development database. Prisma creates the
// schema named in the connection string, so no extra database has to be provisioned by hand.
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;

  if (url === undefined) {
    throw new Error("TEST_DATABASE_URL is required to run integration tests. See .example.env.");
  }

  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}
