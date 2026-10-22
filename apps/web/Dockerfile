# syntax=docker/dockerfile:1.7
# Multi-stage build for the MiniBot web app (Next.js standalone output).
# Build context: repository root  →  docker build -f apps/web/Dockerfile .

ARG NODE_VERSION=24-alpine

# ---------- base: Node + pnpm via corepack ----------
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# ---------- deps: install the whole workspace (cached by lockfile) ----------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/agent/package.json packages/agent/
COPY packages/sandbox/package.json packages/sandbox/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---------- builder: compile Next.js ----------
FROM deps AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 SKIP_ENV_VALIDATION=1
RUN pnpm --filter @minibot/web build

# ---------- migrator: one-shot job that applies DB migrations ----------
FROM deps AS migrator
COPY packages/db packages/db
WORKDIR /app/packages/db
CMD ["pnpm", "migrate"]

# ---------- runner: minimal production image ----------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
