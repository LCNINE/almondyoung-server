/** 운영 기준 시간대. KST 는 DST 가 없다. */
export const SHOP_TIME_ZONE = 'Asia/Seoul';
const KST_OFFSET = '+09:00';

// hourCycle: 'h23' 이 없으면 ko-KR 은 자정을 24:00 으로 렌더한다.
const KST_PARTS = new Intl.DateTimeFormat('ko-KR', {
  timeZone: SHOP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function kstParts(now: Date): Record<string, string> {
  return Object.fromEntries(KST_PARTS.formatToParts(now).map((part) => [part.type, part.value]));
}

/**
 * 모델에게 "지금"을 알려주는 블록.
 *
 * `new Date().toISOString()` 은 UTC 라서 00:00~09:00 KST 사이에는 하루 전 날짜를
 * 알려주게 된다 — "오늘 등록한 상품" 같은 요청이 그 시간대에만 어제 것을 집는다.
 *
 * 시스템 프롬프트가 아니라 마지막 사용자 턴 뒤에 붙인다. 시스템 프롬프트는 캐시되는
 * 접두사의 맨 앞이라, 매 요청 바뀌는 값을 거기 두면 캐시가 통째로 무효가 된다.
 */
export function buildDateTimeContext(now: Date): string {
  const p = kstParts(now);
  const date = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute}`;

  return [
    '<current_datetime>',
    `${date} (${p.weekday}) ${time} KST`,
    `ISO 8601: ${date}T${time}:${p.second}${KST_OFFSET}`,
    '</current_datetime>',
  ].join('\n');
}
