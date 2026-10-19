# UGC 서비스 Dockerfile
FROM node:22-alpine AS base

WORKDIR /app
RUN apk add --no-cache postgresql-client git openssh-client

# === 의존성 설치 단계 ===
FROM base AS deps
COPY package*.json ./
COPY packages/hms-api-wrapper/ ./packages/hms-api-wrapper/
RUN npm ci

# === 프로덕션 의존성 설치 단계 ===
FROM base AS deps-prod
COPY package*.json ./
COPY packages/hms-api-wrapper/ ./packages/hms-api-wrapper/
RUN npm ci --omit=dev && npm cache clean --force

# === 빌드 단계 ===
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./
COPY libs/ ./libs/
COPY packages/ ./packages/
COPY apps/ugc-service/ ./apps/ugc-service/

RUN npm run build:ugc-service

# === 인쇄용 글꼴 (apps/ugc-service/print-fonts.txt) ===
FROM --platform=$BUILDPLATFORM node:22-alpine AS print-fonts
COPY apps/ugc-service/print-fonts.txt /tmp/print-fonts.txt
RUN set -eu; mkdir -p /fonts; \
  sha=$(sed -n 's/^commit //p' /tmp/print-fonts.txt); \
  grep -v -e '^#' -e '^commit ' -e '^$' /tmp/print-fonts.txt | while read -r path; do \
    for try in 1 2 3 4 5; do \
      wget -q -T 60 -O "/fonts/${path##*/}" "https://raw.githubusercontent.com/google/fonts/$sha/ofl/$path" && break; \
      sleep 5; \
    done; \
    [ -s "/fonts/${path##*/}" ] || { echo "글꼴을 받지 못했습니다: $path" >&2; exit 1; }; \
  done

# === 프로덕션 단계 ===
FROM base AS runner
# py3-fonttools: 업로드 글꼴 WOFF·WOFF2 를 TTF 로 푼다(pango 가 WOFF2 를 못 읽는다)
RUN apk add --no-cache ghostscript rsvg-convert fontconfig font-noto-cjk py3-fonttools py3-brotli
COPY --from=print-fonts /fonts /usr/share/fonts/almond
COPY apps/ugc-service/print-fonts.conf /etc/fonts/conf.d/60-almond-print.conf
RUN fc-cache -f
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