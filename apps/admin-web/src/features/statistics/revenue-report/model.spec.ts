import {
  HEADERS,
  parseExternalRevenue,
  revenueSummary,
  externalMonthlyStatistics,
} from './model';

describe('업로드 자료 월별 통계', () => {
  it('계정과 기준을 구분하며 미수집월과 실제 0원, 음수, 다른 연도를 구분한다', () => {
    const source = {
      channel: 'coupang',
      account: '일반판매',
      basis: 'paid',
      source: '월별 원본',
    };
    const result = externalMonthlyStatistics(
      [
        { ...source, month: '2026-01', amount: 0 },
        { ...source, month: '2026-02', amount: -100 },
        { ...source, month: '2025-01', amount: 999 },
        { ...source, account: '로켓', month: '2026-01', amount: 200 },
        { ...source, basis: 'tax_report', month: '2026-01', amount: 300 },
      ],
      2026
    );
    expect(result.series).toHaveLength(3);
    expect(result.months).toHaveLength(12);
    expect(result.months[0]).toEqual({
      month: '2026-01',
      series0: 0,
      series1: 200,
      series2: 300,
    });
    expect(result.months[1].series0).toBe(-100);
    expect(result.months[2].series0).toBeNull();
  });
});

const row = [
  'coupang',
  '중개 계정',
  '2026-01',
  'purchase_confirmed',
  '9,060,970',
  '월별 자료',
];

describe('외부 채널 월별 취합', () => {
  it('원 단위 금액을 읽고 0과 음수도 보존한다', () => {
    expect(parseExternalRevenue([HEADERS, row])[0].amount).toBe(9060970);
    expect(
      parseExternalRevenue([HEADERS, [...row.slice(0, 4), 0, '원본']])[0].amount
    ).toBe(0);
    expect(
      parseExternalRevenue([HEADERS, [...row.slice(0, 4), -10, '원본']])[0]
        .amount
    ).toBe(-10);
  });

  it.each(['', '원', '1.5', 'Infinity', ',', '1,2', '0x10', '1e3'])(
    '잘못된 금액 %s를 0으로 조용히 바꾸지 않는다',
    (amount) => {
      expect(() =>
        parseExternalRevenue([HEADERS, [...row.slice(0, 4), amount, '원본']])
      ).toThrow();
    }
  );

  it('중복 행, 잘못된 월, 출처 누락, 알 수 없는 원본 헤더를 거부한다', () => {
    expect(() => parseExternalRevenue([HEADERS, row, row])).toThrow();
    expect(() =>
      parseExternalRevenue([
        HEADERS,
        [row[0], row[1], '2026-13', ...row.slice(3)],
      ])
    ).toThrow();
    expect(() =>
      parseExternalRevenue([HEADERS, [...row.slice(0, 5), '']])
    ).toThrow();
    expect(() => parseExternalRevenue([['정산액'], [100]])).toThrow();
  });

  it('같은 달이라도 계정이나 매출 기준이 다르면 각각 보존한다', () => {
    expect(
      parseExternalRevenue([
        HEADERS,
        row,
        ['coupang', '로켓그로스', '2026-01', 'paid', 10, '원본'],
      ])
    ).toHaveLength(2);
  });
});

describe('세무사 확인용 요약', () => {
  it('한글 양식을 읽으며 기존 영문 양식도 유지한다', () => {
    const parsed = parseExternalRevenue([
      HEADERS,
      ['스마트스토어', '계정', '2026-01', '구매확정', 100, '원본'],
    ]);
    expect(parsed[0]).toMatchObject({
      channel: 'naver',
      basis: 'purchase_confirmed',
      amount: 100,
    });
  });

  it('계정과 기준을 분리하고 실제 0원 등록과 미수집월을 구별한다', () => {
    const report = {
      year: 2026,
      daily: [],
      external: parseExternalRevenue([
        HEADERS,
        ['쿠팡', 'A', '2026-01', '구매확정', 100, '원본'],
        ['쿠팡', 'A', '2026-03', '구매확정', 0, '원본'],
        ['쿠팡', 'A', '2026-01', '결제완료', 200, '원본'],
        ['쿠팡', 'B', '2026-01', '구매확정', 300, '원본'],
      ]),
    };
    const totals = revenueSummary(report, 3);
    expect(totals).toHaveLength(3);
    expect(totals[0]).toMatchObject({
      확인금액: 100,
      등록월: '01, 03',
      미등록월: '02',
    });
    expect(totals[1].확인금액).toBe(200);
    expect(totals[2].확인금액).toBe(300);
  });
});

describe('대조 상태와 교체 비교', () => {
  it('카페24 운영 금액을 별도 기준으로 보존하고 확인 근거를 요구한다', () => {
    const headers = [
      ...HEADERS,
      '원본확보',
      '월별대조',
      '중복확인',
      '입금대조',
      '대조메모',
    ];
    const cafe = [
      '카페24',
      '테스트몰',
      '2026-01',
      '운영 순매출',
      -200,
      '화면 조회',
      '확인',
      '미확인',
      '미확인',
      '미확인',
      '원본 1개 확보, 금액 차이 확인 중',
    ];
    const parsed = parseExternalRevenue([headers, cafe])[0];
    expect(parsed).toMatchObject({
      channel: 'cafe24',
      basis: 'operational_net',
      amount: -200,
      originalStatus: 'confirmed',
      monthlyStatus: 'pending',
    });
    expect(() =>
      parseExternalRevenue([headers, [...cafe.slice(0, 10), '']])
    ).toThrow('확인 근거');
    expect(() =>
      parseExternalRevenue([
        headers,
        [...cafe.slice(0, 6), '완료', ...cafe.slice(7)],
      ])
    ).toThrow('대조 상태');
  });
});
