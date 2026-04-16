/// <reference path="../.sst/platform/config.d.ts" />

export function setup(opts?: { baseDomain?: string; context?: string }) {
  const isDev = $app.stage !== "production";
  const dockerContext = opts?.context ?? ".";

  // ─── Networking ───
  const vpc = new sst.aws.Vpc("Vpc", {
    bastion: isDev,
  });
  const cluster = new sst.aws.Cluster("Cluster", { vpc });

  // ─── Domain helper ───
  const baseDomain = opts?.baseDomain ?? "lcnine-dev.com";
  const domain = (slug: string) =>
    isDev ? `${slug}.dev.${baseDomain}` : `${slug}.${baseDomain}`;
  const url = (slug: string) => `https://${domain(slug)}`;

  // ─── Shared ALB ───
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
  const encodedRedisPassword = redis.password.apply((p) =>
    encodeURIComponent(p),
  );
  const redisUrl = (dbIndex: number) =>
    $interpolate`rediss://${redis.username}:${encodedRedisPassword}@${redis.host}:${redis.port}/${dbIndex}`;

  // ─── Common env builders ───
  const baseEnv = (serviceName: string) => ({
    NODE_ENV: "production",
    OTEL_SERVICE_NAME: serviceName,
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
      link?: sst.Linkable[];
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
    createService,
  };
}

export type SharedInfra = ReturnType<typeof setup>;
