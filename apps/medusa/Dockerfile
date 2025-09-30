FROM node:20-alpine

# 기본 런타임 설정
ENV PORT=9000

WORKDIR /app/apps/medusa

# Yarn v1 고정 (이 프로젝트는 yarn.lock 기반)
RUN corepack enable && corepack prepare yarn@1.22.22 --activate

# 의존성 캐시 최적화: 메두사 매니페스트만 복사
COPY apps/medusa/package.json apps/medusa/yarn.lock ./

# 모든 의존성 설치 (빌드를 위해 devDependencies 포함)
RUN yarn install --frozen-lockfile --non-interactive

# 앱 소스 복사
COPY apps/medusa/ ./

# 애플리케이션 빌드 (Medusa CLI가 빌드 수행)
RUN yarn build

# 런타임 최적화: 프로덕션 의존성만 남기기
ENV NODE_ENV=production
RUN yarn install --production --frozen-lockfile --non-interactive && yarn cache clean

EXPOSE 9000

# 외부 인프라는 환경 변수로 주입 (DATABASE_URL, REDIS_URL, KAFKA_BROKERS 등)
CMD ["yarn", "start"]


