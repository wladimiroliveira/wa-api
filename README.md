# wa-api

Backend for **wa-system**, a mini-ERP for a small company that produces and distributes party sweets and savories.

The API turns raw purchase data into reliable numbers: it computes the real production cost of a recipe, suggests a
sale price with a conscious margin, and keeps an auditable stock ledger fed by entries, productions and waste.

```
Supply ──► Recipe ──► cost per hundred ──► price (markup)
```

## Features

- **Supplies** — raw materials and packaging, with purchase unit, quantity and price.
- **Recipes** — technical sheets: items, batch yield, labor cost per hundred and margin.
- **Pricing** — cost per hundred (supplies + labor) and suggested price per hundred / half hundred.
- **Stock** — single-source-of-truth ledger (`StockMovement`) plus the current balance of every supply.
- **Production** — registers produced batches and automatically consumes the recipe's supplies.
- **Waste** — records spoilage and losses against the same ledger.
- **OpenAPI docs** — interactive Swagger UI served by the app itself.

## Tech stack

| Concern    | Choice                                     |
| ---------- | ------------------------------------------ |
| Runtime    | Node.js 22 (`lts/jod`, see `.nvmrc`)       |
| Language   | TypeScript (ESM, `nodenext`)               |
| HTTP       | Fastify 5                                  |
| Validation | Zod 4 via `fastify-type-provider-zod`      |
| ORM        | Prisma 6                                   |
| Database   | PostgreSQL 17                              |
| Tests      | Vitest                                     |
| Docs       | `@fastify/swagger` + `@fastify/swagger-ui` |

## Requirements

- Node.js 22+
- Docker (for the local PostgreSQL) or an existing PostgreSQL 17 instance

## Getting started

```bash
# 1. install dependencies
npm install

# 2. create your environment file
cp .example.env .env

# 3. start PostgreSQL
docker compose up -d

# 4. apply migrations and generate the Prisma client
npm run db:migrate

# 5. run the API in watch mode
npm run dev
```

The server listens on `http://localhost:3333` by default and the interactive documentation is available at
`http://localhost:3333/docs`.

### Environment variables

| Variable       | Description                   | Example                                                              |
| -------------- | ----------------------------- | -------------------------------------------------------------------- |
| `API_PORT`     | Port the HTTP server binds to | `3333`                                                               |
| `DATABASE_URL` | PostgreSQL connection string  | `postgresql://postgres:postgres@localhost:5432/wa_api?schema=public` |

## Scripts

| Script                        | What it does                               |
| ----------------------------- | ------------------------------------------ |
| `npm run dev`                 | Runs the server with `tsx watch`           |
| `npm run build`               | Compiles TypeScript to `dist/`             |
| `npm start`                   | Runs the compiled server                   |
| `npm test`                    | Runs the test suite once                   |
| `npm run test:watch`          | Runs the tests in watch mode               |
| `npm run db:migrate`          | Applies migrations in development          |
| `npm run db:generate`         | Regenerates the Prisma client              |
| `npm run lint:prettier:check` | Checks formatting                          |
| `npm run lint:prettier:fix`   | Fixes formatting                           |
| `npm run commit`              | Commitizen prompt for conventional commits |

## API

| Method   | Endpoint                      | Description                                               |
| -------- | ----------------------------- | --------------------------------------------------------- |
| `GET`    | `/supplies`                   | Lists supplies                                            |
| `POST`   | `/supplies`                   | Creates a supply                                          |
| `GET`    | `/supplies/:id`               | Gets a supply                                             |
| `PATCH`  | `/supplies/:id`               | Updates a supply                                          |
| `DELETE` | `/supplies/:id`               | Deletes a supply                                          |
| `GET`    | `/recipes`                    | Lists recipes                                             |
| `POST`   | `/recipes`                    | Creates a recipe with its items                           |
| `GET`    | `/recipes/:id`                | Gets a recipe with its items                              |
| `PATCH`  | `/recipes/:id`                | Updates a recipe                                          |
| `PATCH`  | `/recipes/:id/margin`         | Updates only the margin                                   |
| `DELETE` | `/recipes/:id`                | Deletes a recipe                                          |
| `GET`    | `/recipes/:id/pricing`        | Returns cost per hundred and suggested prices             |
| `POST`   | `/supplies/:id/stock-entries` | Registers a stock entry                                   |
| `GET`    | `/supplies/:id/movements`     | Lists the ledger movements of a supply                    |
| `POST`   | `/supplies/:id/wastes`        | Registers waste for a supply                              |
| `GET`    | `/wastes`                     | Lists waste records                                       |
| `POST`   | `/productions`                | Registers a production and consumes the recipe's supplies |
| `GET`    | `/productions`                | Lists productions                                         |
| `GET`    | `/productions/:id`            | Gets a production                                         |

## Domain rules

- **Typed units of measure.** No unit is free text. `UnitOfMeasure` (`G`, `KG`, `ML`, `L`, `UN`) carries its own
  dimension (weight, volume, count) and conversion factor to the base unit. Mixing dimensions — using millilitres of a
  supply bought in kilograms — is rejected instead of silently converted.
- **Decimal arithmetic.** Money and quantities always use `Prisma.Decimal`; JavaScript `number` is never used in
  calculations.
- **Selling unit.** Prices are expressed per hundred units, with a half hundred derived from it. Both are rounded up to
  the nearest whole currency unit; the exact, unrounded price is returned as well.
- **Single ledger.** Every stock change — entry, production consumption, waste — goes through `StockMovement` in the same
  transaction that updates `currentStock`, so the balance always equals the sum of its movements.
- **Production warns, it does not block.** A production that drives a supply below zero is still recorded and returns the
  affected supplies as warnings.
- **Stock and cost are decoupled.** A stock entry never changes the supply's purchase price, so pricing is unaffected.

## Project structure

```
src/
  server.ts              # Fastify bootstrap, Swagger, CORS, error handler
  routes.ts              # registers every module's routes
  lib/prisma.ts          # Prisma client instance
  modules/
    supplies/            # supplies CRUD and unit cost
    recipes/             # recipes and their items
    pricing/             # cost and price calculation
    stock/               # ledger and stock entries
    waste/               # waste records
    production/          # production registration and consumption
    shared/              # units, dimensions and money helpers
prisma/                  # schema and migrations
tests/                   # unit and integration tests
docs/                    # design documents and implementation plans
```

Each module follows the same layout: `*.schema.ts` (Zod contracts), `*.routes.ts` (HTTP), `*.repository.ts`
(persistence), `*.service.ts` (transactional orchestration) and `*.calc.ts` (pure calculation).

## Tests

```bash
npm test
```

Route tests are integration tests: they boot the real application and hit a real database, so PostgreSQL must be running
and migrated before executing them. Pure calculation tests (`*.calc.test.ts` and the `shared` ones) have no such
dependency.

## Conventions

- Code, identifiers, tests and commit messages are written in English; documentation and user-facing text are in
  Portuguese.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/), enforced by commitlint through a Husky
  `commit-msg` hook.
- Formatting is handled by Prettier (120 columns, double quotes) and enforced by a Husky `pre-commit` hook.
- Every push to `main` and every pull request runs four independent jobs on GitHub Actions — formatting, types,
  migrations and the test suite — so a failure in one never hides a failure in another.
