import {
  formatMonthDay,
  isArrivalOverdue,
  showPromisedArrival,
} from './arrival-overdue';

describe('isArrivalOverdue', () => {
  const today = '2026-11-16';
  it('receiving + 어제 → true', () => {
    expect(isArrivalOverdue('receiving', '2026-11-15', today)).toBe(true);
  });
  it('expected + 어제 → true', () => {
    expect(isArrivalOverdue('expected', '2026-11-15', today)).toBe(true);
  });
  it('오늘 → false', () => {
    expect(isArrivalOverdue('receiving', '2026-11-16', today)).toBe(false);
  });
  it('null → false', () => {
    expect(isArrivalOverdue('receiving', null, today)).toBe(false);
  });
  it('closed + 어제 → false', () => {
    expect(isArrivalOverdue('closed', '2026-11-15', today)).toBe(false);
  });
});

describe('showPromisedArrival', () => {
  it('같음 → false', () => {
    expect(showPromisedArrival('2026-11-20', '2026-11-20')).toBe(false);
  });
  it('다름 → true', () => {
    expect(showPromisedArrival('2026-11-22', '2026-11-20')).toBe(true);
  });
  it('promised null → false', () => {
    expect(showPromisedArrival('2026-11-22', null)).toBe(false);
  });
});

describe('formatMonthDay', () => {
  it('M/D', () => {
    expect(formatMonthDay('2026-11-05')).toBe('11/5');
  });
});
