# Detection-content MCP server (Next.js 16 app; the MCP endpoint is /api/mcp).
# Multi-stage: install + build, then a lean runtime.

# ---- deps ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# better-sqlite3 needs a toolchain to build its native addon.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci

# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# The DB is provided at runtime via a bind mount / volume (see docker-compose.mcp.yml).
ENV DATABASE_URL=file:/data/dev.db
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src/generated ./src/generated
COPY --from=build /app/prisma ./prisma
EXPOSE 3000
# next start serves the whole app including the MCP endpoint at /api/mcp.
CMD ["npm", "run", "start"]
