import { computePeriodAt } from './period-key';

/**
 * 주기 키는 벽시계가 아니라 **크론식에서 도출한 예정 발화 시각**이다. 두 태스크가 각자 발화해도
 * 같은 키를 계산해야 선점 경쟁이 성립한다. `cron-parser` 의 `prev()` 는 초 단위로 «직전» 을
 * 고르므로 정각(`.000`)에 부르면 한 주기 전을 돌려준다 — 50ms 여유가 그걸 막는다 (2026-09-10 실측).
 */
describe('computePeriodAt', () => {
  const at = (iso: string) => new Date(iso);

  it('6필드(초 포함) 크론식: 지연 발화면 현재 주기', () => {
    expect(computePeriodAt('*/10 * * * * *', at('2026-09-10T00:00:00.999Z'))).toEqual(at('2026-09-10T00:00:00.000Z'));
  });

  it('정각 발화(.000)도 현재 주기다 — 50ms 여유', () => {
    expect(computePeriodAt('*/10 * * * * *', at('2026-09-10T00:00:00.000Z'))).toEqual(at('2026-09-10T00:00:00.000Z'));
  });

  it('경계 직전 발화(-10ms)도 다가오는 주기로 본다', () => {
    expect(computePeriodAt('*/10 * * * * *', at('2026-09-09T23:59:59.990Z'))).toEqual(at('2026-09-10T00:00:00.000Z'));
  });

  it('5필드 크론식과 Nest 상수의 앞자리 0 (`0 04 * * *`)', () => {
    expect(computePeriodAt('0 04 * * *', at('2026-09-10T04:00:00.000Z'))).toEqual(at('2026-09-10T04:00:00.000Z'));
    expect(computePeriodAt('*/1 * * * *', at('2026-09-10T04:07:00.300Z'))).toEqual(at('2026-09-10T04:07:00.000Z'));
  });

  it('timeZone 이 있으면 그 시간대의 벽시계로 해석한다 (서울 04:00 = UTC 전날 19:00)', () => {
    expect(computePeriodAt('0 4 * * *', at('2026-09-10T19:00:00.000Z'), 'Asia/Seoul')).toEqual(
      at('2026-09-10T19:00:00.000Z'),
    );
  });

  it('매초 크론식도 초 단위 키를 낸다', () => {
    expect(computePeriodAt('* * * * * *', at('2026-09-10T00:00:03.120Z'))).toEqual(at('2026-09-10T00:00:03.000Z'));
  });
});
