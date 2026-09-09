import { parseExpression } from 'cron-parser';

/**
 * 타이머 지터 여유. `cron` 은 setTimeout 으로 발화하므로 경계보다 ms 단위로만 앞설 수 있고,
 * `cron-parser.prev()` 는 초 단위로 «직전» 을 고르므로 정각에는 한 주기 전을 돌려준다.
 * 둘 다 이 여유로 흡수한다. 최소 주기(1초)보다 훨씬 작아야 한다.
 */
export const PERIOD_TOLERANCE_MS = 50;

/**
 * 크론식에서 «지금 발화한 주기의 예정 시각» 을 도출한다. 두 태스크의 시계가 한 주기 미만으로
 * 어긋나면 같은 값을 낸다 — 이것이 `cron_runs` 의 선점 키다.
 */
export function computePeriodAt(expression: string, now: Date, timeZone?: string): Date {
  const iterator = parseExpression(expression, {
    currentDate: new Date(now.getTime() + PERIOD_TOLERANCE_MS),
    ...(timeZone ? { tz: timeZone } : {}),
  });
  return iterator.prev().toDate();
}
