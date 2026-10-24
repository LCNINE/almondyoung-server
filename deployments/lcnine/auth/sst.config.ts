/// <reference path="../../../.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    const isLive = input?.stage === "live";
    const isDemo = input?.stage === "demo";
    return {
      name: "lcnine-auth",
      // "live" = 운영 stage. 삭제 저항성(retain)과 protect 적용. 도메인도 접두사 없음.
      removal: isLive ? "retain" : "remove",
      protect: isLive || isDemo,
      home: "aws",
      // state 버킷의 옛 버전 정리 — 이유와 동작은 services/sst.config.ts 의 같은 줄 주석.
      state: { retention: 30 },
      providers: {
        aws: { region: "ap-northeast-2" },
      },
    };
  },
  async run() {
    const shared = await import("./infra/shared");
    const infra = shared.setup();
    const infraOnly = $app.stage === "demo" && process.env.DEMO_INFRA_ONLY === "true";
    if (!infraOnly) {
      const services = $app.stage === "demo" ? await import("./infra/demo-services") : await import("./infra/services");
      services.setup(infra);
    }

    return {
      dbHost: infra.db.host,
      userServiceUrl: infra.url("user"),
      authWebUrl: infra.url("auth"),
      infraOnly,
    };
  },
});
