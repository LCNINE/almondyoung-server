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
  const cluster = new sst.aws.Cluster("Cluster", {
    vpc: {
      id: vpc.id,
      securityGroups: vpc.securityGroups,
      publicSubnets: vpc.publicSubnets,
      loadBalancerSubnets: vpc.publicSubnets,
      containerSubnets: vpc.privateSubnets,
      cloudmapNamespaceId: vpc.nodes.cloudmapNamespace.id,
      cloudmapNamespaceName: vpc.nodes.cloudmapNamespace.name,
    },
  });

  // ─── Domain helper ───
  const baseDomain = opts?.baseDomain ?? (isDev ? "lcnine-dev.com" : "almondyoung-next.com");
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
  const db = new sst.aws.Postgres("Db", {
    vpc,
    instance: "t4g.medium",
  });

  const dbUrl = (dbName: string) =>
    $interpolate`postgresql://${db.username}:${db.password}@${db.host}:${db.port}/${dbName}?sslmode=require`;

  // ─── Redis (ElastiCache Serverless) ───
  const redis = new sst.aws.Redis("Redis", { vpc, cluster: false });
  const encodedRedisPassword = redis.password?.apply((p) =>
    encodeURIComponent(p),
  );
  const redisUrl = (dbIndex: number) =>
    $interpolate`rediss://${redis.username}:${encodedRedisPassword}@${redis.host}:${redis.port}/${dbIndex}`;

  // ─── OpenSearch (VPC, single-AZ, t3.small.search) ───
  // sst.aws.OpenSearch 는 vpc 옵션을 직접 받지 않아 transform.domain 으로 vpcOptions 를 주입한다.
  // 한국어 형태소 분석은 AWS-managed `analysis-nori` 패키지를 도메인에 associate 해서 활성화 (built-in 아님).
  // 패키지 ID 는 region + EngineVersion 별로 다름 — 아래 값은 ap-northeast-2 / OpenSearch_2.17.
  // 엔진 버전 업그레이드 시 `aws opensearch describe-packages --filters Name=PackageName,Value=analysis-nori` 로 새 ID 조회.
  const vpcInfo = aws.ec2.getVpcOutput({ id: vpc.id });
  const opensearchSg = new aws.ec2.SecurityGroup("OpensearchSg", {
    vpcId: vpc.id,
    description: "Allow HTTPS to OpenSearch domain from within VPC",
    ingress: [
      {
        protocol: "tcp",
        fromPort: 443,
        toPort: 443,
        cidrBlocks: [vpcInfo.cidrBlock],
      },
    ],
    egress: [
      { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
    ],
  });
  const opensearch = new sst.aws.OpenSearch("Opensearch", {
    instance: "t3.small",
    storage: "10 GB",
    transform: {
      domain: (args) => {
        args.vpcOptions = {
          subnetIds: vpc.privateSubnets.apply((ids) => [ids[0]]),
          securityGroupIds: [opensearchSg.id],
        };
      },
    },
  });
  // Pulumi-aws 의 PackageAssociation 기본 wait 가 10분이라 t3.small 도메인 plugin install +
  // rolling restart 에 부족할 때가 많다 — 60분으로 늘려둔다.
  new aws.opensearch.PackageAssociation(
    "OpensearchNoriAssociation",
    {
      packageId: "G267799487",
      domainName: opensearch.nodes.domain!.domainName,
    },
    {
      customTimeouts: { create: "60m", update: "60m", delete: "60m" },
    },
  );

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
  // cpu/memory/scaling 은 sst.aws.Service 가 그대로 받아 Fargate 에 적용한다.
  // 백필 등 일시적 부하 대응 시 services.ts 에서 옵션으로 지정 → 끝나면 원복.
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
      cpu?: string; // e.g. "0.25 vCPU", "1 vCPU", "2 vCPU"
      memory?: string; // e.g. "0.5 GB", "2 GB", "4 GB"
      scaling?: { min: number; max: number };
    },
  ) =>
    new sst.aws.Service(name, {
      cluster,
      link: opts.link,
      ...(opts.cpu ? { cpu: opts.cpu as any } : {}),
      ...(opts.memory ? { memory: opts.memory as any } : {}),
      ...(opts.scaling ? { scaling: opts.scaling } : {}),
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
        service: (args: Record<string, any>) => {
          // Route outbound traffic through NAT EC2 (fixed EIP) instead of per-task public IP.
          // SST defaults to public subnets + assignPublicIp=true for its own Vpc; override here.
          args.networkConfiguration = vpc.privateSubnets.apply((subnets) =>
            vpc.securityGroups.apply((sgs) => ({
              assignPublicIp: false,
              subnets,
              securityGroups: sgs,
            })),
          );
          // Forward any caller-provided transform.service (function or partial object)
          const orig = opts.transform?.service;
          if (typeof orig === "function") orig(args);
          else if (orig != null) Object.assign(args, orig);
        },
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
    opensearch,
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
