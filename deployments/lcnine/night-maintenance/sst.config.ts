/// <reference path="../../../.sst/platform/config.d.ts" />
export default $config({
  app() {
    return {
      name: 'almondyoung-maintenance',
      home: 'aws',
      removal: 'retain',
      protect: true,
      providers: { aws: { region: 'ap-northeast-2' } },
    };
  },
  async run() {
    if ($app.stage !== 'live') throw new Error('Approved maintenance only supports the live stage');
    const { setupNightMaintenance } = await import('./night-maintenance');
    const resources = (await import('./live-resources.json')).default;
    const cluster = sst.aws.Cluster.get('LiveCluster', {
      id: resources.clusterArn,
      vpc: {
        id: resources.vpcId,
        securityGroups: resources.securityGroups,
        containerSubnets: resources.privateSubnets,
        loadBalancerSubnets: resources.privateSubnets,
      },
    });
    return setupNightMaintenance({ ...resources, cluster });
  },
});
