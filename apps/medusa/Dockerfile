FROM node:22-alpine

# Build-time env for Vite-powered admin bundle
ARG VITE_USER_SERVICE_URL
ARG MEDUSA_BACKEND_URL

# 기본 런타임 설정
ENV PORT=9000

# 1) 루트 의존성 설치 (libs/*가 필요로 하는 의존성 포함)
WORKDIR /app
RUN apk add --no-cache postgresql-client git openssh-client
COPY package.json package-lock.json ./
COPY packages/hms-api-wrapper/ ./packages/hms-api-wrapper/
RUN npm ci --no-audit --no-fund

# 2) 메두사 의존성 설치 (yarn v1)
WORKDIR /app/apps/medusa
RUN corepack enable && corepack prepare yarn@1.22.22 --activate
COPY apps/medusa/package.json apps/medusa/yarn.lock ./
RUN yarn install --frozen-lockfile --non-interactive

# 3) 소스 복사: 메두사, 공용 libs, packages, 채널 어댑터 타입(경로 참조용)
COPY apps/medusa/ ./
COPY libs /app/libs
COPY packages /app/packages
RUN rm -rf /app/libs/db
RUN mkdir -p /app/apps/channel-adapter/src
COPY apps/channel-adapter/src/types.ts /app/apps/channel-adapter/src/types.ts

# 3-1) 백필 데이터 baking 가드 — apps/medusa/scripts/extract-core-snapshots.ts 가
# 사전에 실행되어 src/data/core-snapshots.json.gz 가 존재해야 백필 스크립트가 동작.
# 누락이어도 일반 런타임은 동작하므로 build fail 은 시키지 않고 경고만 출력.
RUN if [ -f src/data/core-snapshots.json.gz ]; then \
      echo "[backfill data] OK: $(ls -lh src/data/core-snapshots.json.gz | awk '{print $5}') bundle baked"; \
    else \
      echo "[backfill data] WARN: src/data/core-snapshots.json.gz missing — backfill-from-core 스크립트 사용 시 추출 필요"; \
    fi

# 4) 애플리케이션 빌드 (Medusa CLI가 빌드 수행)
# Vite envs must be present at build time to be baked into the admin bundle
ENV VITE_USER_SERVICE_URL=$VITE_USER_SERVICE_URL
ENV MEDUSA_BACKEND_URL=$MEDUSA_BACKEND_URL
RUN yarn build

# DEBUG: 빌드 후 디렉토리 구조 확인
RUN echo "===== Build output structure =====" && \
    ls -la /app/apps/medusa/ && \
    echo "===== .medusa directory =====" && \
    ls -la /app/apps/medusa/.medusa/ && \
    echo "===== .medusa/server directory =====" && \
    ls -la /app/apps/medusa/.medusa/server/

# 5) medusa-config.js와 src 디렉토리를 .medusa/server에 복사
RUN cp /app/apps/medusa/medusa-config.js /app/apps/medusa/.medusa/server/medusa-config.js && \
    cp /app/apps/medusa/instrumentation.ts /app/apps/medusa/.medusa/server/instrumentation.ts && \
    cp -r /app/apps/medusa/src /app/apps/medusa/.medusa/server/src

# DEBUG: 복사 후 확인
RUN echo "===== After copying config and src =====" && \
    ls -la /app/apps/medusa/.medusa/server/ && \
    echo "===== Checking src/modules =====" && \
    ls -la /app/apps/medusa/.medusa/server/src/modules/

# 6) 빌드 산출물 디렉토리로 이동 및 프로덕션 의존성 설치
WORKDIR /app/apps/medusa/.medusa/server
RUN yarn install --frozen-lockfile --non-interactive --production

# 6-1) 필수 모듈(@medusajs/api-key) 존재 확인 (없으면 빌드 실패)
RUN node -e "const deps=require('./package.json').dependencies||{}; if(!deps['@medusajs/api-key']){console.error('Missing @medusajs/api-key in .medusa/server/package.json'); process.exit(1);} else {console.log('Confirmed @medusajs/api-key in build output');}" \
 && test -d node_modules/@medusajs/api-key || (ls node_modules/@medusajs && exit 1)

# 7) 프로덕션 환경 설정 및 캐시 정리
ENV NODE_ENV=production
RUN yarn cache clean

EXPOSE 9000

# 외부 인프라는 환경 변수로 주입 (DATABASE_URL, REDIS_URL, KAFKA_BROKERS 등)
# .medusa/server 디렉토리에서 실행. Migration 은 ADR-0005 §5 에 따라 SST autodeploy
# workflow 의 별도 step (`medusa db:migrate --execute-safe-links` = predeploy 스크립트) 이
# 책임. container 부팅 시 자체 migration 은 race / 부팅 latency 격리 이유로 제거.
CMD ["yarn", "start"]
