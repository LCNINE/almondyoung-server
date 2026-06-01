/// <reference path="../../../../.sst/platform/config.d.ts" />

import type { PlatformInfra } from "./shared";

// Redpanda Console: 단일 노드 Redpanda 의 토픽/메시지/컨슈머 그룹을 시각화하는 관리 콘솔.
// Redpanda 와 라이프사이클을 함께 가져가도록 platform 에 둔다 — services stack 의 ALB 를
// 빌려쓰면 의존 그래프가 역전(platform → services)되므로 전용 ALB 를 새로 띄운다 (~$16/월).
//
// ⚠ 현재 인증 미적용. Console 자체는 정적 비밀번호 env 옵션이 없으므로
// (외부 IdP OIDC 만 지원), 인터넷 노출 시 다음 중 하나로 보호할 것:
//   1) ALB authenticate-oidc → lcnine-auth IdP 에 console RP 등록
//   2) Console OIDC config (kafka-console v3.x) → 동일하게 lcnine-auth 사용
//   3) ALB SG IP 화이트리스트 (사무실 IP 고정 가능 시 가장 간단)
export function setup(infra: PlatformInfra) {
  const { isDev, vpc, kafkaBrokers } = infra;

  // services stack 과 같은 zone 을 사용. wildcard ALB 가 services 에 있어도
  // specific A record 가 우선이라 라우팅 충돌 없음.
  const baseDomain = isDev ? "lcnine-dev.com" : "almondyoung-next.com";
  const consoleDomain = isDev
    ? `console.dev.${baseDomain}`
    : `console.${baseDomain}`;

  const cluster = new sst.aws.Cluster("ConsoleCluster", { vpc });

  const alb = new sst.aws.Alb("ConsoleAlb", {
    vpc,
    domain: { name: consoleDomain },
    listeners: [{ port: 443, protocol: "https" }],
  });

  // Console 의 dot-notation 설정은 SCREAMING_SNAKE_CASE 환경변수로 매핑된다
  // (e.g. kafka.brokers ↔ KAFKA_BROKERS). 단일 노드 PLAINTEXT 라 추가 설정 불필요.
  new sst.aws.Service("RedpandaConsole", {
    cluster,
    image: "docker.redpanda.com/redpandadata/console:latest",
    cpu: "0.25 vCPU",
    memory: "0.5 GB",
    loadBalancer: {
      instance: alb,
      // 전용 ALB 라 catch-all 이지만 SST 가 external ALB 룰에 condition 을 강제 → path /*
      rules: [{ listen: "443/https", forward: "8080/http", conditions: { path: "/*" } }],
    },
    environment: {
      KAFKA_BROKERS: kafkaBrokers,
    },
  });
}
