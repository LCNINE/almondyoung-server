import { returnWindowEndsAt } from '../return-window';

describe('returnWindowEndsAt (N4: KST 달력 7일)', () => {
  it('KST 10-21 00:30 배송 → 10-28 23:59:59.999 KST', () => {
    expect(returnWindowEndsAt(new Date('2026-10-20T15:30:00.000Z')).toISOString()).toBe('2026-10-28T14:59:59.999Z');
  });

  it('KST 10-20 23:59 배송 → 10-27 23:59:59.999 KST', () => {
    expect(returnWindowEndsAt(new Date('2026-10-20T14:59:00.000Z')).toISOString()).toBe('2026-10-27T14:59:59.999Z');
  });
});
