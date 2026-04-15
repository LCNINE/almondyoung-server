/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "almondyoung-server",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
      providers: {
        aws: { region: "ap-northeast-2" },
      },
    };
  },
  async run() {
    const shared = await import("./infra/shared");
    const services = await import("./infra/services");

    const infra = shared.setup();
    services.setup(infra);

    return {
      dbHost: infra.db.host,
      redisHost: infra.redis.host,
      medusaUrl: infra.url("medusa"),
      userServiceUrl: infra.url("user"),
      walletUrl: infra.url("wallet"),
    };
  },
});
