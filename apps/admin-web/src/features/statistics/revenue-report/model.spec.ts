import { HEADERS, parseExternalRevenue, revenueSummary } from './model';

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
