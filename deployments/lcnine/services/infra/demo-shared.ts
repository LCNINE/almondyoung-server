/// <reference path="../../../../.sst/platform/config.d.ts" />

import { getLcnineStageProfile } from '../../stage-profile';

/** Shared infrastructure for the deliberately small demo service graph. */
export function setup() {
  const profile = getLcnineStageProfile($app.stage);
  if (!profile.isDemo) throw new Error('demo shared infrastructure may only be created for stage demo');

  const dockerContext = '../../../';
  const platformVpcId = aws.ssm.getParameterOutput({
    name: '/lcnine-platform/demo/vpc-id',
  }).value;
  const kafkaBrokers = aws.ssm.getParameterOutput({
    name: '/lcnine-platform/demo/kafka-brokers',
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

  const { baseDomain, domain, url } = profile;
  const alb = new sst.aws.Alb('SharedAlb', {
    vpc,
    domain: { name: `*.${baseDomain}`, dns: sst.aws.dns({ override: true }) },
    listeners: [
      { port: 80, protocol: 'http' },
      { port: 443, protocol: 'https' },
    ],
  });

  const db = new sst.aws.Postgres('Db', {
    vpc,
    instance: 't4g.small',
  });
  const dbUrl = (dbName: string) =>
    $interpolate`postgresql://${db.username}:${db.password}@${db.host}:${db.port}/${dbName}?sslmode=require`;

  const baseEnv = (serviceName: string) => ({
    NODE_ENV: 'production',
    OTEL_SERVICE_NAME: serviceName,
    ...profile.environment,
  });
  const kafkaEnv = (prefix: string, groupId: string) => ({
    KAFKA_BROKERS: kafkaBrokers,
    KAFKA_CLIENT_ID_PREFIX: prefix,
    KAFKA_GROUP_ID: groupId,
  });

  const privateNetwork = (args: Record<string, any>) => {
    args.networkConfiguration = vpc.privateSubnets.apply((subnets) =>
      vpc.securityGroups.apply((securityGroups) => ({
        assignPublicIp: false,
        subnets,
        securityGroups,
      })),
    );
  };

  const createService = (
    name: string,
    opts: {
      dockerfile: string;
      domainSlug: string;
      port: number;
      priority: number;
      environment: Record<string, $util.Output<string> | string>;
      link?: sst.Linkable<any>[];
      permissions?: { actions: string[]; resources: ($util.Output<string> | string)[] }[];
      loadBalancerHealth?: Record<string, any>;
      architecture?: 'x86_64' | 'arm64';
    },
  ) =>
    new sst.aws.Service(name, {
      cluster,
      link: opts.link,
      permissions: opts.permissions,
      ...(opts.architecture ? { architecture: opts.architecture } : {}),
      loadBalancer: {
        instance: alb,
        rules: [
          {
            listen: '443/https',
            forward: `${opts.port}/http` as const,
            conditions: { path: '/*' },
            priority: opts.priority,
          },
        ],
        health: opts.loadBalancerHealth,
      },
      image: { context: dockerContext, dockerfile: opts.dockerfile },
      environment: {
        ...baseEnv(opts.domainSlug),
        PORT: String(opts.port),
        ...opts.environment,
      },
      transform: {
        service: privateNetwork,
        listenerRule: (args: Record<string, any>) => {
          args.conditions = [{ hostHeader: { values: [domain(opts.domainSlug)] } }];
        },
      },
    });

  const createBundleService = (
    name: string,
    opts: {
      apps: { slug: string; port: number; priority: number; healthPath?: string }[];
      environment: Record<string, $util.Output<string> | string>;
      link?: sst.Linkable<any>[];
    },
  ) => {
    const hostByPriority = Object.fromEntries(opts.apps.map((app) => [app.priority, domain(app.slug)]));
    return new sst.aws.Service(name, {
      cluster,
      architecture: 'arm64',
      cpu: '0.25 vCPU',
      memory: '1 GB',
      scaling: { min: 1, max: 1 },
      link: opts.link,
      loadBalancer: {
        instance: alb,
        rules: opts.apps.map((app) => ({
          listen: '443/https' as const,
          forward: `${app.port}/http` as const,
          conditions: { path: '/*' },
          priority: app.priority,
        })),
        health: Object.fromEntries(
          opts.apps.map((app) => [
            `${app.port}/http`,
            {
              path: app.healthPath ?? '/health',
              interval: '30 seconds',
              timeout: '5 seconds',
              healthyThreshold: 2,
              unhealthyThreshold: 5,
            },
          ]),
        ),
      },
      image: {
        context: dockerContext,
        dockerfile: 'deployments/lcnine/services/bundle/Dockerfile.demo',
      },
      environment: {
        NODE_ENV: 'production',
        ...opts.environment,
      },
      transform: {
        service: privateNetwork,
        listenerRule: (args: Record<string, any>) => {
          const host = hostByPriority[args.priority];
          if (!host) throw new Error(`DemoServicesBundle: no hostname for priority ${args.priority}`);
          args.conditions = [{ hostHeader: { values: [host] } }];
        },
      },
    });
  };

  return {
    profile,
    vpc,
    cluster,
    db,
    dbUrl,
    baseDomain,
    domain,
    url,
    kafkaEnv,
    createService,
    createBundleService,
  };
}

export type DemoSharedInfra = ReturnType<typeof setup>;
