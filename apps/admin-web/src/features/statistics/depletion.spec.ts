import { estimateDepletion, inclusiveRangeDays } from './depletion';

describe('inclusiveRangeDays', () => {
  it('양끝을 포함해 센다', () => {
    expect(inclusiveRangeDays('2026-08-01', '2026-08-30')).toBe(30);
    expect(inclusiveRangeDays('2026-08-01', '2026-08-01')).toBe(1);
  });

  it('구간이 뒤집혔거나 날짜가 아니면 0 이다 — 호출부가 계산을 포기한다', () => {
    expect(inclusiveRangeDays('2026-08-30', '2026-08-01')).toBe(0);
    expect(inclusiveRangeDays('없는날짜', '2026-08-01')).toBe(0);
  });

  it('일광절약시간이 있는 지역에서도 UTC 로 세어 하루가 밀리지 않는다', () => {
    expect(inclusiveRangeDays('2026-03-01', '2026-03-31')).toBe(31);
  });
});

describe('estimateDepletion', () => {
  it('재고 ÷ 일평균 판매속도로 소진일수를 낸다', () => {
    const result = estimateDepletion(300, 60, 30);
    expect(result).toEqual({ status: 'ok', days: 150, dailyVelocity: 2 });
  });

  it('기간 판매가 0이면 계산하지 않는다 — 큰 수로 뭉개지 않는다', () => {
    expect(estimateDepletion(300, 0, 30)).toEqual({ status: 'no-sales' });
  });

  it('재고가 없으면 소진일수가 아니라 품절이다', () => {
    expect(estimateDepletion(0, 60, 30)).toEqual({ status: 'no-stock' });
  });

  it('재고를 못 읽었으면 0 으로 뭉개지 않고 모른다고 한다', () => {
    expect(estimateDepletion(null, 60, 30)).toEqual({ status: 'unknown' });
    expect(estimateDepletion(undefined, 60, 30)).toEqual({ status: 'unknown' });
  });

  it('기간 일수가 0이면 나눗셈을 시도하지 않는다', () => {
    expect(estimateDepletion(300, 60, 0)).toEqual({ status: 'unknown' });
  });

  it('판매수량을 모르면 판매 없음과 같이 다룬다 — 속도를 추정할 근거가 없다', () => {
    expect(estimateDepletion(300, null, 30)).toEqual({ status: 'no-sales' });
  });
});
