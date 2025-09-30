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

# 3) 소스 복사: 메두사, 공용 libs, 채널 어댑터 타입(경로 참조용)
COPY apps/medusa/ ./
COPY libs /app/libs
RUN mkdir -p /app/apps/channel-adapter/src
COPY apps/channel-adapter/src/types.ts /app/apps/channel-adapter/src/types.ts

# 4) 애플리케이션 빌드 (Medusa CLI가 빌드 수행)
RUN yarn build

# 5) 런타임 최적화: 메두사 프로덕션 의존성만 남기기
ENV NODE_ENV=production
RUN yarn install --production --frozen-lockfile --non-interactive && yarn cache clean

EXPOSE 9000

# 외부 인프라는 환경 변수로 주입 (DATABASE_URL, REDIS_URL, KAFKA_BROKERS 등)
CMD ["yarn", "start"]


