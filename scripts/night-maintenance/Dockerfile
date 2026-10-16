FROM node:22-bookworm-slim AS build
WORKDIR /build
COPY package.json yarn.lock ./
RUN corepack enable && corepack prepare yarn@1.22.22 --activate && yarn install --frozen-lockfile
COPY src ./src
RUN yarn build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl --fail --silent --show-error https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /app/rds-ca.pem \
    && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY --from=build /build/dist/main.cjs /app/main.cjs
ENV NODE_ENV=production TZ=UTC DB_CA_FILE=/app/rds-ca.pem
USER node
CMD ["node", "/app/main.cjs"]
