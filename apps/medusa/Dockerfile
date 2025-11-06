FROM node:20-alpine

# 기본 런타임 설정
ENV PORT=9000

# 1) 루트 의존성 설치 (libs/*가 필요로 하는 의존성 포함)
WORKDIR /app
RUN apk add --no-cache postgresql-client git openssh-client
COPY package.json package-lock.json ./
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

# 4) 애플리케이션 빌드 (Medusa CLI가 빌드 수행)
RUN yarn build

# DEBUG: 빌드 후 디렉토리 구조 확인
RUN echo "===== Build output structure =====" && \
    ls -la /app/apps/medusa/ && \
    echo "===== .medusa directory =====" && \
    ls -la /app/apps/medusa/.medusa/ && \
    echo "===== .medusa/server directory =====" && \
    ls -la /app/apps/medusa/.medusa/server/

# 5) 커스텀 모듈 및 소스를 빌드 디렉토리로 복사
RUN cp -r /app/apps/medusa/src /app/apps/medusa/.medusa/server/src

# 6) 빌드 산출물 디렉토리로 이동 및 프로덕션 의존성 설치
WORKDIR /app/apps/medusa/.medusa/server
RUN yarn install --frozen-lockfile --non-interactive --production

# 7) 프로덕션 환경 설정 및 캐시 정리
ENV NODE_ENV=production
RUN yarn cache clean

EXPOSE 9000

# 외부 인프라는 환경 변수로 주입 (DATABASE_URL, REDIS_URL, KAFKA_BROKERS 등)
# .medusa/server 디렉토리에서 실행
CMD ["yarn", "start"]


