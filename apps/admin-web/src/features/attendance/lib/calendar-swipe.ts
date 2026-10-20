export function calendarMonthOffset(month: string, delta: number) {
  const date = new Date(`${month}-15T12:00:00`);

  date.setMonth(date.getMonth() + delta);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function calendarSwipeDirection(dx: number, dy: number, width: number) {
  const threshold = Math.max(48, width * 0.2);

  if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy) * 1.5) {
    return 0;
  }

  return dx < 0 ? 1 : -1;
}
