/// <reference path="../../../../.sst/platform/config.d.ts" />

// lcnine-services: 커머스/물류/결제 도메인 서비스. VPC와 Kafka(Redpanda)는 lcnine-platform이
// 소유하고 여기서는 SSM으로 id/브로커 주소만 읽어 공유한다. DB/Redis/ALB는 services 전용으로
// 이 앱이 직접 소유한다.

export function setup(opts?: { baseDomain?: string }) {
  // "live" 외의 모든 stage는 비운영으로 취급 (도메인 .dev. 접두사 등).
  const isDev = $app.stage !== 'live';

  // Dockerfile은 모노레포 루트 기준 경로로 작성되어 있으므로 context를 repo root로 올린다.
  const dockerContext = '../../../';

  // ─── Platform 공유 자원 (lcnine-platform이 publish) ───
  const platformVpcId = aws.ssm.getParameterOutput({
    name: `/lcnine-platform/${$app.stage}/vpc-id`,
  }).value;
  const kafkaBrokers = aws.ssm.getParameterOutput({
    name: `/lcnine-platform/${$app.stage}/kafka-brokers`,
  }).value;

  const vpc = sst.aws.Vpc.get('Vpc', platformVpcId);
  const cluster = new sst.aws.Cluster('Cluster', {
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
  const baseDomain = opts?.baseDomain ?? (isDev ? 'lcnine-dev.com' : 'almondyoung.com');
  const domain = (slug: string) => (isDev ? `${slug}.dev.${baseDomain}` : `${slug}.${baseDomain}`);
  const url = (slug: string) => `https://${domain(slug)}`;

  // ─── Shared ALB (wildcard) ───
  // auth 앱은 specific hostname(id./auth.)으로 같은 zone에 ALB를 잡는다. Route53에서
  // specific A record가 wildcard alias보다 우선되므로 충돌 없음.
  const wildcardDomain = isDev ? `*.dev.${baseDomain}` : `*.${baseDomain}`;

  const alb = new sst.aws.Alb('SharedAlb', {
    vpc,
    domain: { name: wildcardDomain },
    listeners: [
      { port: 80, protocol: 'http' },
      { port: 443, protocol: 'https' },
    ],
  });

  // ─── Database ───
  const db = new sst.aws.Postgres('Db', {
    vpc,
    // t4g.small(2GB): 데모 트래픽 + 논리 DB 11개 기준 다운사이즈 (비용 절감, medium 대비 -$37/월).
    // 메모리 압박(스왑/커넥션 실패) 관측 시 't4g.medium' 으로 원복 — 인스턴스 클래스 변경은
    // in-place modify 로 수 분 다운타임만 발생.
    instance: 't4g.small',
  });

  const dbUrl = (dbName: string) =>
    $interpolate`postgresql://${db.username}:${db.password}@${db.host}:${db.port}/${dbName}?sslmode=require`;

  // ─── Redis: ElastiCache 제거됨 ───
  // 유일한 컨슈머가 Medusa(replica 1 고정)라 ElastiCache(cache.t4g.micro, $17.5/월) 대신
  // Medusa 태스크 안에 valkey 사이드카 컨테이너를 띄워 localhost 로 붙는다 (services.ts 참조).
  // 캐시/이벤트버스 용도라 태스크 재시작 시 데이터 유실은 허용. Medusa 를 다시 스케일아웃하거나
  // 다른 서비스가 Redis 를 쓰게 되면 ElastiCache 를 복원할 것.

  // ─── Search: OpenSearch 도메인 제거됨 ───
  // search 서비스는 Railway(opensearch-development.up.railway.app)를 사용한다 (services.ts searchEnv).
  // AWS OpenSearch 도메인(t3.small)은 어떤 서비스도 참조하지 않는 고아 자원이라 비용절감 차원에서 삭제.
  // nori 형태소 분석이 다시 필요해지면 도메인 + OpensearchSg + OpensearchNoriAssociation 을 복원하면 됨.

  // ─── Common env builders ───
  let otelExporterOtlpEndpoint: $util.Output<string> | string | undefined;

  const setOtelExporterOtlpEndpoint = (endpoint: $util.Output<string> | string) => {
    otelExporterOtlpEndpoint = endpoint;
  };

  const baseEnv = (serviceName: string) => ({
    NODE_ENV: 'production',
    OTEL_SERVICE_NAME: serviceName,
    ...(otelExporterOtlpEndpoint ? { OTEL_EXPORTER_OTLP_ENDPOINT: otelExporterOtlpEndpoint } : {}),
  });

  const serviceDiscoveryName = (serviceName: string) =>
    $interpolate`${serviceName}.${$app.stage}.${$app.name}.${vpc.nodes.cloudmapNamespace.name}`;

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
      architecture?: 'x86_64' | 'arm64'; // 기본 x86_64. arm64(Graviton) = 동일 성능 ~20% 저렴.
      // 메인 앱 옆에 붙는 보조 컨테이너 (예: Medusa 의 valkey). 지정 시 image/environment 는
      // 'main' 컨테이너로 내려가고 ALB 룰도 'main' 으로 향한다. 같은 태스크라 localhost 로 통신.
      sidecars?: { name: string; image: string; command?: string[] }[],
    },
  ) =>
    new sst.aws.Service(name, {
      cluster,
      link: opts.link,
      ...(opts.cpu ? { cpu: opts.cpu as any } : {}),
      ...(opts.memory ? { memory: opts.memory as any } : {}),
      ...(opts.scaling ? { scaling: opts.scaling } : {}),
      ...(opts.architecture ? { architecture: opts.architecture } : {}),
      loadBalancer: {
        instance: alb,
        rules: [
          {
            listen: '443/https',
            forward: `${opts.port}/http` as const,
            // 다중 컨테이너일 때만 SST 가 container 지정을 요구한다.
            ...(opts.sidecars?.length ? { container: 'main' } : {}),
            conditions: { path: '/*' },
            priority: opts.priority,
          },
        ],
        health: opts.loadBalancerHealth,
      },
      ...(opts.sidecars?.length
        ? {
            containers: [
              {
                name: 'main',
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
              },
              ...opts.sidecars,
            ],
          }
        : {
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
          }),
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
          if (typeof orig === 'function') orig(args);
          else if (orig != null) Object.assign(args, orig);
        },
        listenerRule: (args: Record<string, any>) => {
          args.conditions = [{ hostHeader: { values: [domain(opts.domainSlug)] } }];
        },
      },
    });

  // ─── Bundle service helper (다중 호스트 → 다중 룰) ───
  // 경량 서비스 여러 개를 한 태스크에 묶는 전용 헬퍼. createService(단일 룰)와 별개로 둬서
  // 기존 단일 서비스(Core/Wallet 등)에 영향 없음. SharedAlb 에 앱별 hostHeader 룰을 priority
  // 로 구분해 얹는다. host-header 는 SST conditions 가 직접 표현 못 하므로 (기존 단일 룰과 동일하게)
  // transform.listenerRule 로 주입하되, 룰이 여러 개라 args.priority → hostname 매핑으로 룰별 지정.
  const createBundleService = (
    name: string,
    opts: {
      dockerfile: string;
      apps: { slug: string; port: number; priority: number; healthPath?: string }[];
      environment: Record<string, $util.Output<string> | string>;
      link?: sst.Linkable<any>[];
      cpu?: string;
      memory?: string;
      scaling?: { min: number; max: number };
      architecture?: 'x86_64' | 'arm64';
    },
  ) => {
    const hostByPriority: Record<number, string> = {};
    for (const a of opts.apps) hostByPriority[a.priority] = domain(a.slug);

    return new sst.aws.Service(name, {
      cluster,
      link: opts.link,
      ...(opts.cpu ? { cpu: opts.cpu as any } : {}),
      ...(opts.memory ? { memory: opts.memory as any } : {}),
      ...(opts.scaling ? { scaling: opts.scaling } : {}),
      ...(opts.architecture ? { architecture: opts.architecture } : {}),
      loadBalancer: {
        instance: alb,
        rules: opts.apps.map((a) => ({
          listen: '443/https' as const,
          forward: `${a.port}/http` as const,
          conditions: { path: '/*' }, // 검증 통과용 placeholder — transform 이 hostHeader 로 덮어씀
          priority: a.priority,
        })),
        health: Object.fromEntries(
          opts.apps.map((a) => [
            `${a.port}/http`,
            {
              path: a.healthPath ?? '/health',
              interval: '30 seconds',
              timeout: '5 seconds',
              healthyThreshold: 2,
              unhealthyThreshold: 5,
            },
          ]),
        ) as Record<string, any>,
      },
      image: {
        context: dockerContext,
        dockerfile: opts.dockerfile,
      },
      environment: {
        // 공유 env (프리픽스 없음) — supervisor 가 모든 자식에 상속시킨다.
        NODE_ENV: 'production',
        ...(otelExporterOtlpEndpoint ? { OTEL_EXPORTER_OTLP_ENDPOINT: otelExporterOtlpEndpoint } : {}),
        // 앱별 env 는 호출부에서 `<PREFIX>__KEY` 로 병합해 넘긴다.
        ...opts.environment,
      },
      transform: {
        service: (args: Record<string, any>) => {
          args.networkConfiguration = vpc.privateSubnets.apply((subnets) =>
            vpc.securityGroups.apply((sgs) => ({
              assignPublicIp: false,
              subnets,
              securityGroups: sgs,
            })),
          );
        },
        listenerRule: (args: Record<string, any>) => {
          // args.priority 는 위 rules 에서 넘긴 리터럴 숫자. 매핑이 없으면 hostHeader 없이 '/*'
          // 로 남아 해당 포트가 모든 host 를 받아 라우팅이 오염되므로 조용히 넘기지 말고 크게 실패.
          const host = hostByPriority[args.priority];
          if (!host) throw new Error(`ServicesBundle: priority ${args.priority} 에 매핑된 hostname 이 없음`);
          args.conditions = [{ hostHeader: { values: [host] } }];
        },
      },
    });
  };

  return {
    isDev,
    vpc,
    cluster,
    db,
    dbUrl,
    baseDomain,
    domain,
    url,
    baseEnv,
    setOtelExporterOtlpEndpoint,
    serviceDiscoveryName,
    kafkaEnv,
    createService,
    createBundleService,
  };
}

export type SharedInfra = ReturnType<typeof setup>;
