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
  const HEADER = ['옵션정보일련번호', '현재재고'];
  const rows = (...rs: [string, string][]): string[][] => [HEADER, ...rs];

  it('itemCode 가 빈 행은 건너뛴다', () => {
    const { targets, errors } = parseStockRows(rows(['I1', '5'], ['', '9']), 'f.xls', true);
    expect(targets).toEqual([{ itemCode: 'I1', target: 5 }]);
    expect(errors).toHaveLength(0);
  });

  it('형식 오류 행은 targets 가 아니라 errors 로 모은다(행번호 보존)', () => {
    const { targets, errors } = parseStockRows(rows(['I1', '5'], ['I2', '바보'], ['I3', '-1']), 'f.xls', true);
    expect(targets).toEqual([{ itemCode: 'I1', target: 5 }]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ itemCode: 'I2', raw: '바보', rowNumber: 2 });
    expect(errors[1]).toMatchObject({ itemCode: 'I3', raw: '-1', rowNumber: 3 });
  });
});
