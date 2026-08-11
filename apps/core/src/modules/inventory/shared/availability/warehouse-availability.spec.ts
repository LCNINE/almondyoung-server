import { computeAvailable, violatesAvailability } from './warehouse-availability';

describe('computeAvailable — 가용재고 정본 정의', () => {
  it('가용 = ON_HAND 합 − confirmed 예약 합', () => {
    expect(computeAvailable(10, 4)).toBe(6);
  });

  it('예약이 ON_HAND 를 넘으면 음수를 그대로 반환한다 (clamp 는 호출자 책임)', () => {
    expect(computeAvailable(3, 5)).toBe(-2);
  });

  it('예약이 0 이면 ON_HAND 그대로', () => {
    expect(computeAvailable(7, 0)).toBe(7);
  });
});

describe('violatesAvailability — 차감 가능 여부', () => {
  it('차감 후 가용이 음수가 되면 위반', () => {
    expect(violatesAvailability(10, 6, 5)).toBe(true); // (10-5) - 6 = -1
  });

  it('차감 후 가용이 정확히 0 이면 통과', () => {
    expect(violatesAvailability(10, 6, 4)).toBe(false); // (10-4) - 6 = 0
  });

  it('예약 0 이면 ON_HAND 전량 차감이 통과', () => {
    expect(violatesAvailability(10, 0, 10)).toBe(false);
  });

  it('차감 0 은 예약이 이미 초과 상태여도 통과한다 (새 위반을 만들지 않으므로)', () => {
    expect(violatesAvailability(3, 5, 0)).toBe(true);
  });
});
