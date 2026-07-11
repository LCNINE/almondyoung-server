import { isReservationOverReserved } from './ledger-reconciliation.service';

describe('isReservationOverReserved', () => {
  it('예약 > ON_HAND 이면 drift', () => {
    expect(isReservationOverReserved(6, 10)).toBe(true);
  });
  it('예약 <= ON_HAND 이면 정상', () => {
    expect(isReservationOverReserved(10, 6)).toBe(false);
    expect(isReservationOverReserved(6, 6)).toBe(false);
  });
});
