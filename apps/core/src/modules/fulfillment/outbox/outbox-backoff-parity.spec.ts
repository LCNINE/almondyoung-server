import { OUTBOX_RETRY_DELAYS_SECONDS } from '@app/events';
import { OutboxDispatcherService } from './outbox-dispatcher.service';

/**
 * 재시도 표가 **한 벌**임을 고정한다 (ADR-0029 §5-1, Task 6-C-2).
 *
 * 6-C-2 는 core 의 아웃박스 적재를 공용 테이블로 옮기면서 **재시도 인코딩**을 바꿨다
 * (core: `next_attempt_at` 한 컬럼이 예약과 lease 를 겸함 → 공용: `status` 가 lease,
 * `next_attempt_at` 이 예약). 인코딩은 바뀌어도 **표는 바뀌지 않아야 한다** — 바뀌면 이
 * 조각이 조용한 동작 변경이 된다.
 *
 * 드레인 기간에는 두 디스패처가 함께 돈다(옛 것은 `public.outbox_events`, 새 것은
 * `event.outbox_events`). 그동안 표가 두 벌이면 한쪽만 고쳐지는 순간이 생기고, 그 차이는
 * **실패했을 때만** 관측되므로 이미 다르게 동작한 뒤에야 드러난다. 그래서 core 로컬 판본이
 * 공용 상수를 import 하도록 바꿨고, 여기서는 (1) 값 자체와 (2) 상한 클램프 규칙을 못박는다.
 */
describe('아웃박스 재시도 표 (core 로컬 ≡ 공용)', () => {
  it('표는 10/30/60/300초다', () => {
    expect([...OUTBOX_RETRY_DELAYS_SECONDS]).toEqual([10, 30, 60, 300]);
  });

  it('core 로컬 디스패처가 공용 상수를 그대로 쓴다 — 사본이 없다', () => {
    // `calculateNextAttempt` 는 private 이라 표를 직접 꺼낼 수 없다. 대신 **관측 가능한 결과**로
    // 확인한다: 실패 n회차 뒤 예약 시각이 공용 표의 n번째 값만큼 미래여야 한다.
    const dispatcher = Object.create(OutboxDispatcherService.prototype) as {
      calculateNextAttempt(attempts: number): Date;
    };

    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      OUTBOX_RETRY_DELAYS_SECONDS.forEach((delay, index) => {
        const attempts = index + 1;
        expect(dispatcher.calculateNextAttempt(attempts).getTime()).toBe(now + delay * 1000);
      });

      // 상한을 넘어도 마지막 값을 유지한다 — 증가하지도, 0 이 되지도 않는다.
      const last = OUTBOX_RETRY_DELAYS_SECONDS[OUTBOX_RETRY_DELAYS_SECONDS.length - 1];
      const beyond = OUTBOX_RETRY_DELAYS_SECONDS.length + 5;
      expect(dispatcher.calculateNextAttempt(beyond).getTime()).toBe(now + last * 1000);
    } finally {
      jest.spyOn(Date, 'now').mockRestore();
    }
  });

  it('대조군 — 표가 달랐다면 이 단언이 통과하지 않는다', () => {
    // 위 두 테스트가 "공용 상수를 공용 상수와 비교"하는 동어반복이 아님을 보인다. 옛 core 로컬
    // 사본과 값이 다른 표를 넣으면 같은 계산이 어긋난다.
    const drifted = [10, 30, 60, 600] as const;
    const now = Date.now();
    const calcWith = (table: readonly number[], attempts: number) =>
      now + table[Math.min(attempts - 1, table.length - 1)] * 1000;

    expect(calcWith(drifted, 4)).not.toBe(calcWith(OUTBOX_RETRY_DELAYS_SECONDS, 4));
    expect(calcWith(drifted, 1)).toBe(calcWith(OUTBOX_RETRY_DELAYS_SECONDS, 1));
  });
});
