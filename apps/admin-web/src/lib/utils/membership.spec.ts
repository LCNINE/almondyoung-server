import { describeContractEvent, getCausedByLabel } from './membership';

describe('describeContractEvent', () => {
  it('관리자 지급은 일수와 종료일을 문장으로 푼다', () => {
    const r = describeContractEvent('GRANTED_BY_ADMIN', {
      days: 25,
      reason: null,
      newEndsAt: '2026-07-18T05:39:28.169Z',
      previousEndsAt: null,
    });
    expect(r.label).toBe('관리자 지급');
    expect(r.detail).toBe('25일 지급 · 2026년 7월 18일까지');
  });

  it('기간 단축의 음수 일수를 절댓값으로 읽는다', () => {
    const r = describeContractEvent('ENTITLEMENT_REDUCED', {
      days: -6,
      reason: '실수',
      previousEndsAt: '2026-07-20T00:00:00.000Z',
      newEndsAt: '2026-07-14T00:00:00.000Z',
    });
    expect(r.label).toBe('기간 단축');
    expect(r.detail).toBe('6일 단축 · 2026년 7월 20일 → 2026년 7월 14일 · 실수');
  });

  it('의미 없는 사유("." 등)는 버린다', () => {
    const r = describeContractEvent('CANCELLED', {
      reason: '.',
      isForced: true,
      refundAmount: 0,
    });
    expect(r.detail).toBe('관리자 강제 해지 · 환불 없음');
  });

  it('해지 사유가 실제 문장이면 남긴다', () => {
    const r = describeContractEvent('CANCELLED', {
      reason: '품절이 많아 구독 취소',
      isForced: true,
      refundAmount: 4990,
    });
    expect(r.detail).toBe('관리자 강제 해지 · 환불 4,990원 · 품절이 많아 구독 취소');
  });

  it('자연 만료는 이유를 풀어 쓴다', () => {
    const r = describeContractEvent('EXPIRED', { reason: 'NATURAL_EXPIRATION' });
    expect(r.label).toBe('기간 만료');
    expect(r.detail).toBe('이용 기간이 끝나 자동 종료');
  });

  it('모르는 이벤트는 원본 코드를 그대로 보여준다 — 조용히 숨기지 않는다', () => {
    const r = describeContractEvent('SOMETHING_NEW', {});
    expect(r.label).toBe('SOMETHING_NEW');
  });

  it('metadata 가 없어도 깨지지 않는다', () => {
    expect(describeContractEvent('GRANTED_BY_ADMIN').label).toBe('관리자 지급');
    expect(describeContractEvent('GRANTED_BY_ADMIN').detail).toBeNull();
  });
});

describe('getCausedByLabel', () => {
  it('주체 코드를 한국어로 바꾼다', () => {
    expect(getCausedByLabel('SYSTEM')).toBe('시스템(자동)');
    expect(getCausedByLabel('USER')).toBe('회원 본인');
    expect(getCausedByLabel('WHATEVER')).toBe('WHATEVER');
  });
});
