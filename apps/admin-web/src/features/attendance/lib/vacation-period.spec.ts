import { vacationPeriodDays } from './vacation-period';

describe('vacation period to attendance leave', () => {
  const base = {
    from: '2026-10-19',
    to: '2026-10-19',
    allDay: false,
    startTime: '09:00',
    endTime: '13:00',
    normalStart: '09:00',
    normalEnd: '18:00',
  };

  it('stores morning vacation as an afternoon working interval', () => {
    expect(vacationPeriodDays(base)).toEqual([
      { date: '2026-10-19', type: 'am', start: '13:00', end: '18:00' },
    ]);
  });

  it('preserves an existing AM work interval when only its reminder or D-day is edited', () => {
    expect(
      vacationPeriodDays({
        ...base,
        existingDay: { date: '2026-10-19', type: 'am', start: '13:00', end: '17:00' },
      })
    ).toEqual([{ date: '2026-10-19', type: 'am', start: '13:00', end: '17:00' }]);
  });

  it('preserves an existing PM work interval even after normal working hours change', () => {
    expect(
      vacationPeriodDays({
        ...base,
        normalStart: '14:00',
        existingDay: { date: '2026-10-19', type: 'pm', start: '10:00', end: '13:00' },
      })
    ).toEqual([{ date: '2026-10-19', type: 'pm', start: '10:00', end: '13:00' }]);
  });

  it('uses the edited vacation times when the existing period is explicitly changed', () => {
    expect(
      vacationPeriodDays({
        ...base,
        startTime: '13:00',
        endTime: '18:00',
        periodChanged: true,
        existingDay: { date: '2026-10-19', type: 'pm', start: '10:00', end: '12:00' },
      })
    ).toEqual([{ date: '2026-10-19', type: 'pm', start: '09:00', end: '13:00' }]);
  });

  it('stores afternoon vacation as a morning working interval', () => {
    expect(
      vacationPeriodDays({ ...base, startTime: '13:00', endTime: '18:00' })
    ).toEqual([
      { date: '2026-10-19', type: 'pm', start: '09:00', end: '13:00' },
    ]);
  });

  it('keeps a multi-day vacation as partial edges and full days between', () => {
    expect(
      vacationPeriodDays({ ...base, to: '2026-10-21', startTime: '13:00' })
    ).toEqual([
      { date: '2026-10-19', type: 'pm', start: '09:00', end: '13:00' },
      { date: '2026-10-20', type: 'full' },
      { date: '2026-10-21', type: 'am', start: '13:00', end: '18:00' },
    ]);
  });

  it('uses the whole selected period for all-day vacation', () => {
    expect(
      vacationPeriodDays({ ...base, to: '2026-10-20', allDay: true })
    ).toEqual([
      { date: '2026-10-19', type: 'full' },
      { date: '2026-10-20', type: 'full' },
    ]);
  });

  it('rejects middle-of-day hours instead of silently changing work reminders', () => {
    expect(() =>
      vacationPeriodDays({ ...base, startTime: '10:00', endTime: '14:00' })
    ).toThrow();
  });
});
