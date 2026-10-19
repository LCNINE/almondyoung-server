import { calendarMonthOffset, calendarSwipeDirection } from './calendar-swipe';

it('continues across year boundaries', () => {
  expect(calendarMonthOffset('2026-12', 1)).toBe('2027-01');
  expect(calendarMonthOffset('2026-01', -1)).toBe('2025-12');
});

it('commits a horizontal drag and snaps a short drag back', () => {
  expect(calendarSwipeDirection(-120, 10, 320)).toBe(1);
  expect(calendarSwipeDirection(120, 10, 320)).toBe(-1);
  expect(calendarSwipeDirection(25, 2, 320)).toBe(0);
  expect(calendarSwipeDirection(80, 100, 320)).toBe(0);
});
