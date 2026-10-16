import {
  halfDaySchedule,
  normalSchedule,
  seoulDate,
  validatePlannedTimes,
  verifyLocation,
  recommendPlannedClock,
} from './attendance';

describe('attendance rules', () => {
  it('recommends only after enough consistent planned history', () => {
    expect(recommendPlannedClock(['14:00', '14:00'])).toBeNull();
    expect(recommendPlannedClock(['14:00', '14:10', '13:50', '14:00', '14:00'])).toBe('14:00');
    expect(recommendPlannedClock(['09:00', '12:00', '14:00', '16:00', '18:00'])).toBeNull();
  });
  it('preserves the normal finish time for morning leave', () => {
    expect(normalSchedule('09:00')).toEqual({ start: '09:00', end: '18:00' });
    expect(normalSchedule('10:00')).toEqual({ start: '10:00', end: '19:00' });
    expect(halfDaySchedule('09:00', 'am')).toEqual({ start: '13:00', end: '18:00' });
    expect(halfDaySchedule('10:00', 'am')).toEqual({ start: '14:00', end: '19:00' });
    expect(halfDaySchedule('10:00', 'pm')).toEqual({ start: '10:00', end: '' });
  });

  it('rejects invalid, equal and reversed planned times', () => {
    expect(validatePlannedTimes('13:00', '18:00')).toBeNull();
    for (const [start, end] of [
      ['18:00', '13:00'],
      ['13:00', '13:00'],
      ['25:00', '18:00'],
      ['', '18:00'],
    ]) {
      expect(validatePlannedTimes(start, end)).toBeTruthy();
    }
  });

  it('uses the Seoul work date independently of server timezone', () => {
    expect(seoulDate(new Date('2026-10-16T15:01:00Z'))).toBe('2026-10-17');
  });

  const now = new Date('2026-10-16T00:00:00Z');
  const site = {
    id: 'site',
    name: '본사',
    latitude: 37.5,
    longitude: 127,
    radiusMeters: 150,
    accuracyMeters: 50,
    active: true,
    version: 1,
  };
  const point = { latitude: 37.5, longitude: 127, accuracy: 20, timestamp: now.getTime() };

  it('accepts a recent accurate location within the workplace', () => {
    expect(() => verifyLocation(point, site, now)).not.toThrow();
  });

  it.each([
    { ...point, latitude: NaN },
    { ...point, longitude: 181 },
    { ...point, timestamp: now.getTime() - 61000 },
    { ...point, timestamp: now.getTime() + 11000 },
    { ...point, accuracy: 90 },
    { ...point, accuracy: -1 },
    { ...point, latitude: 37.6 },
  ])('rejects invalid or unverifiable location %#', (sample) => {
    expect(() => verifyLocation(sample, site, now)).toThrow();
  });
});
