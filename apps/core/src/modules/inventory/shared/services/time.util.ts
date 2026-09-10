import { toZonedTime } from 'date-fns-tz';
import { isSameDay } from 'date-fns';

const SEOUL_TZ = 'Asia/Seoul';

/**
 * **export 하지 않는다 (#744).** 돌려주는 Date 는 epoch 이 옮겨진 «표시용 벽시계»라, 저장하거나
 * 진짜 순간과 비교하면 조용히 9시간 틀린다. 이 모듈 밖으로 나가는 건 boolean 뿐이어야 한다.
 * `scripts/jest/no-shifted-date-outside-time-util.spec.ts` 가 이 경계를 지킨다.
 */
function toSeoulTime(date: Date | string | number): Date {
  const d = date instanceof Date ? date : new Date(date);
  return toZonedTime(d, SEOUL_TZ);
}

export function isSameSeoulDay(a: Date | string | number, b: Date | string | number): boolean {
  const az = toSeoulTime(a);
  const bz = toSeoulTime(b);
  return isSameDay(az, bz);
}

/**
 * 이 순간이 **서울 기준 오늘**인가.
 *
 * 기준 `now` 를 이 함수가 직접 만든다 — 호출부가 「지금의 서울 시각」을 손수 만들어 넘기면
 * 오프셋이 두 번 먹고 기준 "오늘"이 9시간 앞선다(#724 발견 ⑪: KST 15:00~24:00 의 당일
 * 입고 취소가 전부 400 이었다). 그 오용이 불가능하도록 만드는 것이 이 함수의 존재 이유다.
 *
 * @param instant 판정 대상 — **진짜 순간**(UTC 기준 Date). 시프트된 값을 넘기지 말 것.
 * @param now 기준 시각. 스펙에서 벽시계를 고정할 때만 넘긴다.
 */
export function isTodaySeoul(instant: Date | string | number, now: Date = new Date()): boolean {
  return isSameSeoulDay(instant, now);
}
