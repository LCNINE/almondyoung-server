/**
 * 셀메이트 sync-stock 파싱/검증 로직 회귀 테스트 (DB 불필요).
 * 리뷰 [높음] "잘못된 재고 문자열이 0 으로 변해 전량 차감" 시나리오를 고정한다.
 * (동시성/원자성은 트랜잭션+advisory lock+FOR UPDATE 로 처리되며 DB 통합환경에서 검증)
 */
import { parseStock, parseStockRows } from './sync-stock';

describe('parseStock — 비음수 정수만 허용', () => {
  it('정상 정수/콤마 구분자를 파싱한다', () => {
    expect(parseStock('0')).toBe(0);
    expect(parseStock('42')).toBe(42);
    expect(parseStock('1,234')).toBe(1234);
    expect(parseStock(' 7 ')).toBe(7);
  });

  it('빈값·문자·소수·음수는 0 으로 추정하지 않고 null(=오류) 을 돌린다', () => {
    expect(parseStock('')).toBeNull();
    expect(parseStock('   ')).toBeNull();
    expect(parseStock('N/A')).toBeNull();
    expect(parseStock('1.5')).toBeNull();
    expect(parseStock('-3')).toBeNull(); // 음수 → 조용히 0 clamp 금지
    expect(parseStock('1e3')).toBeNull();
    expect(parseStock('abc')).toBeNull();
  });
});

describe('parseStockRows', () => {
  const HEADER = ['옵션정보일련번호', '현재재고', '미발송주문수'];
  const rows = (...rs: [string, string, string][]): string[][] => [HEADER, ...rs];

  it('itemCode 가 빈 행은 건너뛴다', () => {
    const { targets, errors } = parseStockRows(rows(['I1', '5', '0'], ['', '9', '0']), 'f.xls', true);
    expect(targets).toEqual([{ itemCode: 'I1', target: 5 }]);
    expect(errors).toHaveLength(0);
  });

  it('형식 오류 행은 targets 가 아니라 errors 로 모은다(행번호 보존)', () => {
    const { targets, errors } = parseStockRows(
      rows(['I1', '5', '0'], ['I2', '바보', '0'], ['I3', '-1', '0']),
      'f.xls',
      true,
    );
    expect(targets).toEqual([{ itemCode: 'I1', target: 5 }]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ itemCode: 'I2', raw: '바보', rowNumber: 2 });
    expect(errors[1]).toMatchObject({ itemCode: 'I3', raw: '-1', rowNumber: 3 });
  });

  // 셀메이트 '현재재고' 는 미발송 주문분을 포함한 물리 재고다. 그대로 넣으면 이미 팔린 걸 또 판다.
  it('현재재고에서 미발송주문수를 뺀 값을 목표로 삼는다', () => {
    const { targets } = parseStockRows(rows(['I1', '17', '1'], ['I2', '43', '1'], ['I3', '15', '0']), 'f.xls', true);
    expect(targets).toEqual([
      { itemCode: 'I1', target: 16 },
      { itemCode: 'I2', target: 42 },
      { itemCode: 'I3', target: 15 },
    ]);
  });

  it('미발송이 현재고보다 많으면(오버셀) 음수가 아니라 0 으로 본다', () => {
    const { targets } = parseStockRows(rows(['I1', '2', '5']), 'f.xls', true);
    expect(targets).toEqual([{ itemCode: 'I1', target: 0 }]);
  });

  it("'미발송주문수' 열이 없는 CSV 는 조용히 넘기지 않고 중단한다", () => {
    const legacy = [['옵션정보일련번호', '현재재고'], ['I1', '5']];
    expect(() => parseStockRows(legacy, 'f.xls', true)).toThrow(/미발송주문수/);
  });
});
