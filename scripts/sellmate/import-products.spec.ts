/**
 * 셀메이트 import 파싱/계획 로직 회귀 테스트 (DB 불필요, 순수 함수).
 * 리뷰에서 제기된 두 [치명] 시나리오를 고정한다:
 *   1) 빈 상품코드 옵션상품이 itemCode 로 분리되지 않고 상품일련번호로 묶이는가
 *   2) 파일 간 중복 행이 단일상품을 옵션상품으로 둔갑시키지 않는가(먼저 dedup)
 */
import { parseFile, buildPlan, dedupeByItemCode } from './import-products';

// 후보 헤더와 정확히 일치하는 최소 헤더(detectColumns 가 norm 비교).
const HEADER = ['상품코드', '상품일련번호', '상품명', '옵션정보일련번호', '옵션명', '바코드번호(서식)'];
type Row = [pc: string, serial: string, name: string, item: string, opt: string, bc: string];
const rows = (...rs: Row[]): string[][] => [HEADER, ...rs];

describe('parseFile', () => {
  it('itemCode 가 빈 행은 건너뛰고, 단일상품 sentinel 옵션명은 빈값으로 정규화한다', () => {
    const items = parseFile(
      rows(
        ['P1', '100', '상품1', 'I1', '단일상품', 'B1'],
        ['', '', '', '', '', ''], // itemCode 없음 → skip
        ['P2', '101', '상품2', 'I2', '빨강', 'B2'],
      ),
      'f.xls',
      true,
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ itemCode: 'I1', optionName: '' }); // sentinel 제거
    expect(items[1]).toMatchObject({ itemCode: 'I2', optionName: '빨강' });
  });

  it('상품코드를 itemCode 로 대체하지 않는다(빈 상품코드는 빈 채로 유지)', () => {
    const items = parseFile(rows(['', '200', '상품', 'IX', '옵션', 'BX']), 'f.xls', true);
    expect(items[0].productCode).toBe('');
    expect(items[0].productSerial).toBe('200');
  });
});

describe('buildPlan — [치명] 빈 상품코드 옵션 분리 방지', () => {
  it('상품코드가 비어도 같은 상품일련번호의 옵션들을 하나의 그룹으로 묶는다', () => {
    const items = parseFile(
      rows(
        ['', '26551', '마스트 ULTRA', 'A1', '실버1개', 'BA1'],
        ['', '26551', '마스트 ULTRA', 'A2', '블랙1개', 'BA2'],
        ['', '26551', '마스트 ULTRA', 'A3', '레드1개', 'BA3'],
      ),
      'f.xls',
      true,
    );
    const { groups, skus, invalid } = buildPlan(dedupeByItemCode(items));
    expect(invalid).toHaveLength(0);
    expect(groups).toHaveLength(1); // 3개로 쪼개지지 않음
    expect(groups[0].code).toBe('sm-26551'); // 상품코드 없으니 합성 코드
    expect(skus).toHaveLength(3);
    expect(skus.every((s) => s.groupCode === 'sm-26551')).toBe(true);
  });

  it('상품코드가 있으면 그 코드를 그룹 코드로 쓴다', () => {
    const items = parseFile(
      rows(['P9', '300', '상품', 'A1', '옵션1', 'B1'], ['P9', '300', '상품', 'A2', '옵션2', 'B2']),
      'f.xls',
      true,
    );
    const { groups } = buildPlan(dedupeByItemCode(items));
    expect(groups).toHaveLength(1);
    expect(groups[0].code).toBe('P9');
  });

  it('상품일련번호·상품코드가 둘 다 빈 행은 invalid 로 보고한다', () => {
    const items = parseFile(rows(['', '', '상품', 'A1', '옵션', 'B1']), 'f.xls', true);
    const { invalid } = buildPlan(items); // dedup 없이도 식별
    expect(invalid).toHaveLength(1);
    expect(invalid[0].itemCode).toBe('A1');
  });

  it('옵션 없는 단일상품(품목 1개 + 옵션명 없음)은 그룹 없이 단독 SKU 가 된다', () => {
    const items = parseFile(rows(['', '400', '단일', 'S1', '단일상품', 'B1']), 'f.xls', true);
    const { groups, skus } = buildPlan(dedupeByItemCode(items));
    expect(groups).toHaveLength(0);
    expect(skus).toHaveLength(1);
    expect(skus[0].groupCode).toBeNull();
  });
});

describe('buildPlan — [치명] 파일 간 중복이 단일상품을 옵션상품으로 바꾸지 않음', () => {
  it('같은 itemCode 가 두 파일에 있어도 dedup 후엔 단독 SKU 로 남는다', () => {
    const fileA = parseFile(rows(['', '500', '단일', 'DUP', '단일상품', 'B1']), 'a.xls', true);
    const fileB = parseFile(rows(['', '500', '단일', 'DUP', '단일상품', 'B1']), 'b.xls', true);
    const deduped = dedupeByItemCode([...fileA, ...fileB]);
    expect(deduped).toHaveLength(1); // 중복 제거
    const { groups, skus } = buildPlan(deduped);
    expect(groups).toHaveLength(0); // 옵션상품으로 둔갑하지 않음
    expect(skus).toHaveLength(1);
  });

  it('dedup 은 마지막(나중) 항목 값을 우선한다', () => {
    const fileA = parseFile(rows(['', '600', '옛이름', 'X', '단일상품', 'OLD']), 'a.xls', true);
    const fileB = parseFile(rows(['', '600', '새이름', 'X', '단일상품', 'NEW']), 'b.xls', true);
    const deduped = dedupeByItemCode([...fileA, ...fileB]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].productName).toBe('새이름');
    expect(deduped[0].barcode).toBe('NEW');
  });
});
