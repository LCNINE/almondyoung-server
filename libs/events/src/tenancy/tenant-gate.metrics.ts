import { Counter, register } from 'prom-client';

/**
 * 소비 문의 계기 — 정의가 사는 유일한 파일이다(`tenant-stamp.metrics.ts` 와 같은 파사드).
 * 라벨은 `topic`·`reason` 뿐이다. 테넌트 라벨은 두지 않는다(목록이 메트릭 이름 공간으로 퍼진다).
 * 셈은 핸들러 단위다 — 한 토픽에 같은 종류를 받는 핸들러가 둘이면 한 메시지가 둘로 센다.
 */
const skippedTotal = new Counter({
  name: 'events_skipped_other_tenant_total',
  help: 'Tenant events skipped before the handler because they belong to a tenant this app does not serve',
  labelNames: ['topic'],
  registers: [register],
});

/** ① warn 에서만 오른다 — ② reject 에선 같은 메시지가 DLQ 로 간다. ② 전에 0 이어야 한다. */
const unknownTenantTotal = new Counter({
  name: 'events_consumed_without_known_tenant_total',
  help: 'Tenant events handled without a known tenant (warn mode only; reject mode dead-letters them)',
  labelNames: ['topic', 'reason'],
  registers: [register],
});

export function recordSkippedOtherTenant(topic: string): void {
  skippedTotal.inc({ topic });
}

export function recordConsumedWithoutKnownTenant(topic: string, reason: 'missing' | 'unlisted'): void {
  unknownTenantTotal.inc({ topic, reason });
}
