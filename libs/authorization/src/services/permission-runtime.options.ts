import type { OwnerService } from '../permissions/permission.types';

export const PERMISSION_RUNTIME_OPTIONS = Symbol('PERMISSION_RUNTIME_OPTIONS');

/** 버전 확인 주기. 매핑 변경이 다른 서비스에 반영되는 최대 지연이다. */
export const DEFAULT_REFRESH_INTERVAL_MS = 30_000;
/** 사본이 없을 때 첫 재시도 간격. 1s·2s·4s… 로 늘어 주기 값에서 멈춘다. */
export const DEFAULT_RETRY_BASE_MS = 1_000;
/** 판정 요약 로그 간격. */
export const DEFAULT_SUMMARY_INTERVAL_MS = 300_000;

export interface PermissionRuntimeOptions {
  readonly service: OwnerService;
  readonly refreshIntervalMs: number;
  readonly retryBaseMs: number;
  readonly summaryIntervalMs: number;
}
