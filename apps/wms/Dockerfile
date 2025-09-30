# WMS 서비스 Dockerfile
FROM node:22-alpine AS base

# 작업 디렉토리 설정
WORKDIR /app

# 시스템 의존성 설치 (PostgreSQL 클라이언트, git 등)
RUN apk add --no-cache postgresql-client git openssh-client

# === 의존성 설치 단계 ===
FROM base AS deps

# package.json과 package-lock.json 복사
COPY package*.json ./

# 의존성 설치 (개발 의존성 포함 - 빌드에 필요)
RUN npm ci

# === 프로덕션 의존성 설치 단계 ===
FROM base AS deps-prod
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# === 빌드 단계 ===
FROM base AS builder

# 의존성 복사
COPY --from=deps /app/node_modules ./node_modules

# 소스 코드 복사
COPY . .

# TypeScript 설정 및 라이브러리 복사
COPY tsconfig*.json ./
COPY libs/ ./libs/
COPY apps/wms/ ./apps/wms/

# WMS 서비스 빌드
RUN npm run build:wms

# === 프로덕션 단계 ===
FROM base AS runner

# 런타임 이미지에서는 이미 deps-prod 레이어에서 설치한 node_modules를 재사용하여 중복 설치를 피함
COPY --from=deps-prod /app/node_modules ./node_modules
COPY package*.json ./

# 빌드된 앱과 필요한 파일들 복사
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/libs ./libs
COPY --from=builder /app/apps/wms/database ./apps/wms/database

# 비루트 사용자 생성 및 권한 설정
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs
USER nestjs

# 환경변수 설정
ENV NODE_ENV=production
ENV PORT=3000

# 포트 노출
EXPOSE 3000

# 헬스체크 추가
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# 서비스 시작
CMD ["npm", "run", "start:wms:prod"]