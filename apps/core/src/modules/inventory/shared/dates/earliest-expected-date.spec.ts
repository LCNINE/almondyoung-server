import { earliestExpectedDate } from './earliest-expected-date';

describe('가장 이른 예정일', () => {
  it('가장 이른 날짜를 고른다', () => {
    expect(earliestExpectedDate(['2026-09-10', '2026-08-30', '2026-12-01'])?.toISOString()).toBe(
      '2026-08-30T00:00:00.000Z',
    );
  });

  it('날짜가 없는 항목은 건너뛴다', () => {
    expect(earliestExpectedDate([null, '2026-09-10'])?.toISOString()).toBe('2026-09-10T00:00:00.000Z');
  });

  it('전부 비어 있으면 null 이다', () => {
    expect(earliestExpectedDate([null])).toBeNull();
    expect(earliestExpectedDate([])).toBeNull();
  });

  // 러너 TZ 가 무엇이든 달력 날짜가 밀리지 않는다. jest 는 UTC 로 뜨지만(#724 항목 13)
  // 이 성질은 TZ 와 무관하게 성립해야 한다 — 확인은 셸에서 TZ 를 바꿔 돌린다.
  it('오프셋 없는 날짜를 UTC 자정으로 올린다', () => {
    const result = earliestExpectedDate(['2026-01-01']);
    expect(result?.getUTCFullYear()).toBe(2026);
    expect(result?.getUTCMonth()).toBe(0);
    expect(result?.getUTCDate()).toBe(1);
  });
});
