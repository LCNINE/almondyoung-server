import {
  LONG_OUTBOX_MAX_RETRIES,
  LONG_OUTBOX_RETRY_DELAYS_SECONDS,
  OUTBOX_RETRY_DELAYS_SECONDS,
  OutboxDispatcher,
  nextAttemptDelaySeconds,
} from './outbox-dispatcher.service';

describe('outbox 재시도 간격 (#1016 7번)', () => {
  it('retryCount 는 실패 후 값이라 1회차 실패가 첫 간격을 쓴다', () => {
    expect(nextAttemptDelaySeconds(1, [10, 30])).toBe(10);
    expect(nextAttemptDelaySeconds(2, [10, 30])).toBe(30);
  });

  it('간격표를 넘으면 마지막 값을 유지한다', () => {
    expect(nextAttemptDelaySeconds(9, [10, 30])).toBe(30);
  });

  it('긴 간격표의 합은 굳기 전 약 2시간이다 — maxRetries 8 이면 7번 기다린다', () => {
    const waits = Array.from({ length: LONG_OUTBOX_MAX_RETRIES - 1 }, (_, i) =>
      nextAttemptDelaySeconds(i + 1, LONG_OUTBOX_RETRY_DELAYS_SECONDS),
    );
    expect(waits).toEqual([10, 30, 60, 300, 900, 1800, 3600]);
    expect(waits.reduce((a, b) => a + b, 0)).toBe(6700);
  });

  it('기본 간격표는 지금 값 그대로다 — 켜지 않은 앱의 동작이 바뀌지 않는다', () => {
    expect(OUTBOX_RETRY_DELAYS_SECONDS).toEqual([10, 30, 60, 300]);
  });

  it('빈 간격표는 생성에서 거부한다 — 0초 재시도 폭주를 막는다', () => {
    expect(() => new OutboxDispatcher({ db: {} } as never, new Map(), { retryDelaysSeconds: [] })).toThrow(
      /retryDelaysSeconds/,
    );
  });
});
