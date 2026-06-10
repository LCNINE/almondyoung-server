# Channel Adapter 서비스 Dockerfile
FROM node:22-alpine AS base

WORKDIR /app
RUN apk add --no-cache postgresql-client git openssh-client

FROM base AS deps
COPY package*.json ./
COPY packages/hms-api-wrapper/ ./packages/hms-api-wrapper/
RUN npm ci

FROM base AS deps-prod
COPY package*.json ./
COPY packages/hms-api-wrapper/ ./packages/hms-api-wrapper/
RUN npm ci --omit=dev && npm cache clean --force

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./
COPY libs/ ./libs/
COPY packages/ ./packages/
COPY apps/channel-adapter/ ./apps/channel-adapter/

# 2026-06-10: buildx registry 캐시가 소스 변경(inbox-worker timestamp fix)을 건너뛰어
# 옛 dist 가 이미지에 들어가는 문제가 있었다. 빌드 레이어 캐시를 무효화하기 위한 버스터.
RUN echo "cachebust 2026-06-10 inbox-timestamp-fix" && npm run build:channel-adapter

FROM base AS runner
# 운영 코드용 prod node_modules 와, 일회성 마이그레이션 스크립트(ts-node) 용 dev 포함 node_modules 를
# 따로 둔다. 운영 npm scripts/healthcheck 는 ./node_modules 를 그대로 사용하고,
# scripts 실행 시에만 NODE_PATH 로 _scripts_node_modules 를 추가로 노출한다.
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=deps /app/node_modules ./_scripts_node_modules
COPY package*.json ./

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/libs ./libs

# 일회성 backfill/migration 스크립트 실행에 필요한 소스 + tsconfig.
# 운영 entrypoint(start:channel-adapter:prod)는 dist/ 만 사용하므로 영향 없음.
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/apps/channel-adapter/tsconfig.app.json ./apps/channel-adapter/tsconfig.app.json
COPY --from=builder /app/apps/channel-adapter/src ./apps/channel-adapter/src
COPY --from=builder /app/apps/channel-adapter/scripts ./apps/channel-adapter/scripts
COPY --from=builder /app/packages ./packages

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs
USER nestjs

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

CMD ["npm", "run", "start:channel-adapter:prod"]