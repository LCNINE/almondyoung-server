import { computeEntrancePasswordExpiry, ENTRANCE_PASSWORD_TTL_DAYS } from './entrance-password-expiry';

describe('computeEntrancePasswordExpiry', () => {
  it('TTL 은 14일이다', () => {
    expect(ENTRANCE_PASSWORD_TTL_DAYS).toBe(14);
  });

  it('주문일로부터 정확히 14일 뒤를 반환한다', () => {
    const result = computeEntrancePasswordExpiry('2026-01-01T00:00:00.000Z');
    expect(result.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('연 경계를 넘는 입력에서도 정확하다 (12월 하순 주문)', () => {
    const result = computeEntrancePasswordExpiry('2025-12-20T10:30:00.000Z');
    expect(result.toISOString()).toBe('2026-01-03T10:30:00.000Z');
  });

  it('월 경계를 넘는 입력에서도 정확하다', () => {
    const result = computeEntrancePasswordExpiry('2026-02-25T23:59:59.000Z');
    expect(result.toISOString()).toBe('2026-03-11T23:59:59.000Z');
  });

  it('타임존이 붙은 ISO 입력을 UTC 기준으로 일관되게 다룬다', () => {
    // 2026-06-15T09:00:00+09:00 == 2026-06-15T00:00:00.000Z
    const result = computeEntrancePasswordExpiry('2026-06-15T09:00:00+09:00');
    expect(result.toISOString()).toBe('2026-06-29T00:00:00.000Z');
  });
});
