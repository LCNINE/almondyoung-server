/// <reference path="../../../.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "lcnine-platform",
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
    const console = await import("./infra/console");

    const infra = shared.setup();
    services.setup(infra);
    console.setup(infra);

    return {
      vpcId: infra.vpc.id,
      kafkaBrokers: infra.kafkaBrokers,
      natPublicIps: infra.vpc.nodes.elasticIps.apply((ips) =>
        ips.map((ip) => ip.publicIp),
      ),
    };
  },
});
