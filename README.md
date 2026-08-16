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
- **Health check** — `/health` answers only while the database answers, so orchestrators see the real state.

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

# 3. start PostgreSQL and wait until it accepts connections
npm run services:up

# 4. apply migrations and generate the Prisma client
npm run db:migrate

# 5. create the Owner role and the first user
npm run db:seed

# 6. run the API in watch mode
npm run dev
```

Steps 3 to 6 are also available as a single command once `.env` exists: `npm run dev:full`.

The server listens on `http://localhost:3333` by default and the interactive documentation is available at
`http://localhost:3333/docs`.

### Running the packaged image

```bash
docker build -t wa-api .
docker run -p 3333:3333 -e DATABASE_URL="postgresql://user:pass@host:5432/wa_api?schema=public" wa-api
```

The image ships only the compiled application and its runtime dependencies. Migrations are **not** applied on start —
run `npx prisma migrate deploy` as a deployment step, so concurrent containers never race for the same migration. The
container declares a `HEALTHCHECK` that polls `/health`, so an orchestrator sees it as unhealthy whenever the database
stops answering.

### Environment variables

| Variable                 | Description                                                           | Example                                                  |
| ------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------- |
| `API_PORT`               | Port the HTTP server binds to                                         | `3333`                                                   |
| `POSTGRES_USER`          | Role the container is created with                                    | `postgres`                                               |
| `POSTGRES_PASSWORD`      | Password of that role                                                 | `postgres`                                               |
| `POSTGRES_DB`            | Database created on the first boot                                    | `wa_api`                                                 |
| `POSTGRES_HOST`          | Host the API reaches PostgreSQL at                                    | `localhost`                                              |
| `POSTGRES_PORT`          | Port the container publishes on the host                              | `5432`                                                   |
| `DATABASE_URL`           | Connection string assembled from the five above                       | `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@...` |
| `JWT_SECRET`             | Access token signing key, at least 32 characters                      | `a-long-random-string-with-32-plus-chars`                |
| `CORS_ORIGINS`           | Comma-separated list of allowed origins                               | `http://localhost:5173`                                  |
| `ACCESS_TOKEN_TTL`       | Access token lifetime, defaults to `15m`                              | `15m`                                                    |
| `REFRESH_TOKEN_TTL_DAYS` | Refresh token lifetime in days, defaults to `30`                      | `30`                                                     |
| `LOGIN_RATE_LIMIT_MAX`   | Login and password-change tries per address per 15 min, defaults to 5 | `5`                                                      |
| `REFRESH_RATE_LIMIT_MAX` | Refresh calls per address per 15 min, defaults to 60                  | `60`                                                     |
| `OWNER_USERNAME`         | First user's login credential, read only by `db:seed`                 | `owner`                                                  |
| `OWNER_EMAIL`            | First user's email, read only by `db:seed`                            | `owner@example.com`                                      |
| `OWNER_PASSWORD`         | First user's password, read only by `db:seed`                         | `change-this-password`                                   |

`JWT_SECRET` and `CORS_ORIGINS` are required: the server refuses to start without them.

`DATABASE_URL` interpolates the five `POSTGRES_*` variables, and `docker-compose.yml` reads the same ones, so the
credentials live in a single place instead of being repeated on both sides. The container only reads the role, password
and database name while its data volume is empty — changing them later renames nothing, so drop the volume with
`npm run services:down -- --volumes` first.

## Scripts

| Script                        | What it does                                                 |
| ----------------------------- | ------------------------------------------------------------ |
| `npm run dev`                 | Runs the server with `tsx watch`                             |
| `npm run dev:full`            | Brings up the container, migrates, seeds and runs the server |
| `npm run build`               | Compiles TypeScript to `dist/`                               |
| `npm start`                   | Runs the compiled server                                     |
| `npm run services:up`         | Starts PostgreSQL and waits until it is healthy              |
| `npm run services:down`       | Stops the containers                                         |
| `npm test`                    | Runs the test suite once                                     |
| `npm run test:watch`          | Runs the tests in watch mode                                 |
| `npm run db:migrate`          | Applies migrations in development                            |
| `npm run db:generate`         | Regenerates the Prisma client                                |
| `npm run db:seed`             | Creates the Owner role and the first user                    |
| `npm run lint:prettier:check` | Checks formatting                                            |
| `npm run lint:prettier:fix`   | Fixes formatting                                             |
| `npm run commit`              | Commitizen prompt for conventional commits                   |

## Authentication

Every route is closed except `GET /health`, `/docs`, `POST /sessions` and `POST /sessions/refresh`. Access is granted
per module, with read separated from write, through 13 permissions: `SUPPLIES_READ`, `SUPPLIES_WRITE`, `RECIPES_READ`,
`RECIPES_WRITE`, `PRICING_READ`, `STOCK_READ`, `STOCK_WRITE`, `PRODUCTION_READ`, `PRODUCTION_WRITE`, `WASTE_READ`,
`WASTE_WRITE`, `USERS_READ` and `USERS_WRITE`.

Users log in with a **username**, not an email. The username is 3 to 30 characters of letters, numbers, dot, dash and
underscore, stored and compared in lowercase — `Maria` and `maria` are the same account, so nobody fails to log in over
a capital letter. The email stays on the record as required and unique contact information, but it is not a credential.

A user's effective permission is `(role ∪ grantedPermissions) − deniedPermissions` — denial always wins. It is read
from the database on every request, so a permission change takes effect on the next call, and it is inspectable through
`GET /users/:id/permissions`.

### Where the refresh token goes

The access token always comes back in the body: it lives 15 minutes, belongs in memory, and is not the asset worth
stealing. The refresh token lives 30 days, so where it lands decides how bad an XSS gets. The API delivers it two ways
and the client picks at login.

**Cookie — the default, for browsers.** `POST /sessions` with no extra header answers `{ accessToken }` and sets the
refresh token as `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/sessions`. JavaScript cannot read it, so an XSS cannot
walk off with a 30-day credential. A second cookie, `csrfToken`, is deliberately readable: the client echoes it in the
`X-CSRF-Token` header on refresh and logout, and the API compares the two.

**Body — opt-in, for native clients.** `POST /sessions` with `X-Refresh-Delivery: body` answers
`{ accessToken, refreshToken }` and sets no cookies. Mobile apps have no XSS surface and no cookie jar worth the
trouble, so they hold the string themselves.

The delivery never converts. A request that arrives with the cookie is answered with a cookie, even if it asks for the
body — otherwise an XSS would trade the unreachable cookie for a readable string, and `HttpOnly` would be decoration.
CORS runs with `credentials: true`, which is only safe because `CORS_ORIGINS` is an explicit list and never a wildcard.

```bash
# --- browser flow (cookie) ---
# 1. log in; the refresh token lands in a cookie jar
curl -X POST http://localhost:3333/sessions -c jar.txt \
  -H "Content-Type: application/json" \
  -d '{"username":"owner","password":"change-this-password"}'
# → { "accessToken": "..." }

# 2. call a protected route
curl http://localhost:3333/supplies -H "Authorization: Bearer <accessToken>"

# 3. rotate; no body, cookie plus the anti-CSRF header
curl -X POST http://localhost:3333/sessions/refresh -b jar.txt -c jar.txt \
  -H "X-CSRF-Token: <csrfToken cookie value>"

# --- native flow (body) ---
curl -X POST http://localhost:3333/sessions \
  -H "Content-Type: application/json" -H "X-Refresh-Delivery: body" \
  -d '{"username":"owner","password":"change-this-password"}'
# → { "accessToken": "...", "refreshToken": "..." }

curl -X POST http://localhost:3333/sessions/refresh \
  -H "Content-Type: application/json" -d '{"refreshToken":"<refreshToken>"}'
```

**The browser client must share an origin with the API.** Serve the front end and the API from one origin — through the
dev server's proxy locally, and through a reverse proxy or a shared host in production. The reason is the `csrfToken`
cookie: it is set host-only for the API's host, so a front end on a different host cannot read it, and without reading
it there is no header to send back. `Secure` is not a problem on `http://localhost`, which browsers already treat as a
secure context. Native clients are unaffected — they use the body flow, which has no cookie and no CSRF check.

`POST /sessions/refresh` carries its own rate limit, separate from the login one, because the browser calls it on its
own — on every page load and whenever the access token expires — and must not spend the budget of someone typing a
password. Both are per address and per 15 minutes; see `LOGIN_RATE_LIMIT_MAX` and `REFRESH_RATE_LIMIT_MAX`.
`PATCH /me/password` carries a third bucket, sized by `LOGIN_RATE_LIMIT_MAX` as well.

The refresh token is stored hashed and rotates on every use — replaying an already rotated token revokes the whole
session, since that signals theft. Users are deactivated rather than deleted, which preserves the production and waste
history they recorded and revokes their refresh tokens.

### Changing a password

Two routes, because they are two cases with different rules. `PATCH /me/password` takes `currentPassword` and
`newPassword` and only needs a session: the current password is required because an access token alone does not prove
presence, so a hijacked session cannot take the account over. `PATCH /users/:id/password` takes `newPassword` alone and
requires `USERS_WRITE`: whoever administers does not know someone else's password, and forgetting it is the whole point
of the route. A wrong `currentPassword` answers `403`, not `401`, so the client does not try to renew a session that is
perfectly valid.

Either route writes the new hash and revokes the user's refresh tokens in the same transaction — a stolen refresh token
must not outlive the change. On `PATCH /me/password` that includes the session doing the change: its cookies are
cleared in the same response and everyone logs in again. `PATCH /me/password` shares the login's `LOGIN_RATE_LIMIT_MAX`
ceiling, in a bucket of its own, because it also accepts password guessing.

`401` means no token, or an invalid, expired or deactivated one. `403` means authenticated but missing the required
permission — or, on the session routes, a cookie request without a matching `X-CSRF-Token`.

**Adding a route.** Every route must declare `requirePermission(Permission.X)`, `requireAuth()` or
`config: { public: true }`. The server refuses to start otherwise, so a new route cannot be born open by accident.

## API

Every route declares a response schema, so `/docs` carries the full contract of each body — including the error shapes
per status. The schema is enforced at serialization: a field that is not declared never reaches the client.

| Method   | Endpoint                      | Permission         | Description                                                     |
| -------- | ----------------------------- | ------------------ | --------------------------------------------------------------- |
| `GET`    | `/health`                     | public             | Liveness plus a database ping; `503` when the DB is down        |
| `POST`   | `/sessions`                   | public             | Logs in; refresh token in a cookie, or in the body on opt-in    |
| `POST`   | `/sessions/refresh`           | public             | Rotates the token pair, by cookie or by body                    |
| `DELETE` | `/sessions`                   | authenticated      | Logs out by revoking the refresh token and clearing the cookies |
| `GET`    | `/me`                         | authenticated      | Current user and effective permissions                          |
| `PATCH`  | `/me/password`                | authenticated      | Changes your own password; every session of yours falls         |
| `GET`    | `/supplies`                   | `SUPPLIES_READ`    | Lists supplies                                                  |
| `POST`   | `/supplies`                   | `SUPPLIES_WRITE`   | Creates a supply                                                |
| `GET`    | `/supplies/:id`               | `SUPPLIES_READ`    | Gets a supply                                                   |
| `PATCH`  | `/supplies/:id`               | `SUPPLIES_WRITE`   | Updates a supply                                                |
| `DELETE` | `/supplies/:id`               | `SUPPLIES_WRITE`   | Deletes a supply                                                |
| `GET`    | `/recipes`                    | `RECIPES_READ`     | Lists recipes                                                   |
| `POST`   | `/recipes`                    | `RECIPES_WRITE`    | Creates a recipe with its items                                 |
| `GET`    | `/recipes/:id`                | `RECIPES_READ`     | Gets a recipe with its items                                    |
| `PATCH`  | `/recipes/:id`                | `RECIPES_WRITE`    | Updates a recipe                                                |
| `PATCH`  | `/recipes/:id/margin`         | `RECIPES_WRITE`    | Updates only the margin                                         |
| `DELETE` | `/recipes/:id`                | `RECIPES_WRITE`    | Deletes a recipe                                                |
| `GET`    | `/recipes/:id/pricing`        | `PRICING_READ`     | Returns cost per hundred and suggested prices                   |
| `POST`   | `/supplies/:id/stock-entries` | `STOCK_WRITE`      | Registers a stock entry                                         |
| `GET`    | `/supplies/:id/movements`     | `STOCK_READ`       | Ledger movements of a supply, paginated                         |
| `POST`   | `/supplies/:id/wastes`        | `WASTE_WRITE`      | Registers waste for a supply                                    |
| `GET`    | `/wastes`                     | `WASTE_READ`       | Waste records, paginated and filterable by period               |
| `POST`   | `/productions`                | `PRODUCTION_WRITE` | Registers a production and consumes the recipe's supplies       |
| `GET`    | `/productions`                | `PRODUCTION_READ`  | Productions, paginated and filterable by period                 |
| `GET`    | `/productions/:id`            | `PRODUCTION_READ`  | Gets a production                                               |
| `GET`    | `/users`                      | `USERS_READ`       | Lists users                                                     |
| `POST`   | `/users`                      | `USERS_WRITE`      | Creates a user                                                  |
| `GET`    | `/users/:id`                  | `USERS_READ`       | Gets a user                                                     |
| `PATCH`  | `/users/:id`                  | `USERS_WRITE`      | Edits role, exceptions and `isActive`                           |
| `PATCH`  | `/users/:id/password`         | `USERS_WRITE`      | Resets someone's password; their sessions fall with it          |
| `GET`    | `/users/:id/permissions`      | `USERS_READ`       | Effective permission, already computed                          |
| `GET`    | `/roles`                      | `USERS_READ`       | Lists roles                                                     |
| `POST`   | `/roles`                      | `USERS_WRITE`      | Creates a role                                                  |
| `PATCH`  | `/roles/:id`                  | `USERS_WRITE`      | Edits the permission bundle                                     |
| `DELETE` | `/roles/:id`                  | `USERS_WRITE`      | Removes a role; its users lose the inheritance                  |

### Paginating the ledgers

The three ledger routes — `/supplies/:id/movements`, `/wastes` and `/productions` — are append-only and grow with usage,
so they never return the whole collection. They answer with a page envelope instead of a bare array:

```json
{ "data": [], "nextCursor": "3f2b1c8a-0000-4000-8000-000000000000" }
```

Ask for the next page by echoing `nextCursor` back as `cursor`. The last page carries `nextCursor: null`.

| Parameter | Applies to                | Default | Notes                                                            |
| --------- | ------------------------- | ------- | ---------------------------------------------------------------- |
| `limit`   | all three                 | `50`    | Capped at `100`; anything outside the range is a `400`           |
| `cursor`  | all three                 | —       | The `nextCursor` of the previous page; an unknown id pages empty |
| `from`    | `/wastes`, `/productions` | —       | Inclusive lower bound, date or ISO 8601 instant                  |
| `to`      | `/wastes`, `/productions` | —       | Exclusive upper bound, so consecutive windows do not overlap     |

Cursor rather than offset because the ordering is `createdAt` descending over a set that keeps receiving inserts: an
offset repeats and skips rows whenever something lands between two page reads. The cursor breaks ties by `id`, which
matters because `CURRENT_TIMESTAMP` is the transaction start time — a production consuming several supplies writes every
movement at the very same instant.

## Domain rules

- **Typed units of measure.** No unit is free text. `UnitOfMeasure` (`G`, `KG`, `ML`, `L`, `UN`) carries its own
  dimension (weight, volume, count) and conversion factor to the base unit. Mixing dimensions — using millilitres of a
  supply bought in kilograms — is rejected instead of silently converted.
- **Decimal arithmetic.** Money and quantities always use `Prisma.Decimal`; JavaScript `number` is never used in
  calculations. Only the HTTP boundary converts: response schemas serialize every decimal as a JSON number.
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
  lib/env.ts             # loads .env and expands the ${VAR} references inside it
  lib/prisma.ts          # Prisma client instance
  modules/
    auth/                # login, token rotation and the permission guard
    users/               # users, roles and effective permissions
    supplies/            # supplies CRUD and unit cost
    recipes/             # recipes and their items
    pricing/             # cost and price calculation
    stock/               # ledger and stock entries
    waste/               # waste records
    production/          # production registration and consumption
    health/              # liveness and database ping
    shared/              # units, dimensions, money and credential helpers
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
