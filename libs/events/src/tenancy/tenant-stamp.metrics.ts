import { Counter, register } from 'prom-client';

/**
 * 테넌트 없이 나간 메시지 수 — 계기 정의가 사는 유일한 파일이다(`outbox.metrics.ts` 와 같은 파사드).
 * 배포 ① 에서 이 값이 0 이어야 ② 로 넘어간다. 라벨 `path` 는 `direct`·`outbox` 둘뿐이다.
 */
const unstampedTotal = new Counter({
  name: 'events_published_without_tenant_total',
  help: 'Messages published without envelope metadata.tenantId (warn mode only; reject mode throws)',
  labelNames: ['path'],
  registers: [register],
});

export function recordPublishedWithoutTenant(path: 'direct' | 'outbox'): void {
  unstampedTotal.inc({ path });
}
