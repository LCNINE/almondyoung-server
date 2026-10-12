import { Counter, Gauge, register } from 'prom-client';
import type { PermissionCacheStatus } from './permission-cache';

/**
 * 그림자 판정 지표 — 모듈 스코프 싱글턴(인스턴스 필드면 prom-client 전역 register 중복 등록 예외).
 * 라벨에 라우트를 넣지 않는다 — 라우트는 로그에 남기고, 지표는 «얼마나 맞았나»의 분모·분자만.
 */
export const shadowEvaluationsTotal = new Counter({
  name: 'authz_shadow_evaluations_total',
  help: 'Permission decisions computed next to the current guards, by how they compared',
  labelNames: ['service', 'outcome'],
  registers: [register],
});

let statusSource: { service: string; read: () => PermissionCacheStatus } | null = null;

/** 스크레이프 순간의 사본 나이. 사본이 없으면 시리즈를 비워 둔다(0 으로 뭉개지 않는다). */
export function reportSnapshotStatus(service: string, read: () => PermissionCacheStatus): void {
  statusSource = { service, read };
}

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
