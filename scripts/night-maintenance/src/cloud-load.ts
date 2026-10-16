import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';

export class CloudLoadProbe {
  private readonly client: CloudWatchClient;
  private cached?: { at: number; cpu: number };

  constructor(
    region: string,
    private readonly cluster: string,
    private readonly services: string[],
  ) {
    this.client = new CloudWatchClient({ region, maxAttempts: 2 });
  }

  async cpu(): Promise<number> {
    if (this.cached && Date.now() - this.cached.at < 60000) return this.cached.cpu;
    const names = new Set(this.services);
    if (!names.size) throw new Error('No live services configured for CPU checks');
    const result = await this.client.send(
      new GetMetricDataCommand({
        StartTime: new Date(Date.now() - 180000),
        EndTime: new Date(),
        MetricDataQueries: [...names].map((name, index) => ({
          Id: `service${index}`,
          MetricStat: {
            Metric: {
              Namespace: 'AWS/ECS',
              MetricName: 'CPUUtilization',
              Dimensions: [
                { Name: 'ClusterName', Value: this.cluster },
                { Name: 'ServiceName', Value: name },
              ],
            },
            Period: 60,
            Stat: 'Average',
          },
        })),
      }),
      { abortSignal: AbortSignal.timeout(20000) },
    );
    const results = result.MetricDataResults ?? [];
    if (results.length !== names.size || results.some((row) => !row.Values?.length)) {
      throw new Error('Incomplete live service CPU measurements');
    }
    const cpu = Math.max(...results.flatMap((row) => row.Values ?? []));
    this.cached = { at: Date.now(), cpu };

    return cpu;
  }
}
