import { consumerMetricsFromVectors, prometheusQueryUrl, sumSamples } from './prometheus';

const TEXT = `# HELP events_skipped_other_tenant_total Tenant events skipped
# TYPE events_skipped_other_tenant_total counter
events_skipped_other_tenant_total{topic="products.events.v1"} 3
events_skipped_other_tenant_total{topic="inventory.events.v1"} 1
events_skipped_other_tenant_total_created{topic="products.events.v1"} 1700000000
events_dlq_messages_total{topic="a",consumer="b",error="x"} 2
events_dlq_messages_total_created{topic="a",consumer="b",error="x"} 1700000000
events_outbox_published_total{topic="a"} 5 1700000000000
`;

describe('sumSamples', () => {
  it('라벨이 달라도 같은 이름의 샘플을 다 더한다', () => {
    expect(sumSamples(TEXT, 'events_skipped_other_tenant_total')).toBe(4);
  });

  it('이름이 접두사로만 같은 다른 계열(_created)은 더하지 않는다', () => {
    expect(sumSamples(TEXT, 'events_dlq_messages_total')).toBe(2);
  });

  it('값 뒤의 타임스탬프를 값으로 읽지 않는다', () => {
    expect(sumSamples(TEXT, 'events_outbox_published_total')).toBe(5);
  });

  it('한 번도 오르지 않은 카운터(샘플 없음)는 0 이다', () => {
    expect(sumSamples(TEXT, 'events_dlq_send_failures_total')).toBe(0);
  });
});

/** Prometheus HTTP API 의 instant query 응답(`/api/v1/query`) — job 별 한 줄. */
const vector = (rows: Record<string, number>) => ({
  status: 'success',
  data: {
    resultType: 'vector',
    result: Object.entries(rows).map(([job, v]) => ({ metric: { job }, value: [1762070400.123, String(v)] })),
  },
});

describe('consumerMetricsFromVectors', () => {
  const jobs = [
    { job: 'channel-adapter', app: 'channel-adapter', consumer: true },
    { job: 'ugc', app: 'ugc-service', consumer: true },
    { job: 'core', app: 'core', consumer: false },
  ];

  it('job 을 앱 이름으로 옮기고, 소비 앱만 건너뜀을 센다', () => {
    const m = consumerMetricsFromVectors(jobs, {
      lastScrape: vector({ 'channel-adapter': 1762070400, ugc: 1762070410, core: 1762070420 }),
      skipped: vector({ 'channel-adapter': 3, ugc: 1, core: 9 }),
      deadLettered: vector({ core: 2 }),
    });
    expect(m.skippedOtherTenant).toEqual({ 'channel-adapter': 3, 'ugc-service': 1 });
    expect(m.scrapedAt).toEqual({
      'channel-adapter': 1762070400_000,
      'ugc-service': 1762070410_000,
      core: 1762070420_000,
    });
    expect(m.unreachable).toEqual([]);
  });

  it('수집은 됐는데 카운터 시리즈가 없으면 0 이다(한 번도 안 오른 카운터)', () => {
    const m = consumerMetricsFromVectors(jobs, {
      lastScrape: vector({ 'channel-adapter': 1762070400, ugc: 1762070400, core: 1762070400 }),
      skipped: vector({}),
      deadLettered: vector({ core: 2 }),
    });
    expect(m.skippedOtherTenant).toEqual({ 'channel-adapter': 0, 'ugc-service': 0 });
    expect(m.deadLettered).toEqual({ 'channel-adapter': 0, 'ugc-service': 0, core: 2 });
  });

  it('수집 기록이 없는 앱은 0 이 아니라 «못 읽음» — 값 키가 없다', () => {
    const m = consumerMetricsFromVectors(jobs, {
      lastScrape: vector({ core: 1762070400 }),
      skipped: vector({ ugc: 5 }),
      deadLettered: vector({}),
    });
    expect(m.unreachable).toEqual(['channel-adapter', 'ugc-service']);
    expect(m.skippedOtherTenant).toEqual({});
    expect(m.deadLettered).toEqual({ core: 0 });
    expect(Object.keys(m.scrapedAt)).toEqual(['core']);
  });

  it('조회가 실패한 응답이면 던진다(빈 결과로 읽어 «0» 이 되지 않게)', () => {
    expect(() =>
      consumerMetricsFromVectors(jobs, {
        lastScrape: { status: 'error', errorType: 'bad_data', error: 'parse error' },
        skipped: vector({}),
        deadLettered: vector({}),
      }),
    ).toThrow(/parse error/);
  });
});

describe('prometheusQueryUrl', () => {
  it('Grafana Cloud 의 remote write 주소에서 조회 주소를 만든다', () => {
    expect(prometheusQueryUrl('https://prometheus-prod-49-prod-ap-northeast-0.grafana.net/api/prom/push')).toBe(
      'https://prometheus-prod-49-prod-ap-northeast-0.grafana.net/api/prom/api/v1/query',
    );
  });

  it('push 로 끝나지 않으면 추측하지 않고 던진다', () => {
    expect(() => prometheusQueryUrl('https://example.com/api/v1/write')).toThrow(/push/);
  });
});

describe('consumerMetricsFromVectors — 소비 앱이 아닌 앱과 시각', () => {
  const jobs = [
    { job: 'core', app: 'core', consumer: false },
    { job: 'wallet', app: 'wallet', consumer: true },
  ];

  it('per-message 앱도 수집 기록이 없으면 «못 읽음» — DLQ 판정에서 조용히 빠지지 않게', () => {
    const m = consumerMetricsFromVectors(jobs, {
      lastScrape: vector({ wallet: 1762070400 }),
      skipped: vector({}),
      deadLettered: vector({}),
    });
    expect(m.unreachable).toEqual(['core']);
  });

  it('DLQ 시리즈가 따로 늦게 들어왔으면 그 시각을 수집 시각으로 본다(더 옛것을 믿는다)', () => {
    const m = consumerMetricsFromVectors(jobs, {
      lastScrape: vector({ core: 1762070500, wallet: 1762070500 }),
      skipped: vector({}),
      deadLettered: vector({ core: 2 }),
      deadLetteredAt: vector({ core: 1762070400 }),
    });
    expect(m.scrapedAt).toEqual({ core: 1762070400_000, wallet: 1762070500_000 });
  });
});
