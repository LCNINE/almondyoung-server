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

/**
 * 이 순간이 **서울 기준 오늘**인가.
 *
 * `isSameSeoulDay(nowSeoul(), x)` 로 쓰지 말 것 — `nowSeoul()` 은 이미 시프트된 Date 라
 * 오프셋이 두 번 먹고 기준 "오늘"이 9시간 앞선다(#724 발견 ⑪: KST 15:00~24:00 의 당일
 * 입고 취소가 전부 400 이었다). 그 오용이 불가능하도록 이 함수가 `now` 를 직접 만든다.
 *
 * @param instant 판정 대상 — **진짜 순간**(UTC 기준 Date). 시프트된 값을 넘기지 말 것.
 * @param now 기준 시각. 스펙에서 벽시계를 고정할 때만 넘긴다.
 */
export function isTodaySeoul(instant: Date | string | number, now: Date = new Date()): boolean {
  return isSameSeoulDay(instant, now);
}
