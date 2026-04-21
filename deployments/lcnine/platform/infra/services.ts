/// <reference path="../../../../.sst/platform/config.d.ts" />

import type { PlatformInfra } from "./shared";

// consumer 앱(lcnine-auth, lcnine-services)이 aws.ssm.getParameterOutput()으로 읽어가는
// 공유 자원 포인터를 여기서 publish한다. 키는 /{app-name}/{stage}/{resource} 규칙.
export function setup(infra: PlatformInfra) {
  const { vpc, kafkaBrokers } = infra;

  new aws.ssm.Parameter("PlatformVpcId", {
    name: `/lcnine-platform/${$app.stage}/vpc-id`,
    type: "String",
    value: vpc.id,
  });

  new aws.ssm.Parameter("PlatformKafkaBrokers", {
    name: `/lcnine-platform/${$app.stage}/kafka-brokers`,
    type: "String",
    value: kafkaBrokers,
  });

  // PLAINTEXT/SASL 전환 여지를 위해 consumer에서 읽어쓸 수 있도록 같이 publish.
  // 현재는 VPC 내부 plaintext. 외부 노출이나 인증이 필요해지면 이 값만 바꾸면 됨.
  new aws.ssm.Parameter("PlatformKafkaSecurityProtocol", {
    name: `/lcnine-platform/${$app.stage}/kafka-security-protocol`,
    type: "String",
    value: "PLAINTEXT",
  });
}
