import { config, type DotenvConfigOptions } from "dotenv";
import { expand, type DotenvExpandOptions } from "dotenv-expand";

// dotenv and dotenv-expand disagree on whether a target value may be undefined; the target belongs
// to the expansion, which is the step that writes the composed values.
export type LoadDotenvOptions = Omit<DotenvConfigOptions, "processEnv"> & Pick<DotenvExpandOptions, "processEnv">;

// dotenv alone stores `${POSTGRES_URL}?schema=public` verbatim. The expansion is what lets the .env
// state the connection string once and have every consumer read a resolved value.
export function loadDotenv(options: LoadDotenvOptions = {}): void {
  expand({ ...options, ...config(options) });
}
