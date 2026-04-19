/// <reference path="../../.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "df",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
      providers: {
        aws: { region: "ap-northeast-2" },
      },
    };
  },
  async run() {
    const shared = await import("../../infra/shared");
    const services = await import("./services");

    const infra = shared.setup({ baseDomain: "df.lcnine-dev2.com", context: "../.." });
    services.setup(infra);

    return {
      dbHost: infra.db.host,
      redisHost: infra.redis.host,
      medusaUrl: infra.url("medusa"),
      userServiceUrl: infra.url("user"),
      walletUrl: infra.url("wallet"),
      apiUrl: infra.url("api"),
      authUrl: infra.url("auth"),
    };
  },
});
