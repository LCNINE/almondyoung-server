/**
 * 셀메이트 주문 이력 → 수요 시계열 시드의 파싱 · 집계 · D0 규칙 회귀 테스트 (DB 불필요).
 */
import {
  aggregateDaily,
  parseDate,
  parseDemandRows,
  parseNumber,
  resolveCoreSince,
  splitByCoreSince,
  unmatchedCsv,
} from './import-demand-history';

const HEADER = ['옵션정보일련번호', '주문일', '수량', '결제금액'];
type Row = [code: string, date: string, qty: string, amount: string];
const rows = (...rs: Row[]): string[][] => [HEADER, ...rs];

describe('parseDate', () => {
  it('셀메이트 날짜 표기 넷을 YYYY-MM-DD 로', () => {
    expect(parseDate('2026-07-01')).toBe('2026-07-01');
    expect(parseDate('2026.7.1')).toBe('2026-07-01');
    expect(parseDate('2026-07-01 오후 4:21:00')).toBe('2026-07-01');
    expect(parseDate('2026/07/01 16:21')).toBe('2026-07-01');
  });
  it('못 읽으면 null', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('7월 1일')).toBeNull();
    expect(parseDate('2026-13-01')).toBeNull();
  });
});

describe('parseNumber', () => {
  it('천 단위 구분자 · 원 표기 · 빈값', () => {
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber('12,000원')).toBe(12000);
    expect(parseNumber('3')).toBe(3);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('-')).toBeNull();
  });
});

describe('parseDemandRows', () => {
  it('코드 · 날짜 · 수량이 있는 행만, 금액은 없으면 null', () => {
    const { rows: parsed, skipped } = parseDemandRows(
      rows(['I1', '2026-07-01', '2', '5,000'], ['I2', '2026.7.2', '1', ''], ['', '2026-07-01', '1', '1'], ['I3', '', '1', '1'], ['I4', '2026-07-01', '0', '1']),
      'orders.xls',
      true,
    );
    expect(parsed).toEqual([
      { itemCode: 'I1', date: '2026-07-01', qty: 2, amount: 5000 },
      { itemCode: 'I2', date: '2026-07-02', qty: 1, amount: null },
    ]);
    expect(skipped.get('코드 없음')).toBe(1);
    expect(skipped.get('주문일 없음')).toBe(1);
    expect(skipped.get('수량 0 이하')).toBe(1);
  });

  it('필수 열(코드 · 주문일 · 수량)이 없으면 던진다', () => {
    expect(() => parseDemandRows([['상품명', '주문일', '수량'], ['x', '2026-07-01', '1']], 'f.xls', true)).toThrow(/옵션정보일련번호/);
  });

  it('="…" 로 감싼 코드는 parse.ts 가 벗기므로 그대로 온다고 가정한다 — 앞뒤 공백만 제거', () => {
    const { rows: parsed } = parseDemandRows(rows([' I1 ', '2026-07-01', '1', '1']), 'f.xls', true);
    expect(parsed[0].itemCode).toBe('I1');
  });
});

describe('aggregateDaily', () => {
  it('같은 코드 · 같은 날은 합치고, 금액은 하나라도 있으면 있는 것의 합', () => {
    const agg = aggregateDaily([
      { itemCode: 'I1', date: '2026-07-01', qty: 2, amount: 5000 },
      { itemCode: 'I1', date: '2026-07-01', qty: 3, amount: null },
      { itemCode: 'I1', date: '2026-07-02', qty: 1, amount: null },
      { itemCode: 'I2', date: '2026-07-01', qty: 1, amount: 100 },
    ]);
    expect(agg.get('I1')?.get('2026-07-01')).toEqual({ qty: 5, amount: 5000 });
    expect(agg.get('I1')?.get('2026-07-02')).toEqual({ qty: 1, amount: null });
    expect(agg.get('I2')?.get('2026-07-01')).toEqual({ qty: 1, amount: 100 });
  });
});

describe('resolveCoreSince — D0', () => {
  it('설정에 이미 있으면 그 값. 인자가 다르면 경고하고 덮어쓰지 않는다', () => {
    expect(resolveCoreSince('2026-07-10', '2026-07-01', '2026-06-01')).toEqual({ value: '2026-07-01', warning: expect.stringContaining('덮어쓰지') });
    expect(resolveCoreSince(null, '2026-07-01', null)).toEqual({ value: '2026-07-01', warning: null });
  });
  it('없으면 인자, 인자도 없으면 core 최초 주문일', () => {
    expect(resolveCoreSince('2026-07-10', null, '2026-06-01')).toEqual({ value: '2026-07-10', warning: null });
    expect(resolveCoreSince(null, null, '2026-06-01')).toEqual({ value: '2026-06-01', warning: null });
  });
  it('셋 다 없으면 null + 경고 (core 주문이 아직 없다)', () => {
    expect(resolveCoreSince(null, null, null)).toEqual({ value: null, warning: expect.stringContaining('core 주문') });
  });
});

describe('splitByCoreSince', () => {
  it('D0 이전만 시드하고 D0 당일 이후는 뺀다', () => {
    const r = splitByCoreSince([{ date: '2026-06-30' }, { date: '2026-07-01' }, { date: '2026-07-02' }], '2026-07-01');
    expect(r.before.map((x) => x.date)).toEqual(['2026-06-30']);
    expect(r.onOrAfter.map((x) => x.date)).toEqual(['2026-07-01', '2026-07-02']);
  });
  it('D0 가 null 이면 전부 시드', () => {
    expect(splitByCoreSince([{ date: '2026-07-01' }], null).before).toHaveLength(1);
  });
});

describe('unmatchedCsv', () => {
  it('BOM + 헤더 + 따옴표 이스케이프', () => {
    const csv = unmatchedCsv([{ itemCode: 'I"1', qty: 3, days: 2 }]);
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv.split('\n')).toEqual(['\ufeff옵션정보일련번호,수량합,발생일수', '"I""1","3","2"']);
  });
});
