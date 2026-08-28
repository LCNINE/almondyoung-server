import { estimateMissedDemand, missedDemandSentence } from './missed-demand';

const measured = { zeroResultSearches: 1_000, purchases: 20, sessions: 1_000, avgOrderValue: 50_000 };

describe('estimateMissedDemand', () => {
  it('빈손 검색 × 관측 전환율 × 객단가', () => {
    const demand = estimateMissedDemand(measured);
    expect(demand.conversionRate).toBe(0.02);
    expect(demand.amount).toBe(1_000_000);
    expect(demand.blockedBy).toBeNull();
  });

  it('빈손 검색이 0이면 놓친 것도 0 — 이건 진짜 0이다', () => {
    const demand = estimateMissedDemand({ ...measured, zeroResultSearches: 0 });
    expect(demand.amount).toBe(0);
    expect(demand.blockedBy).toBeNull();
  });

  it('세션이 0이면 전환율을 못 내고 금액도 null — 0 으로 두면 놓친 게 없다고 읽힌다', () => {
    const demand = estimateMissedDemand({ ...measured, sessions: 0 });
    expect(demand.amount).toBeNull();
    expect(demand.conversionRate).toBeNull();
    expect(demand.blockedBy).toContain('전환율');
  });

  it('객단가가 없으면 금액을 내지 않는다', () => {
    expect(estimateMissedDemand({ ...measured, avgOrderValue: null }).blockedBy).toContain('객단가');
    expect(estimateMissedDemand({ ...measured, avgOrderValue: 0 }).blockedBy).toContain('객단가');
  });

  it('검색 로그가 없으면 그 사실을 말한다', () => {
    const demand = estimateMissedDemand({ ...measured, zeroResultSearches: undefined });
    expect(demand.amount).toBeNull();
    expect(demand.blockedBy).toContain('검색 로그');
  });

  it('전환율은 계산할 수 있으면 금액이 막혀도 같이 준다', () => {
    expect(estimateMissedDemand({ ...measured, avgOrderValue: null }).conversionRate).toBe(0.02);
  });
});

describe('missedDemandSentence', () => {
  it('금액과 함께 근거·한계를 같이 말한다', () => {
    const text = missedDemandSentence(estimateMissedDemand(measured), 30);
    expect(text).toContain('100만원');
    expect(text).toContain('2.0%');
    expect(text).toContain('상한에 가깝습니다');
  });

  it('억 단위는 억으로 줄여 쓴다', () => {
    const demand = estimateMissedDemand({ ...measured, zeroResultSearches: 200_000 });
    expect(missedDemandSentence(demand, 30)).toContain('2.0억원');
  });

  it('계산 불가면 왜 못 하는지를 말한다 — 빈칸이면 사람이 0 으로 읽는다', () => {
    const text = missedDemandSentence(estimateMissedDemand({ ...measured, sessions: 0 }), 30);
    expect(text).toContain('추정할 수 없습니다');
    expect(text).toContain('전환율');
  });

  it('빈손 검색이 없으면 그렇다고 답한다', () => {
    const text = missedDemandSentence(estimateMissedDemand({ ...measured, zeroResultSearches: 0 }), 7);
    expect(text).toBe('최근 7일 동안 결과 없이 끝난 검색이 없습니다.');
  });
});
