# ServicesBundle Dockerfile — 경량 서비스 6개(analytics/channel-adapter/membership/
# notification/search/ugc-service)를 한 이미지에 빌드하고 supervisor.mjs 로 다중 프로세스 기동.
# 기존 앱 Dockerfile 과 동일한 멀티스테이지 패턴. build context = 모노레포 루트
# (deployments/lcnine/services/shared.ts 의 dockerContext = '../../../').
FROM node:22-alpine AS base

WORKDIR /app
RUN apk add --no-cache postgresql-client git openssh-client

# === 의존성 설치 (hms-api-wrapper 는 package.json 의 file: dep 이라 npm ci 전에 필요) ===
FROM base AS deps
COPY package*.json ./
COPY packages/hms-api-wrapper/ ./packages/hms-api-wrapper/
RUN npm ci

# === 프로덕션 의존성 (런타임 공유 node_modules) ===
FROM base AS deps-prod
COPY package*.json ./
COPY packages/hms-api-wrapper/ ./packages/hms-api-wrapper/
RUN npm ci --omit=dev && npm cache clean --force

# === 빌드 (6개 앱) ===
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./
COPY webpack.config.js ./
COPY libs/ ./libs/
COPY packages/ ./packages/
COPY apps/analytics/ ./apps/analytics/
COPY apps/channel-adapter/ ./apps/channel-adapter/
COPY apps/membership/ ./apps/membership/
COPY apps/notification/ ./apps/notification/
COPY apps/search/ ./apps/search/
COPY apps/ugc-service/ ./apps/ugc-service/
RUN npm run build:analytics \
  && npm run build:channel-adapter \
  && npm run build:membership \
  && npm run build:notification \
  && npm run build:search \
  && npm run build:ugc-service

# === 런타임 ===
FROM base AS runner
COPY --from=deps-prod /app/node_modules ./node_modules
COPY package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/libs ./libs
# membership 개별 runner 와 parity (migrate 는 out-of-band 지만 안전 복사).
COPY --from=builder /app/apps/membership/drizzle ./apps/membership/drizzle
COPY deployments/lcnine/services/bundle/supervisor.mjs ./supervisor.mjs

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs
USER nestjs

ENV NODE_ENV=production

# analytics 3040, channel-adapter 3001, membership 3002, notification 3003, search 3004, ugc 3030
EXPOSE 3001 3002 3003 3004 3030 3040

CMD ["node", "supervisor.mjs"]
