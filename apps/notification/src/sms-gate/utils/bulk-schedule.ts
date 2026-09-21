import { BULK_WINDOW_END_HOUR, BULK_WINDOW_START_HOUR } from '../constants/sms-gate.constants';
import { startOfKstDay } from './device-picker';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const BULK_WINDOW_MS = (BULK_WINDOW_END_HOUR - BULK_WINDOW_START_HOUR) * HOUR_MS;
const MAX_ESTIMATE_DAYS = 366;

export interface BulkDevice {
  dailyLimit: number;
  sentToday: number;
  lastSentAt: Date | null;
}

function windowOf(day: Date): { start: number; end: number } {
  return {
    start: day.getTime() + BULK_WINDOW_START_HOUR * HOUR_MS,
    end: day.getTime() + BULK_WINDOW_END_HOUR * HOUR_MS,
  };
}

export function isBulkWindow(now: Date): boolean {
  const { start, end } = windowOf(startOfKstDay(now));
  return now.getTime() >= start && now.getTime() < end;
}

export function bulkIntervalMs(dailyLimit: number): number {
  return Math.floor(BULK_WINDOW_MS / dailyLimit);
}

export function isBulkIntervalPassed(device: BulkDevice, now: Date): boolean {
  return !device.lastSentAt || now.getTime() - device.lastSentAt.getTime() >= bulkIntervalMs(device.dailyLimit);
}

export function toKstDate(day: Date): string {
  return new Date(day.getTime() + 9 * HOUR_MS).toISOString().slice(0, 10);
}

/**
 * 앞 대기분(ahead) 다음에 count 건이 나가는 KST 날짜. 폰마다 그날 남은 시간대를 간격으로 나눈 칸 수와
 * 남은 한도 중 작은 만큼 나간다고 본다. 예상치다 — 폰이 꺼지거나 단건이 끼어들면 밀린다.
 */
export function estimateBulkSchedule(
  devices: BulkDevice[],
  now: Date,
  startAt: Date,
  ahead: number,
  count: number,
): { startDate: string | null; completeDate: string | null } {
  const result = { startDate: null as string | null, completeDate: null as string | null };
  if (count <= 0 || devices.length === 0) return result;

  const from = Math.max(now.getTime(), startAt.getTime());
  const today = startOfKstDay(now).getTime();
  let done = 0;
  for (let i = 0; i < MAX_ESTIMATE_DAYS; i++) {
    const day = new Date(startOfKstDay(new Date(from)).getTime() + i * DAY_MS);
    const { start, end } = windowOf(day);
    const cursor = Math.max(start, from);
    if (cursor >= end) continue;
    const slots = devices.reduce((sum, d) => {
      const interval = bulkIntervalMs(d.dailyLimit);
      const remaining = day.getTime() === today ? d.dailyLimit - d.sentToday : d.dailyLimit;
      return sum + Math.max(0, Math.min(remaining, Math.ceil((end - cursor) / interval)));
    }, 0);
    done += slots;
    if (result.startDate === null && done > ahead) result.startDate = toKstDate(day);
    if (done >= ahead + count) {
      result.completeDate = toKstDate(day);
      return result;
    }
  }
  return result;
}
