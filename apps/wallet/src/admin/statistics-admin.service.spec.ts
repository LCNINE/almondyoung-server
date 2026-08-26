import { kstDayStart, resolveFeeRateBp, summarizeFees } from './statistics-admin.service';

describe('kstDayStart', () => {
  it('KST 날짜의 자정을 UTC 로 환산한다', () => {
    expect(kstDayStart('2026-08-10').toISOString()).toBe('2026-08-09T15:00:00.000Z');
  });
});

describe('resolveFeeRateBp', () => {
  const rates = [
    { methodType: 'CARD', feeRateBp: 290, effectiveFrom: kstDayStart('2026-08-01') },
    { methodType: 'CARD', feeRateBp: 250, effectiveFrom: kstDayStart('2026-08-11') },
    { methodType: 'TOSS', feeRateBp: 320, effectiveFrom: kstDayStart('2026-08-05') },
  ];

  it('시점 이하 중 가장 늦은 적용일의 요율을 고른다', () => {
    expect(resolveFeeRateBp(rates, 'CARD', kstDayStart('2026-08-10'))).toBe(290);
    expect(resolveFeeRateBp(rates, 'CARD', kstDayStart('2026-08-11'))).toBe(250);
    expect(resolveFeeRateBp(rates, 'CARD', kstDayStart('2026-08-20'))).toBe(250);
  });

  it('적용 시작 전이거나 결제수단 요율이 없으면 null', () => {
    expect(resolveFeeRateBp(rates, 'CARD', kstDayStart('2026-07-31'))).toBeNull();
    expect(resolveFeeRateBp(rates, 'NICEPAY', kstDayStart('2026-08-10'))).toBeNull();
    expect(resolveFeeRateBp([], 'CARD', kstDayStart('2026-08-10'))).toBeNull();
  });
});

describe('summarizeFees', () => {
  const rates = [
    { methodType: 'CARD', feeRateBp: 290, effectiveFrom: kstDayStart('2026-08-01') },
    { methodType: 'CARD', feeRateBp: 250, effectiveFrom: kstDayStart('2026-08-11') },
  ];

  it('요율 유무로 covered/uncovered 를 나누고 일별 요율을 적용한다', () => {
    const daily = [
      { methodType: 'CARD', day: '2026-08-10', amount: 100_000, count: 2 },
      { methodType: 'CARD', day: '2026-08-11', amount: 200_000, count: 3 },
      { methodType: 'TOSS', day: '2026-08-10', amount: 50_000, count: 1 },
    ];
    const result = summarizeFees(daily, new Map([['CARD', 30_000]]), rates, '2026-08-31');

    const card = result.find((row) => row.methodType === 'CARD');
    expect(card).toEqual({
      methodType: 'CARD',
      capturedAmount: 300_000,
      capturedCount: 5,
      refundedAmount: 30_000,
      coveredAmount: 300_000,
      uncoveredAmount: 0,
      // 100,000×2.9% + 200,000×2.5%
      estimatedFee: 2_900 + 5_000,
      appliedFeeRateBp: 250,
    });

    const toss = result.find((row) => row.methodType === 'TOSS');
    expect(toss).toEqual({
      methodType: 'TOSS',
      capturedAmount: 50_000,
      capturedCount: 1,
      refundedAmount: 0,
      coveredAmount: 0,
      uncoveredAmount: 50_000,
      estimatedFee: 0,
      appliedFeeRateBp: null,
    });
  });

  it('요율 시행 전 날짜 몫은 uncovered 로 분리된다', () => {
    const daily = [
      { methodType: 'CARD', day: '2026-07-31', amount: 10_000, count: 1 },
      { methodType: 'CARD', day: '2026-08-01', amount: 10_000, count: 1 },
    ];
    const [card] = summarizeFees(daily, new Map(), rates, '2026-08-01');
    expect(card.coveredAmount).toBe(10_000);
    expect(card.uncoveredAmount).toBe(10_000);
    expect(card.estimatedFee).toBe(290);
  });

  it('환불만 있는 결제수단도 행으로 나오고, 캡처 금액 내림차순 정렬', () => {
    const daily = [{ methodType: 'CARD', day: '2026-08-01', amount: 1_000, count: 1 }];
    const result = summarizeFees(daily, new Map([['BANK_TRANSFER', 5_000]]), rates, '2026-08-01');
    expect(result.map((row) => row.methodType)).toEqual(['CARD', 'BANK_TRANSFER']);
    expect(result[1].refundedAmount).toBe(5_000);
    expect(result[1].capturedAmount).toBe(0);
  });

  it('수수료는 일 단위 반올림 합', () => {
    const daily = [{ methodType: 'CARD', day: '2026-08-01', amount: 999, count: 1 }];
    const [card] = summarizeFees(daily, new Map(), rates, '2026-08-01');
    // 999 × 290 / 10000 = 28.971 → 29
    expect(card.estimatedFee).toBe(29);
  });
});
