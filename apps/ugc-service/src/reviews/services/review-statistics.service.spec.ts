import {
  addDays,
  fillRatingDistribution,
  kstDayStartUtc,
  previousRange,
  toExcerpt,
} from './review-statistics.service';

describe('kstDayStartUtc', () => {
  it('KST 자정은 UTC 로 전날 15시다', () => {
    expect(kstDayStartUtc('2026-08-26').toISOString()).toBe('2026-08-25T15:00:00.000Z');
  });
});

describe('addDays', () => {
  it('월 경계를 넘는다', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('previousRange', () => {
  it('직전 동일 길이 기간을 돌려준다', () => {
    expect(previousRange('2026-08-08', '2026-08-14')).toEqual({ from: '2026-08-01', to: '2026-08-07' });
  });

  it('하루짜리 기간은 전날 하루다', () => {
    expect(previousRange('2026-08-26', '2026-08-26')).toEqual({ from: '2026-08-25', to: '2026-08-25' });
  });
});

describe('fillRatingDistribution', () => {
  it('없는 점수를 0 으로 채워 5→1 순으로 내려보낸다', () => {
    expect(fillRatingDistribution([{ rating: 5, count: 3 }, { rating: 2, count: 1 }])).toEqual([
      { rating: 5, count: 3 },
      { rating: 4, count: 0 },
      { rating: 3, count: 0 },
      { rating: 2, count: 1 },
      { rating: 1, count: 0 },
    ]);
  });

  it('빈 입력이면 전부 0', () => {
    expect(fillRatingDistribution([]).every((bucket) => bucket.count === 0)).toBe(true);
  });
});

describe('toExcerpt', () => {
  it('짧은 본문은 그대로', () => {
    expect(toExcerpt('좋아요')).toBe('좋아요');
  });

  it('200자를 넘으면 자르고 말줄임을 붙인다', () => {
    const long = 'a'.repeat(250);
    const excerpt = toExcerpt(long);
    expect(excerpt).toHaveLength(201);
    expect(excerpt.endsWith('…')).toBe(true);
  });
});
