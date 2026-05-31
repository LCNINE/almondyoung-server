# Wallet 서비스 Dockerfile
FROM node:22-alpine AS base

WORKDIR /app
RUN apk add --no-cache postgresql-client git openssh-client

FROM base AS deps
COPY package*.json ./
# Ensure local file dependency is available during npm ci.
COPY packages/hms-api-wrapper/ ./packages/hms-api-wrapper/
RUN npm ci

FROM base AS deps-prod
COPY package*.json ./
# Ensure local file dependency is available during npm ci.
COPY packages/hms-api-wrapper/ ./packages/hms-api-wrapper/
RUN npm ci --omit=dev && npm cache clean --force

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./
COPY libs/ ./libs/
COPY packages/ ./packages/
COPY apps/wallet/ ./apps/wallet/

RUN npm run build:wallet

FROM base AS runner
# 런타임 이미지에서는 이미 deps-prod 레이어에서 설치한 node_modules를 재사용하여 중복 설치를 피함
COPY --from=deps-prod /app/node_modules ./node_modules
COPY package*.json ./
COPY packages/hms-api-wrapper/ ./packages/hms-api-wrapper/

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/libs ./libs
# html 디렉토리는 존재하지 않으므로 복사하지 않음

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs
USER nestjs

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/v1/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

CMD ["npm", "run", "start:wallet:prod"]
