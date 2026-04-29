/// <reference path="../../../../.sst/platform/config.d.ts" />

// lcnine-services: 커머스/물류/결제 도메인 서비스. VPC와 Kafka(Redpanda)는 lcnine-platform이
// 소유하고 여기서는 SSM으로 id/브로커 주소만 읽어 공유한다. DB/Redis/ALB는 services 전용으로
// 이 앱이 직접 소유한다.

export function setup(opts?: { baseDomain?: string }) {
  // "live" 외의 모든 stage는 비운영으로 취급 (도메인 .dev. 접두사 등).
  const isDev = $app.stage !== "live";

  // Dockerfile은 모노레포 루트 기준 경로로 작성되어 있으므로 context를 repo root로 올린다.
  const dockerContext = "../../../";

  // ─── Platform 공유 자원 (lcnine-platform이 publish) ───
  const platformVpcId = aws.ssm.getParameterOutput({
    name: `/lcnine-platform/${$app.stage}/vpc-id`,
  }).value;
  const kafkaBrokers = aws.ssm.getParameterOutput({
    name: `/lcnine-platform/${$app.stage}/kafka-brokers`,
  }).value;

  const vpc = sst.aws.Vpc.get("Vpc", platformVpcId);
  const cluster = new sst.aws.Cluster("Cluster", { vpc });

  // ─── Domain helper ───
  const baseDomain = opts?.baseDomain ?? "lcnine-dev.com";
  const domain = (slug: string) =>
    isDev ? `${slug}.dev.${baseDomain}` : `${slug}.${baseDomain}`;
  const url = (slug: string) => `https://${domain(slug)}`;

  // ─── Shared ALB (wildcard) ───
  // auth 앱은 specific hostname(id./auth.)으로 같은 zone에 ALB를 잡는다. Route53에서
  // specific A record가 wildcard alias보다 우선되므로 충돌 없음.
  const wildcardDomain = isDev
    ? `*.dev.${baseDomain}`
    : `*.${baseDomain}`;

  const alb = new sst.aws.Alb("SharedAlb", {
    vpc,
    domain: { name: wildcardDomain },
    listeners: [
      { port: 80, protocol: "http" },
      { port: 443, protocol: "https" },
    ],
  });

  // ─── Database ───
  const db = new sst.aws.Postgres("Db", { vpc });

  const dbUrl = (dbName: string) =>
    $interpolate`postgresql://${db.username}:${db.password}@${db.host}:${db.port}/${dbName}?sslmode=require`;

  // ─── Redis (ElastiCache Serverless) ───
  const redis = new sst.aws.Redis("Redis", { vpc, cluster: false });
  const encodedRedisPassword = redis.password?.apply((p) =>
    encodeURIComponent(p),
  );
  const redisUrl = (dbIndex: number) =>
    $interpolate`rediss://${redis.username}:${encodedRedisPassword}@${redis.host}:${redis.port}/${dbIndex}`;

  // ─── Common env builders ───
  const baseEnv = (serviceName: string) => ({
    NODE_ENV: "production",
    OTEL_SERVICE_NAME: serviceName,
  });

  // platform Redpanda는 VPC 내부 PLAINTEXT. kafka-config.util은 API key/SASL 미지정 시
  // plaintext로 자동 fallback하므로 브로커 주소와 prefix/group만 주입하면 된다.
  const kafkaEnv = (prefix: string, groupId: string) => ({
    KAFKA_BROKERS: kafkaBrokers,
    KAFKA_CLIENT_ID_PREFIX: prefix,
    KAFKA_GROUP_ID: groupId,
  });

  // ─── Service helper ───
  const createService = (
    name: string,
    opts: {
      dockerfile: string;
      domainSlug: string;
      port: number;
      priority: number;
      environment: Record<string, $util.Output<string> | string>;
      buildArgs?: Record<string, $util.Output<string> | string>;
      link?: sst.Linkable<any>[];
      loadBalancerHealth?: Record<string, any>;
      transform?: any;
    },
  ) =>
    new sst.aws.Service(name, {
      cluster,
      link: opts.link,
      loadBalancer: {
        instance: alb,
        rules: [
          {
            listen: "443/https",
            forward: `${opts.port}/http` as const,
            conditions: { path: "/*" },
            priority: opts.priority,
          },
        ],
        health: opts.loadBalancerHealth,
      },
      image: {
        context: dockerContext,
        dockerfile: opts.dockerfile,
        args: opts.buildArgs,
      },
      environment: {
        ...baseEnv(opts.domainSlug),
        PORT: String(opts.port),
        ...opts.environment,
      },
      transform: {
        ...opts.transform,
        listenerRule: (args: Record<string, any>) => {
          args.conditions = [
            { hostHeader: { values: [domain(opts.domainSlug)] } },
          ];
        },
      },
    });

  return {
    isDev,
    vpc,
    cluster,
    db,
    redis,
    dbUrl,
    redisUrl,
    baseDomain,
    domain,
    url,
    baseEnv,
    kafkaEnv,
    createService,
  };
}

export type SharedInfra = ReturnType<typeof setup>;
