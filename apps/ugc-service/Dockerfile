# UGC 서비스 Dockerfile
FROM node:22-alpine AS base

WORKDIR /app
RUN apk add --no-cache postgresql-client git openssh-client

# === 의존성 설치 단계 ===
FROM base AS deps
COPY package*.json ./
RUN npm ci

# === 프로덕션 의존성 설치 단계 ===
FROM base AS deps-prod
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# === 빌드 단계 ===
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY tsconfig*.json ./
COPY libs/ ./libs/
COPY packages/ ./packages/
COPY apps/ugc-service/ ./apps/ugc-service/

RUN npm run build:ugc-service

# === 프로덕션 단계 ===
FROM base AS runner
# 런타임 이미지에서는 이미 deps 레이어에서 설치한 node_modules를 재사용하여 중복 설치를 피함
COPY --from=deps-prod /app/node_modules ./node_modules
COPY package*.json ./

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/libs ./libs
# drizzle 디렉토리는 비어있어 복사하지 않음 (마이그레이션은 별도 실행)

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

USER nestjs

ENV NODE_ENV=production
ENV PORT=3030

EXPOSE 3030

CMD ["npm", "run", "start:ugc-service:prod"]