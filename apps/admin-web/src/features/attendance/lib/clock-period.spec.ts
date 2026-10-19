import { joinClockPeriod, splitClockPeriod } from './clock-period';

it.each([
  ['00:00', 0, 12, 0],
  ['09:05', 0, 9, 5],
  ['12:00', 1, 12, 0],
  ['22:59', 1, 10, 59],
])(
  'round trips %s through a twelve-hour wheel',
  (clock, period, hour, minute) => {
    expect(splitClockPeriod(clock)).toEqual({ period, hour, minute });
    expect(joinClockPeriod(period, hour, minute)).toBe(clock);
  }
);
