export function splitClockPeriod(value: string) {
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const [hour, minute] = valid ? value.split(':').map(Number) : [9, 0];

  return { period: hour >= 12 ? 1 : 0, hour: hour % 12 || 12, minute };
}

export function joinClockPeriod(period: number, hour: number, minute: number) {
  const clockHour = (hour % 12) + period * 12;

  return `${String(clockHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
