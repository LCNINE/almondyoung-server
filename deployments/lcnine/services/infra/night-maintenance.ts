/// <reference path="../../../../.sst/platform/config.d.ts" />
import type { Input } from '@pulumi/pulumi';
import type { SharedInfra } from './shared';
import settings from './night-maintenance-settings.json';

export function setupNightMaintenance(
  infra: SharedInfra,
  userServiceUrl: Input<string>,
  monitoredServices: Input<string>[],
) {
  const parent = new sst.Linkable('NightMaintenance', { properties: { purpose: 'approved-dated-maintenance' } });
  const options = { parent };
  const bucket = new sst.aws.Bucket('NightMaintenanceArtifacts', { versioning: true }, options);
  const adminSecret = new aws.secretsmanager.Secret(
    'NightMaintenanceAdminCredentials',
    {
      description: 'Approved maintenance administrator login JSON; value populated outside source control.',
    },
    options,
  );
  if (!infra.db.nodes.instance) throw new Error('Night maintenance requires the managed live database');
  const dbSecretArn = infra.db.nodes.instance.tags.apply((tags) => {
    const arn = tags?.['sst:lookup:password'];
    if (!arn) throw new Error('RDS credential secret reference is unavailable');
    return arn;
  });
  const region = aws.getRegionOutput().name;
  const task = new sst.aws.Task(
    'NightMaintenanceRunner',
    {
      cluster: infra.cluster,
      architecture: 'arm64',
      cpu: '0.25 vCPU',
      memory: '0.5 GB',
      dev: false,
      image: { context: '../../../scripts/night-maintenance', dockerfile: 'Dockerfile' },
      environment: {
        AWS_REGION: region,
        ARTIFACT_BUCKET: bucket.name,
        ADMIN_SECRET_ARN: adminSecret.arn,
        DB_SECRET_ARN: dbSecretArn,
        DB_HOST: infra.db.host,
        DB_PORT: infra.db.port.apply(String),
        DB_CA_FILE: '/app/rds-ca.pem',
        CLUSTER_NAME: infra.cluster.nodes.cluster.name,
        MONITORED_SERVICES: $util.all(monitoredServices).apply((names) => JSON.stringify(names)),
        CORE_URL: infra.url('core'),
        UGC_URL: infra.url('ugc'),
        USER_SERVICE_URL: userServiceUrl,
        DRY_RUN: 'true',
        RUN_DATE: settings.runDate,
        OPERATION_ID: settings.operationId,
      },
      permissions: [
        { actions: ['secretsmanager:GetSecretValue'], resources: [adminSecret.arn, dbSecretArn] },
        { actions: ['s3:ListBucket'], resources: [bucket.arn] },
        { actions: ['s3:GetObject'], resources: [bucket.arn.apply((arn) => `${arn}/*`)] },
        { actions: ['s3:PutObject'], resources: [bucket.arn.apply((arn) => `${arn}/runs/*`)] },
        { actions: ['cloudwatch:GetMetricData'], resources: ['*'] },
      ],
    },
    options,
  );
  const group = new aws.scheduler.ScheduleGroup('NightMaintenanceScheduleGroup', {}, options);
  const account = aws.getCallerIdentityOutput().accountId;
  const schedulerRole = new aws.iam.Role(
    'NightMaintenanceSchedulerRole',
    {
      assumeRolePolicy: aws.iam.getPolicyDocumentOutput({
        statements: [
          {
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'Service', identifiers: ['scheduler.amazonaws.com'] }],
            conditions: [
              { test: 'StringEquals', variable: 'aws:SourceAccount', values: [account] },
              { test: 'ArnEquals', variable: 'aws:SourceArn', values: [group.arn] },
            ],
          },
        ],
      }).json,
    },
    options,
  );
  const deadLetters = new aws.sqs.Queue(
    'NightMaintenanceDeadLetters',
    {
      sqsManagedSseEnabled: true,
      messageRetentionSeconds: 1209600,
    },
    options,
  );
  const schedulerPolicy = new aws.iam.RolePolicy(
    'NightMaintenanceSchedulerPolicy',
    {
      role: schedulerRole.id,
      policy: aws.iam.getPolicyDocumentOutput({
        statements: [
          {
            actions: ['ecs:RunTask'],
            resources: [task.nodes.taskDefinition.arn],
            conditions: [{ test: 'ArnEquals', variable: 'ecs:cluster', values: [infra.cluster.nodes.cluster.arn] }],
          },
          {
            actions: ['iam:PassRole'],
            resources: [task.nodes.taskRole.arn, task.nodes.executionRole.arn],
            conditions: [
              { test: 'StringEquals', variable: 'iam:PassedToService', values: ['ecs-tasks.amazonaws.com'] },
            ],
          },
          { actions: ['sqs:SendMessage'], resources: [deadLetters.arn] },
        ],
      }).json,
    },
    options,
  );

  const schedules = (['reviews', 'products'] as const).map((kind) => {
    const hour = kind === 'reviews' ? '02' : '03';
    return new aws.scheduler.Schedule(
      `NightMaintenance${kind === 'reviews' ? 'Reviews' : 'Products'}`,
      {
        groupName: group.name,
        scheduleExpression: `at(${settings.runDate}T${hour}:00:00)`,
        scheduleExpressionTimezone: 'Asia/Seoul',
        flexibleTimeWindow: { mode: 'OFF' },
        state: settings.enabled ? 'ENABLED' : 'DISABLED',
        actionAfterCompletion: 'NONE',
        target: {
          arn: infra.cluster.nodes.cluster.arn,
          roleArn: schedulerRole.arn,
          deadLetterConfig: { arn: deadLetters.arn },
          retryPolicy: { maximumEventAgeInSeconds: 60, maximumRetryAttempts: 0 },
          ecsParameters: {
            taskDefinitionArn: task.nodes.taskDefinition.arn,
            taskCount: 1,
            launchType: 'FARGATE',
            networkConfiguration: {
              subnets: infra.vpc.privateSubnets,
              securityGroups: infra.vpc.securityGroups,
              assignPublicIp: false,
            },
          },
          input: task.nodes.taskDefinition.containerDefinitions.apply((value) =>
            JSON.stringify({
              containerOverrides: [
                {
                  name: JSON.parse(value)[0].name,
                  environment: [
                    { name: 'JOB_KIND', value: kind },
                    { name: 'DRY_RUN', value: 'false' },
                    { name: 'INPUT_KEY', value: settings[kind].key },
                    { name: 'INPUT_SHA256', value: settings[kind].sha256 },
                  ],
                },
              ],
            }),
          ),
        },
      },
      { ...options, dependsOn: [schedulerPolicy] },
    );
  });

  const alerts = new aws.sns.Topic('NightMaintenanceAlerts', {}, options);
  const taskStopped = new aws.cloudwatch.EventRule(
    'NightMaintenanceTaskStopped',
    {
      eventPattern: $util
        .all([infra.cluster.nodes.cluster.arn, task.nodes.taskDefinition.family])
        .apply(([arn, family]) =>
          JSON.stringify({
            source: ['aws.ecs'],
            'detail-type': ['ECS Task State Change'],
            detail: {
              clusterArn: [arn],
              lastStatus: ['STOPPED'],
              group: [`family:${family}`],
            },
          }),
        ),
    },
    options,
  );
  const alertPolicy = new aws.sns.TopicPolicy(
    'NightMaintenanceAlertsPolicy',
    {
      arn: alerts.arn,
      policy: aws.iam.getPolicyDocumentOutput({
        statements: [
          {
            actions: ['SNS:Publish'],
            resources: [alerts.arn],
            principals: [{ type: 'Service', identifiers: ['events.amazonaws.com'] }],
            conditions: [{ test: 'ArnEquals', variable: 'aws:SourceArn', values: [taskStopped.arn] }],
          },
          {
            actions: ['SNS:Publish'],
            resources: [alerts.arn],
            principals: [{ type: 'Service', identifiers: ['cloudwatch.amazonaws.com'] }],
            conditions: [{ test: 'StringEquals', variable: 'aws:SourceAccount', values: [account] }],
          },
        ],
      }).json,
    },
    options,
  );
  new aws.cloudwatch.EventTarget(
    'NightMaintenanceTaskStoppedAlert',
    {
      rule: taskStopped.name,
      arn: alerts.arn,
    },
    { ...options, dependsOn: [alertPolicy] },
  );
  new aws.cloudwatch.MetricAlarm(
    'NightMaintenanceLaunchFailure',
    {
      namespace: 'AWS/Scheduler',
      metricName: 'TargetErrorCount',
      statistic: 'Sum',
      period: 60,
      evaluationPeriods: 1,
      threshold: 0,
      comparisonOperator: 'GreaterThanThreshold',
      treatMissingData: 'notBreaching',
      dimensions: { ScheduleGroup: group.name },
      alarmActions: [alerts.arn],
    },
    options,
  );

  return {
    nightMaintenanceBucket: bucket.name,
    nightMaintenanceAdminSecretArn: adminSecret.arn,
    nightMaintenanceTaskDefinitionArn: task.nodes.taskDefinition.arn,
    nightMaintenanceClusterArn: infra.cluster.nodes.cluster.arn,
    nightMaintenanceScheduleGroup: group.name,
    nightMaintenanceReviewSchedule: schedules[0].name,
    nightMaintenanceProductSchedule: schedules[1].name,
    nightMaintenanceAlertsTopicArn: alerts.arn,
  };
}
