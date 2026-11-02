import { z } from 'zod';
import type { ConsumerMetrics } from './target';

/**
 * Prometheus 텍스트 형식에서 이름이 정확히 `name` 인 샘플 값을 라벨과 무관하게 더한다. 샘플이 없으면 0.
 * 줄 모양: `name{labels} value [timestamp]` — 값은 이름·라벨 바로 뒤의 칸이다.
 */
export function sumSamples(text: string, name: string): number {
  let total = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith(name)) continue;
    let rest = line.slice(name.length);
    if (rest.startsWith('{')) rest = rest.slice(rest.lastIndexOf('}') + 1);
    else if (!rest.startsWith(' ')) continue;
    const value = Number(rest.trim().split(/\s+/)[0]);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

/** 메트릭을 읽는 앱 하나 — Prometheus `job` 라벨과 앱 이름(`apps/<app>`)이 다를 수 있다(`ugc` ↔ `ugc-service`). */
export interface MetricJob {
  readonly job: string;
  readonly app: string;
  /** 테넌트 문이 남의 이벤트를 건너뛰는 소비 앱(`served-tenant`) — 건너뜀 수는 이 앱들만 센다 */
  readonly consumer: boolean;
}

const vectorSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('success'),
    data: z.object({
      result: z.array(z.object({ metric: z.record(z.string(), z.string()), value: z.tuple([z.number(), z.string()]) })),
    }),
  }),
  z.object({ status: z.literal('error'), error: z.string() }),
]);

/** instant query 응답을 job → 값으로. 조회 실패는 던진다 — 빈 결과로 읽으면 «못 읽음»이 «0» 이 된다. */
function byJob(body: unknown): Map<string, number> {
  const parsed = vectorSchema.parse(body);
  if (parsed.status === 'error') throw new Error(`Prometheus 조회 실패: ${parsed.error}`);
  const out = new Map<string, number>();
  for (const row of parsed.data.result) {
    const job = row.metric.job;
    if (job !== undefined) out.set(job, Number(row.value[1]));
  }
  return out;
}

/**
 * 원격 저장소(Grafana Cloud)에서 읽은 조회들을 `ConsumerMetrics` 로. 마지막 수집 시각이 없는 앱은 «못 읽음»이고 값 키가
 * 없다 — 수집은 됐는데 카운터 시리즈가 없으면(한 번도 안 오른 카운터는 시리즈를 안 낸다) 0 이다. 이 둘을 섞으면
 * 원격 쓰기가 늦어 아직 안 들어온 앱이 «0 = DLQ 없음»으로 초록이 된다.
 */
export function consumerMetricsFromVectors(
  jobs: readonly MetricJob[],
  bodies: {
    readonly lastScrape: unknown;
    readonly skipped: unknown;
    readonly deadLettered: unknown;
    /** DLQ 시리즈 자체의 샘플 시각 — 원격 쓰기는 한 수집의 시리즈를 여러 묶음으로 보내 `up` 보다 늦을 수 있다 */
    readonly deadLetteredAt?: unknown;
  },
): ConsumerMetrics {
  const lastScrape = byJob(bodies.lastScrape);
  const skipped = byJob(bodies.skipped);
  const dlq = byJob(bodies.deadLettered);
  const dlqAt = bodies.deadLetteredAt === undefined ? new Map<string, number>() : byJob(bodies.deadLetteredAt);
  const skippedOtherTenant: Record<string, number> = {};
  const deadLettered: Record<string, number> = {};
  const scrapedAt: Record<string, number> = {};
  const unreachable: string[] = [];
  for (const { job, app, consumer } of jobs) {
    const up = lastScrape.get(job);
    if (up === undefined) {
      // 소비 앱이 아니어도(core·user-service) — 빠지면 DLQ 판정이 그 앱을 조용히 건너뛴다
      unreachable.push(app);
      continue;
    }
    scrapedAt[app] = Math.round(Math.min(up, dlqAt.get(job) ?? up) * 1000);
    deadLettered[app] = dlq.get(job) ?? 0;
    if (consumer) skippedOtherTenant[app] = skipped.get(job) ?? 0;
  }
  return { skippedOtherTenant, deadLettered, scrapedAt, unreachable };
}

/** Grafana Cloud Prometheus 의 remote write 주소(`…/api/prom/push`)에서 instant query 주소(`…/api/prom/api/v1/query`)를. */
export function prometheusQueryUrl(remoteWriteUrl: string): string {
  const url = new URL(remoteWriteUrl);
  if (!url.pathname.endsWith('/push')) {
    throw new Error(`remote write 주소가 …/push 꼴이 아니다(${url.pathname}) — 조회 주소를 추측하지 않는다`);
  }
  url.pathname = `${url.pathname.slice(0, -'/push'.length)}/api/v1/query`;
  return url.toString();
}
