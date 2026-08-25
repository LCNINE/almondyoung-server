import { isTodaySeoul } from './time.util';

/**
 * `isTodaySeoul` — "이 순간이 서울 기준 오늘인가".
 *
 * 이 스펙이 존재하는 이유(#724 발견 ⑪): 호출부가 `isSameSeoulDay(nowSeoul(), occurredAt)` 로
 * 쓰여 **왼쪽에만 서울 오프셋이 두 번** 먹었다. 기준 "오늘"이 9시간 앞서 KST 15:00~24:00 의
 * 당일 입고 취소가 전부 400 이 됐다.
 *
 * ⚠️ **이 판정은 프로세스 TZ 에 민감하고, 그 민감함은 스펙 안에서 못 없앤다.**
 * `toZonedTime` 은 런타임 TZ 에 상대적이라 개발 머신(Asia/Seoul)에서는 이중 변환이 항등이 돼
 * 버그가 사라진다. 그리고 **jest 안에서 `process.env.TZ` 를 바꾸는 것은 무효다** — 실측했다
 * (할당해도 `getTimezoneOffset()` 이 -540 그대로). TZ 는 프로세스를 띄울 때 박아야 한다.
 * CI 러너와 라이브(ECS/Lambda)가 UTC 이므로 **이 스펙의 방어력은 CI 에서 나온다.**
 * 서울 머신에서 로컬로 돌리면 통과하지만 아무것도 증명하지 못한다.
 */
describe('isTodaySeoul', () => {
  // KST = UTC+9. 아래 주석의 KST 시각이 이 스펙이 말하려는 바다.
  const NOW_KST_2300 = new Date('2026-08-25T14:00:00Z'); // KST 2026-08-25 23:00

  it('같은 서울 날짜의 새벽 영수증을 밤 11시에도 오늘로 본다', () => {
    const occurred = new Date('2026-08-24T15:30:00Z'); // KST 2026-08-25 00:30
    expect(isTodaySeoul(occurred, NOW_KST_2300)).toBe(true);
  });

  it('서울 자정 정각은 그 날에 속한다', () => {
    const occurred = new Date('2026-08-24T15:00:00Z'); // KST 2026-08-25 00:00:00
    expect(isTodaySeoul(occurred, NOW_KST_2300)).toBe(true);
  });

  it('서울 기준 전날 밤 영수증은 오늘이 아니다', () => {
    const occurred = new Date('2026-08-24T14:30:00Z'); // KST 2026-08-24 23:30
    expect(isTodaySeoul(occurred, NOW_KST_2300)).toBe(false);
  });

  it('KST 15:00 이후에도 같은 날 영수증을 오늘로 본다 (이중 변환 회귀 고정)', () => {
    // 이중 변환 시 now 가 KST 24:00 으로 밀려 다음 날이 되고, 이 판정이 false 로 뒤집힌다.
    const now = new Date('2026-08-25T06:00:00Z'); // KST 15:00
    const occurred = new Date('2026-08-25T05:00:00Z'); // KST 14:00
    expect(isTodaySeoul(occurred, now)).toBe(true);
  });

  it('now 를 생략하면 실제 벽시계를 쓴다', () => {
    expect(isTodaySeoul(new Date())).toBe(true);
  });
});
