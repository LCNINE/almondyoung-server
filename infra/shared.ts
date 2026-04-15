/// <reference path="../.sst/platform/config.d.ts" />

export function setup() {
  const isDev = $app.stage !== "production";

  // ─── Networking ───
  const vpc = new sst.aws.Vpc("Vpc", {
    bastion: isDev,
  });
  const cluster = new sst.aws.Cluster("Cluster", { vpc });

  // ─── Domain helper ───
  const baseDomain = "lcnine-dev.com";
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
  const db = new sst.aws.Postgres("Db", {
    vpc,
    scaling: { min: "0.5 ACU", max: "2 ACU" },
  });

  const dbUrl = (dbName: string) =>
    $interpolate`postgresql://${db.username}:${db.password}@${db.host}:${db.port}/${dbName}?sslmode=require`;

  // ─── Redis (ElastiCache Serverless) ───
  const redis = new sst.aws.Redis("Redis", { vpc, cluster: false });
  const encodedRedisPassword = redis.password.apply((p) =>
    encodeURIComponent(p),
  );
  const redisUrl = (dbIndex: number) =>
    $interpolate`rediss://${redis.username}:${encodedRedisPassword}@${redis.host}:${redis.port}/${dbIndex}`;

  // ─── Shared secrets ───
  const kafkaApiKey = new sst.Secret("KafkaApiKey");
  const kafkaApiSecret = new sst.Secret("KafkaApiSecret");
  const authSecret = new sst.Secret("AuthSecret");
  const awsS3AccessKeyId = new sst.Secret("AwsS3AccessKeyId");
  const awsS3SecretAccessKey = new sst.Secret("AwsS3SecretAccessKey");

  // ─── User Service secrets ───
  const kakaoClientId = new sst.Secret("KakaoClientId");
  const kakaoClientSecret = new sst.Secret("KakaoClientSecret");
  const jwtRefreshSecret = new sst.Secret("JwtRefreshSecret");
  const jwtVerificationTokenSecret = new sst.Secret("JwtVerificationTokenSecret");
  const twilioAccountSid = new sst.Secret("TwilioAccountSid");
  const twilioAuthToken = new sst.Secret("TwilioAuthToken");
  const cafe24ClientId = new sst.Secret("Cafe24ClientId");
  const cafe24ClientSecret = new sst.Secret("Cafe24ClientSecret");
  const cafe24ServiceKey = new sst.Secret("Cafe24ServiceKey");

  // ─── Channel Adapter secrets ───
  const channelAdapterInternalKey = new sst.Secret("ChannelAdapterInternalKey");
  const medusaApiKey = new sst.Secret("MedusaApiKey");

  // ─── Notification secrets ───
  const nhnAppKey = new sst.Secret("NhnAppKey");
  const nhnSecretKey = new sst.Secret("NhnSecretKey");
  const nhnSenderKey = new sst.Secret("NhnSenderKey");
  const resendApiKey = new sst.Secret("ResendApiKey");
  const resendWebhookSecret = new sst.Secret("ResendWebhookSecret");

  // ─── Wallet secrets ───
  const tossClientKey = new sst.Secret("TossClientKey");
  const tossSecretKey = new sst.Secret("TossSecretKey");
  const nicepayClientKey = new sst.Secret("NicepayClientKey");
  const nicepaySecretKey = new sst.Secret("NicepaySecretKey");
  const walletApiKey = new sst.Secret("WalletApiKey");
  const custKey = new sst.Secret("CustKey");
  const swKey = new sst.Secret("SwKey");

  // ─── PIM secrets ───
  const elasticsearchPassword = new sst.Secret("ElasticsearchPassword");

  // ─── Medusa secrets ───
  const medusaJwtSecret = new sst.Secret("MedusaJwtSecret");
  const medusaCookieSecret = new sst.Secret("MedusaCookieSecret");

  // ─── Common env builders ───
  const kafkaEnv = (prefix: string, groupId: string) => ({
    KAFKA_BROKERS: "pkc-e82om.ap-northeast-2.aws.confluent.cloud:9092",
    KAFKA_API_KEY: kafkaApiKey.value,
    KAFKA_API_SECRET: kafkaApiSecret.value,
    KAFKA_CLIENT_ID_PREFIX: prefix,
    KAFKA_GROUP_ID: groupId,
  });

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
        context: ".",
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
    kafkaEnv,
    baseEnv,
    createService,
    secrets: {
      kafkaApiKey,
      kafkaApiSecret,
      authSecret,
      awsS3AccessKeyId,
      awsS3SecretAccessKey,
      kakaoClientId,
      kakaoClientSecret,
      jwtRefreshSecret,
      jwtVerificationTokenSecret,
      twilioAccountSid,
      twilioAuthToken,
      cafe24ClientId,
      cafe24ClientSecret,
      cafe24ServiceKey,
      channelAdapterInternalKey,
      medusaApiKey,
      nhnAppKey,
      nhnSecretKey,
      nhnSenderKey,
      resendApiKey,
      resendWebhookSecret,
      tossClientKey,
      tossSecretKey,
      nicepayClientKey,
      nicepaySecretKey,
      walletApiKey,
      custKey,
      swKey,
      elasticsearchPassword,
      medusaJwtSecret,
      medusaCookieSecret,
    },
  };
}

export type SharedInfra = ReturnType<typeof setup>;
