/// <reference path="../../../../.sst/platform/config.d.ts" />

// lcnine-auth: IdP (user-service + auth-web). VPC/Kafka는 lcnine-platform이 소유하고
// 여기서는 SSM으로 id만 읽어 공유한다. Cloud Map 네임스페이스도 VPC에 귀속되므로
// 같은 VPC에 붙으면 platform의 Redpanda DNS가 자동 해석된다.

export function setup() {
  // "live" 외의 모든 stage는 비운영으로 취급 (도메인 .dev. 접두사, bastion 등).
  const isDev = $app.stage !== "live";

  const baseDomain = isDev ? "lcnine-dev.com" : "almondyoung-next.com";
  const domain = (slug: string) =>
    isDev ? `${slug}.dev.${baseDomain}` : `${slug}.${baseDomain}`;
  const url = (slug: string) => `https://${domain(slug)}`;

  // ─── Platform 공유 자원 (lcnine-platform이 publish) ───
  const platformVpcId = aws.ssm.getParameterOutput({
    name: `/lcnine-platform/${$app.stage}/vpc-id`,
  }).value;
  const kafkaBrokers = aws.ssm.getParameterOutput({
    name: `/lcnine-platform/${$app.stage}/kafka-brokers`,
  }).value;

  const vpc = sst.aws.Vpc.get("IdpVpc", platformVpcId);
  const cluster = new sst.aws.Cluster("IdpCluster", { vpc });

  // ─── ALB (user-service 전용, non-wildcard hostname) ───
  // 같은 Route53 zone에서 specific A record가 wildcard alias보다 우선되므로
  // user.<base>를 이 ALB로 정확히 라우팅.
  const userAlb = new sst.aws.Alb("IdpUserAlb", {
    vpc,
    domain: { name: domain("user") },
    listeners: [
      { port: 80, protocol: "http" },
      { port: 443, protocol: "https" },
    ],
  });

  // ─── IdP 전용 DB (platform VPC에 배치) ───
  const db = new sst.aws.Postgres("IdpDb", { vpc });

  const dbUrl = (dbName: string) =>
    $interpolate`postgresql://${db.username}:${db.password}@${db.host}:${db.port}/${dbName}?sslmode=require`;

  const baseEnv = (serviceName: string) => ({
    NODE_ENV: "production",
    OTEL_SERVICE_NAME: serviceName,
  });

  const createBackendService = (
    name: string,
    opts: {
      dockerfile: string;
      dockerContext: string;
      port: number;
      environment: Record<string, $util.Output<string> | string>;
      buildArgs?: Record<string, $util.Output<string> | string>;
      link?: sst.Linkable[];
      loadBalancerHealth?: Record<string, any>;
      serviceName: string;
    },
  ) =>
    new sst.aws.Service(name, {
      cluster,
      link: opts.link,
      loadBalancer: {
        instance: userAlb,
        rules: [
          {
            listen: "443/https",
            forward: `${opts.port}/http` as const,
            conditions: { path: "/*" },
            priority: 100,
          },
        ],
        health: opts.loadBalancerHealth,
      },
      image: {
        context: opts.dockerContext,
        dockerfile: opts.dockerfile,
        args: opts.buildArgs,
      },
      environment: {
        ...baseEnv(opts.serviceName),
        PORT: String(opts.port),
        ...opts.environment,
      },
    });

  return {
    isDev,
    vpc,
    cluster,
    db,
    userAlb,
    dbUrl,
    baseDomain,
    domain,
    url,
    baseEnv,
    createBackendService,
    kafkaBrokers,
  };
}

export type IdpInfra = ReturnType<typeof setup>;
