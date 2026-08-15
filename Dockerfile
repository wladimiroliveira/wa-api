FROM node:22-alpine AS builder

WORKDIR /app

# Só o manifesto primeiro: a camada de dependências só invalida quando o lockfile muda.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# O generate do Prisma exige a variável declarada no datasource, mas não abre conexão:
# este valor existe apenas para o schema ser lido durante o build.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV API_PORT=3333

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER node

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3333)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
