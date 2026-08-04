import { SEOUL_TZ, toSeoulDateOnly } from './date.util';

describe('toSeoulDateOnly', () => {
  it('KST 자정 직후(UTC 로는 전날 15:30)를 다음 날 버킷에 넣는다', () => {
    // 2026-07-31T15:30:00Z === 2026-08-01 00:30 KST.
    // The regression this guards: `toISOString().slice(0, 10)` returns '2026-07-31' here,
    // filing every order placed between 00:00 and 09:00 KST under the previous day.
    expect(toSeoulDateOnly(new Date('2026-07-31T15:30:00.000Z'))).toBe('2026-08-01');
  });

  it('KST 자정 직전(UTC 로는 같은 날 14:59)은 아직 그 날 버킷이다', () => {
    // 2026-07-31T14:59:59Z === 2026-07-31 23:59:59 KST — one second before the boundary
    // above. Pairing the two pins the boundary itself, not just "some offset is applied".
    expect(toSeoulDateOnly(new Date('2026-07-31T14:59:59.999Z'))).toBe('2026-07-31');
  });

  it('UTC 자정 직후(KST 09:00)는 UTC 와 같은 날이다', () => {
    // The half of the day where UTC and KST agree — proves the shift is +9h, not a blanket
    // "always advance a day".
    expect(toSeoulDateOnly(new Date('2026-07-31T00:00:00.000Z'))).toBe('2026-07-31');
  });

  it('월·연 경계를 넘길 때도 달력 자릿수를 올바르게 굴린다', () => {
    // 2026-12-31T15:00:00Z === 2027-01-01 00:00 KST. A hand-rolled `+9h then slice` on the
    // ISO string would be fine here, but a hand-rolled offset on the *date parts* would not.
    expect(toSeoulDateOnly(new Date('2026-12-31T15:00:00.000Z'))).toBe('2027-01-01');
  });

  it('타임존 상수는 레포 관례(Asia/Seoul)와 같다', () => {
    // Pins the constant against a silent switch to e.g. 'UTC' or a fixed '+09:00' string,
    // which would still make the cases above pass today but drift from
    // apps/core/src/modules/inventory/shared/services/time.util.ts.
    expect(SEOUL_TZ).toBe('Asia/Seoul');
  });
});
