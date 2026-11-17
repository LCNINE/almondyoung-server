import { reservationTarget } from './reservation-target';

describe('reservationTarget', () => {
  it('demand 2 · held 1 → 1', () => {
    expect(reservationTarget({ demand: 2, heldUnits: 1 })).toBe(1);
  });
  it('demand 1 · held 3 → 0', () => {
    expect(reservationTarget({ demand: 1, heldUnits: 3 })).toBe(0);
  });
  it('demand 0 → 0', () => {
    expect(reservationTarget({ demand: 0, heldUnits: 0 })).toBe(0);
  });
});
