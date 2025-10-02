# PIM 서비스 Dockerfile
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
COPY apps/pim/ ./apps/pim/

RUN npm run build:pim

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

# 이미지 업로드 디렉토리 생성 및 권한 설정 고지훈 임시수정
RUN mkdir -p /app/images && chown -R nestjs:nodejs /app/images

USER nestjs

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

CMD ["npm", "run", "start:pim:prod"]