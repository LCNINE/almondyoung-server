/// <reference path="../../../.sst/platform/config.d.ts" />
export default $config({
  app() {
    return {
      name: 'almondyoung-maintenance',
      home: 'aws',
      // state 버킷의 옛 버전 정리 — 이유와 동작은 services/sst.config.ts 의 같은 줄 주석.
      state: { retention: 30 },
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
