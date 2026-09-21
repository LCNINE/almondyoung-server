export const WAYBILL = {
  CUST_ORD_NO_PREFIX: 'AY',
  PENDING_ATTEMPTS_CAP: 5, // pending unknown_outcome 지속 시 자동 abandon 임계(§8). allocated 는 무제한.
  // 일시적 거절(ERROR-05/06) 전용 임계. PENDING_ATTEMPTS_CAP 과 «별도 카운터»를 쓴다 — 섞으면
  // 「시간이 지나면 풀리는 사유」가 「결과를 모르는 사유」의 자동 abandon 을 앞당긴다.
  // 초과하면 사유를 명시해 failed 로 종료한다. 탈출구 없는 무한 pending 은 만들지 않는다(#914).
  TRANSIENT_ATTEMPTS_CAP: 3,
  // 게이트웨이가 retryAfter 힌트를 주지 않은 일시적 거절의 기본 백오프.
  TRANSIENT_DEFAULT_BACKOFF_MS: 60 * 60 * 1000,
  BATCH_CONCURRENCY: 8, // issueBatch bounded 병렬(§10).
  BATCH_TIME_BUDGET_MS: 45_000, // 동기 배치 시간예산(< ALB 60s). 초과 시 미완건 조기반환(§10).
  ERROR: {
    NOT_FOUND: 'WAYBILL_NOT_FOUND',
    SHIPMENT_NOT_FOUND: 'WAYBILL_SHIPMENT_NOT_FOUND',
    ACTIVE_EXISTS: 'WAYBILL_ACTIVE_EXISTS',
    RECIPIENT_INCOMPLETE: 'WAYBILL_RECIPIENT_INCOMPLETE',
    STALE_MANIFEST_VERSION: 'WAYBILL_STALE_MANIFEST_VERSION',
    NOT_DISPATCHABLE: 'WAYBILL_NOT_DISPATCHABLE',
    STALE: 'WAYBILL_STALE',
    ALREADY_DISPATCHED: 'WAYBILL_ALREADY_DISPATCHED',
    NOT_VOIDABLE: 'WAYBILL_NOT_VOIDABLE',
    TRACKING_EXISTS: 'WAYBILL_TRACKING_EXISTS',
    CARRIER_NOT_CONFIGURED: 'WAYBILL_CARRIER_NOT_CONFIGURED',
    ABANDON_NOT_ALLOWED: 'WAYBILL_ABANDON_NOT_ALLOWED',
    TRANSIENT_CAP_EXCEEDED: 'WAYBILL_TRANSIENT_CAP_EXCEEDED',
  },
} as const;

// 종료(슬롯 해제) 상태. 활성 유니크 WHERE 와 동치.
export const WAYBILL_TERMINAL_STATUSES = ['voided', 'failed', 'abandoned'] as const;
// 디스패치 가능 상태.
export const WAYBILL_DISPATCHABLE_STATUSES = ['registered', 'used'] as const;
