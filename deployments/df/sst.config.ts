/// <reference path="../../.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "df",
      // "live" = 운영 stage. 삭제 저항성(retain)과 protect 적용. 도메인도 접두사 없음.
      removal: input?.stage === "live" ? "retain" : "remove",
      protect: ["live"].includes(input?.stage),
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
      storefrontUrl: infra.url("www"),
      walletWebUrl: infra.url("wallet-web"),
      adminUrl: infra.url("admin"),
    };
  },
});
