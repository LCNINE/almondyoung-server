# PIM 서비스 Dockerfile
FROM node:22-alpine AS base

WORKDIR /app
RUN apk add --no-cache postgresql-client

# === 의존성 설치 단계 ===
FROM base AS deps
COPY package*.json ./
RUN npm ci

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
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/libs ./libs
COPY --from=builder /app/apps/pim/drizzle ./apps/pim/drizzle

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs
USER nestjs

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

CMD ["npm", "run", "start:pim:prod"]