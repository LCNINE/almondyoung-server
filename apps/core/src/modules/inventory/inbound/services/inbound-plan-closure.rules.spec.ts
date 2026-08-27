import { isItemClosed, isPlanClosed } from './inbound-plan-closure.rules';

describe('isItemClosed', () => {
  it('confirmed 와 short_closed 만 종결이다', () => {
    expect(isItemClosed('confirmed')).toBe(true);
    expect(isItemClosed('short_closed')).toBe(true);
    expect(isItemClosed('pending')).toBe(false);
  });

  // applied/receiving 는 코드 참조 0건인 죽은 값이다. 종결로 취급하면
  // 누군가 그 값을 되살리는 순간 안 받은 계획이 조용히 닫힌다.
  it('죽은 enum 값(applied/receiving)은 종결이 아니다', () => {
    expect(isItemClosed('applied')).toBe(false);
    expect(isItemClosed('receiving')).toBe(false);
  });
});

describe('isPlanClosed', () => {
  it('전 아이템이 종결이면 닫힌다', () => {
    expect(isPlanClosed(['confirmed', 'short_closed'])).toBe(true);
  });

  it('pending 아이템이 하나라도 있으면 안 닫힌다', () => {
    expect(isPlanClosed(['confirmed', 'pending'])).toBe(false);
  });

  // 계획 생성과 첫 아이템 추가 사이의 과도 상태. 여기서 닫으면
  // 라인 실행 도중의 빈 계획이 발주를 received 로 밀어버린다.
  it('아이템이 0개인 계획은 닫지 않는다', () => {
    expect(isPlanClosed([])).toBe(false);
  });
});
