# User Service Dockerfile
FROM node:22-alpine AS base

WORKDIR /app
RUN apk add --no-cache postgresql-client git openssh-client

# TypeScript 컴파일은 빌드 머신에서 실행하고 런타임 의존성은 대상 아키텍처로 설치한다.
# arm64 이미지를 x86 머신에서 빌드할 때 이 둘을 대상 아키텍처로 돌리면 QEMU 에뮬레이션이라 수십 배 느리다.
# 산출물(dist)은 webpack-node-externals 로 node_modules 를 빼고 묶은 순수 JS 라 빌드 머신 아키텍처와 무관하다.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build-base
WORKDIR /app
RUN apk add --no-cache postgresql-client git openssh-client

# === 의존성 설치 단계 ===
FROM build-base AS deps
COPY package*.json ./
COPY packages/hms-api-wrapper/ ./packages/hms-api-wrapper/
RUN npm ci --foreground-scripts

# === 프로덕션 의존성 설치 단계 ===
FROM base AS deps-prod
COPY package*.json ./
COPY packages/hms-api-wrapper/ ./packages/hms-api-wrapper/
RUN npm ci --omit=dev --foreground-scripts && npm cache clean --force

# === 빌드 단계 ===
FROM build-base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./
COPY libs/ ./libs/
COPY packages/ ./packages/
COPY apps/user-service/ ./apps/user-service/

RUN npm run build:user-service

# === 프로덕션 단계 ===
FROM base AS runner
# 런타임 이미지에서는 이미 deps-prod 레이어에서 설치한 node_modules를 재사용하여 중복 설치를 피함
COPY --from=deps-prod /app/node_modules ./node_modules
COPY package*.json ./

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/libs ./libs
COPY --from=builder /app/apps/user-service/database ./apps/user-service/database

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs
USER nestjs

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

CMD ["npm", "run", "start:user-service:prod"]   
