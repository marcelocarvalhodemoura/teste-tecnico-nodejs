# =============================================================================
# Multi-stage build — imagem enxuta e segura para produção.
# Prisma: generate no build; migrate deploy no start (CLI em dependencies).
#
# Base Debian slim (glibc): o worker Temporal usa binário nativo
# (@temporalio/core-bridge) que não é distribuído para Alpine/musl.
# A mesma imagem serve a API e o worker (comando diferente no compose).
# =============================================================================

FROM node:20-bookworm-slim AS builder

WORKDIR /app

# OpenSSL é exigido pelos engines do Prisma
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build && npm prune --omit=dev

# -----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -s /bin/sh -M nestjs

COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma

USER nestjs

EXPOSE 3000

ENV NODE_ENV=production

# Sem wget/curl na imagem slim: usa o fetch nativo do Node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Aplica migrations Prisma (CLI local, sem download) e sobe a API
CMD ["sh", "-c", "npx --no-install prisma migrate deploy && node dist/main.js"]
