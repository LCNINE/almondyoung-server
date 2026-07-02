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
    // Redpanda Console(Kafka 점검용 관리 UI, 데이터 경로 아님)은 비-live 에서만 띄운다.
    // live 에서는 전용 ALB(~$16/월)+Fargate 비용과 무인증 인터넷 노출을 피한다.
    // 라이브 Kafka 점검이 필요하면 `sst tunnel --stage live` + rpk, 또는 일시적으로 재배포.
    if (infra.isDev) console.setup(infra);

    return {
      vpcId: infra.vpc.id,
      kafkaBrokers: infra.kafkaBrokers,
      natPublicIps: infra.vpc.nodes.elasticIps.apply((ips) =>
        ips.map((ip) => ip.publicIp),
      ),
    };
  },
});
