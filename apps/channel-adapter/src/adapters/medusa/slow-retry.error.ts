/**
 * 일반 장애가 아니라 "선행 조건이 아직 안 갖춰진" 실패 — 대표적으로 Medusa 고객 레코드가
 * 첫 스토어프론트 로그인 전이라 아직 없는 경우. 몇 초 백오프로는 조건이 갖춰질 수 없으므로,
 * inbox 워커가 이 타입을 보면 기본(수 회·약 1분) 대신 장기 스케줄로 재시도한다.
 */
export class SlowRetryInboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlowRetryInboxError';
  }
}
