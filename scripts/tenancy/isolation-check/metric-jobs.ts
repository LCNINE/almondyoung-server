import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SCRAPE_TARGETS } from '../../../libs/shared/src/observability/scrape-targets';
import { consumerTenancyOf } from '../../../libs/tenancy/src/guards/tenancy-wiring';
import type { MetricJob } from './prometheus';

const ROOT = resolve(__dirname, '../../..');

/**
 * 라이브 격리 실측이 메트릭을 읽을 앱. 손으로 적지 않는다 — 스크레이프 정본 표(`scrape-targets.ts`)의 Nest 앱 중에서,
 * 건너뜀을 세는 «소비 앱»은 그 앱 `main.ts` 가 `startConsumer` 에 선언한 `served-tenant` 로 정한다(로컬은 e2e 정본 표).
 * Medusa(`own`)는 @app/events 를 쓰지 않아 DLQ 카운터가 없다.
 */
export function metricJobs(): MetricJob[] {
  return SCRAPE_TARGETS.filter((t) => t.metricsServer === 'shared').map((t) => {
    const path = join('apps', t.appDir, 'src', 'main.ts');
    const full = join(ROOT, path);
    const content = existsSync(full) ? readFileSync(full, 'utf8') : '';
    return { job: t.job, app: t.appDir, consumer: consumerTenancyOf({ path, content }) === 'served-tenant' };
  });
}
