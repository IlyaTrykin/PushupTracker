FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm config set fund false && npm config set audit false
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
ENV NODE_ENV=production

# Prisma needs OpenSSL during generate (in builder stage!)
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl libssl3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Версия сборки: deploy.sh передаёт build args; next.config.ts вшивает её в URL service worker'а.
ARG GIT_SHA=""
ARG BUILD_TIME=""
ENV GIT_SHA=${GIT_SHA} \
    BUILD_TIME=${BUILD_TIME}

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Prisma runtime deps
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl libssl3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ARG GIT_SHA=""
ARG BUILD_TIME=""
ENV GIT_SHA=${GIT_SHA} \
    BUILD_TIME=${BUILD_TIME}

COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
# next start читает конфиг при запуске (poweredByHeader, images.unoptimized).
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/public ./public
# .next пишет кеш во время работы — владелец node.
COPY --from=builder --chown=node:node /app/.next ./.next
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /app/public/uploads \
  && chown node:node /app/public/uploads

EXPOSE 3000
# Entrypoint стартует от root только чтобы отдать том uploads пользователю node,
# затем сбрасывает привилегии: миграции и next start работают от node.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
# next — через exec, без обёртки npx: процесс node сам становится потомком init (tini) и
# получает SIGTERM от `docker stop` напрямую; npm/sh не гасятся раньше него с ошибкой.
CMD ["bash", "-lc", "npx prisma migrate deploy && exec ./node_modules/.bin/next start -p 3000"]
