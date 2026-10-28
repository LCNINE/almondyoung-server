export type SatisfactionPeriod = 'today' | 'week' | 'month';

export const PERIOD_OPTIONS: { value: SatisfactionPeriod; label: string; days: number }[] = [
  { value: 'today', label: '오늘', days: 1 },
  { value: 'week', label: '최근 7일', days: 7 },
  { value: 'month', label: '최근 30일', days: 30 },
];

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const kstDate = (ms: number) => new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);

export function periodRange(period: SatisfactionPeriod, now: Date = new Date()): { from: string; to: string } {
  const days = PERIOD_OPTIONS.find((o) => o.value === period)?.days ?? 1;
  const t = now.getTime();
  return { from: kstDate(t - (days - 1) * DAY_MS), to: kstDate(t) };
}

export function formatKstTime(iso: string): string {
  return new Date(new Date(iso).getTime() + KST_OFFSET_MS).toISOString().slice(5, 16).replace('T', ' ');
}
