/** `@CronOnce` 가 메서드에 남기는 메타데이터 키. */
export const CRON_ONCE_METADATA = 'cron-once:metadata';

/**
 * 선택 provider 토큰. 값이 있으면 `cron_runs.claimed_by` 에 쓰고, 없으면 `os.hostname()`.
 * 통합 스펙이 앱 컨텍스트 둘을 구별하려고 쓴다. 프로덕션 앱은 등록하지 않는다.
 */
export const CRON_ONCE_INSTANCE_ID = 'CRON_ONCE_INSTANCE_ID';

/** 선점 기록 보존 기간(일). 같은 이름의 이보다 오래된 행은 선점 문장이 함께 지운다. */
export const CRON_RUNS_RETENTION_DAYS = 7;

export interface CronOnceOptions {
  /** 선점 키이자 SchedulerRegistry 등록 이름. 앱 안에서 유일해야 한다. */
  name: string;
  /** `@Cron` 의 timeZone 과 같은 의미. 발화와 주기 키 도출 양쪽에 쓴다. */
  timeZone?: string;
}

export interface CronOnceMetadata extends CronOnceOptions {
  expression: string;
}
