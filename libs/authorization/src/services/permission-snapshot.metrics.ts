import { Gauge, register } from 'prom-client';
import type { PermissionCacheStatus } from './permission-cache';

let statusSource: { service: string; read: () => PermissionCacheStatus } | null = null;

/** 스크레이프 순간의 사본 나이를 읽을 곳을 정한다. 사본이 없으면 시리즈를 비워 둔다(0 으로 뭉개지 않는다). */
export function reportSnapshotStatus(service: string, read: () => PermissionCacheStatus): void {
  statusSource = { service, read };
}

/**
 * 권한 사본 나이. 갱신이 실패해도 마지막 사본으로 판정을 이어 가므로, 이 값이 늘어나는 것이 원본(user-service) 장애의 신호다.
 * 모듈 스코프 싱글턴(전역 register).
 */
new Gauge({
  name: 'authz_permission_snapshot_age_seconds',
  help: 'Seconds since this process last confirmed its role-permission copy with the source',
  labelNames: ['service'],
  registers: [register],
  collect() {
    this.reset();
    if (!statusSource) return;
    const { ageMs } = statusSource.read();
    if (ageMs !== null) this.set({ service: statusSource.service }, ageMs / 1_000);
  },
});
