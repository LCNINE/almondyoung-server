/// <reference path="../../../.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "lcnine-auth",
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
    const shared = await import("./infra/shared");
    const services = await import("./infra/services");

    const infra = shared.setup();
    services.setup(infra);

    return {
      dbHost: infra.db.host,
      userServiceUrl: infra.url("user"),
      authWebUrl: infra.url("auth"),
    };
  },
});
