/**
 * jest 가 UTC 로 떴는지 고정한다 (#724 항목 13).
 *
 * `scripts/jest/global-setup.js` 배선이 설정에서 빠지면 이 스펙이 빨개진다. 그 배선이
 * 조용히 사라지면 서울 머신에서 TZ 버그가 다시 안 보이게 되는데, 그건 **아무 테스트도
 * 실패하지 않는 방식으로** 일어난다 — 그래서 감시자가 따로 필요하다.
 *
 * ⚠️ TZ 견고성을 일부러 확인하느라 다른 타임존으로 띄웠다면
 * (`TZ=America/New_York npx jest …`) 이 스펙 **하나만** 빨간 게 정상이다.
 *
 * 커버리지 범위: 루트 jest 설정(= `npx jest` 게이트)뿐이다. user-service·membership·
 * core-e2e 전용 설정에도 같은 globalSetup 이 배선돼 있지만, 그 설정들의 `testMatch` 는
 * 각자 앱 디렉터리로 한정돼 있어 이 파일을 수집하지 않는다.
 */
describe('jest 프로세스 타임존', () => {
  it('UTC 로 뜬다', () => {
    expect(new Date().getTimezoneOffset()).toBe(0);
  });

  it('서울 오프셋을 두 번 걸면 결과가 달라진다 (이 스펙이 지키려는 성질)', () => {
    // 서울 머신에서는 `toZonedTime(x, 'Asia/Seoul')` 이 항등이라 이중 변환과 정상 코드가
    // 구분되지 않는다. UTC 에서만 이 차이가 관측 가능해진다 — 발견 ⑪ 이 그렇게 숨어 있었다.
    const instant = new Date('2026-08-25T06:00:00Z'); // KST 15:00
    const onceSeoulHour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        hour12: false,
      }).format(instant),
    );
    const localHour = instant.getHours();

    expect(onceSeoulHour).toBe(15);
    expect(localHour).not.toBe(onceSeoulHour);
  });
});
