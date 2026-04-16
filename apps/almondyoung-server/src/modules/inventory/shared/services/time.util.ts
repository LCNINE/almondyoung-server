import { toZonedTime } from 'date-fns-tz';
import { isSameDay } from 'date-fns';

const SEOUL_TZ = 'Asia/Seoul';

export function toSeoulTime(date: Date | string | number): Date {
  const d = date instanceof Date ? date : new Date(date);
  return toZonedTime(d, SEOUL_TZ);
}

export function isSameSeoulDay(a: Date | string | number, b: Date | string | number): boolean {
  const az = toSeoulTime(a);
  const bz = toSeoulTime(b);
  return isSameDay(az, bz);
}

export function nowSeoul(): Date {
  return toSeoulTime(new Date());
}
