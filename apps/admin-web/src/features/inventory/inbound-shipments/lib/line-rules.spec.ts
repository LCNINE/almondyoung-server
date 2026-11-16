import type { LineIssueCode } from '@/lib/types/dto/inbound-shipment';
import { box, line, shipment } from './fixtures.spec-helper';
import {
  boxRangeText,
  cellDisplayText,
  differenceText,
  hasDifference,
  isValidLineQty,
  issueLabel,
  lineEditability,
  needsAttention,
  prefillSearchText,
  skuSearchQueries,
  WARNING_ISSUES,
} from './line-rules';

const ALL: LineIssueCode[] = [
  'box_label_guess',
  'box_label_missing',
  'box_range_invalid',
  'box_label_too_long',
  'qty_formula',
  'qty_invalid',
  'barcode_missing',
  'barcode_is_text',
  'foreign_code',
  'barcode_not_found',
  'barcode_ambiguous',
  'packing_unit_barcode',
  'option_date_coerced',
  'forward_hint',
  'contact_hint',
];

describe('needsAttention', () => {
  it('미확인 줄은 true', () =>
    expect(needsAttention(line({ kind: 'unresolved' }))).toBe(true));
  it('경고 코드가 하나라도 있으면 true', () =>
    expect(
      needsAttention(line({ kind: 'sku', issues: ['box_label_guess'] }))
    ).toBe(true));
  it('표시만 하는 코드는 false', () =>
    expect(
      needsAttention(
        line({ kind: 'sku', issues: ['contact_hint', 'forward_hint'] })
      )
    ).toBe(false));
  it('깨끗한 줄은 false', () => expect(needsAttention(line())).toBe(false));
  it('경고 코드 집합', () =>
    expect([...WARNING_ISSUES].sort()).toEqual(
      [
        'box_label_guess',
        'box_range_invalid',
        'qty_formula',
        'option_date_coerced',
        'packing_unit_barcode',
      ].sort()
    ));
});

describe('issueLabel', () => {
  it.each(ALL)('%s 는 빈 문자열이 아니다', (code) =>
    expect(issueLabel(code).length).toBeGreaterThan(0)
  );
});

describe('prefillSearchText', () => {
  it('제품명을 trim 한다', () =>
    expect(
      prefillSearchText(
        line({ raw: { productName: { text: '  샘플 상품 ', value: null } } })
      )
    ).toBe('샘플 상품'));
  it('없으면 빈 문자열', () => {
    expect(prefillSearchText(line({ raw: { productName: null } }))).toBe('');
    expect(prefillSearchText(line({ raw: {} }))).toBe('');
  });
  it('옵션은 넣지 않는다', () =>
    expect(
      prefillSearchText(
        line({
          raw: {
            productName: { text: '상품', value: null },
            option: { text: '빨강', value: null },
          },
        })
      )
    ).toBe('상품'));
});

describe('skuSearchQueries', () => {
  it('숫자 8자리 이상은 바코드·코드', () =>
    expect(skuSearchQueries('10390520010')).toEqual([
      { barcode: '10390520010' },
      { code: '10390520010' },
    ]));
  it('공백은 빈 배열', () => expect(skuSearchQueries('  ')).toEqual([]));
  it('7자리 숫자는 이름', () =>
    expect(skuSearchQueries('1234567')).toEqual([{ name: '1234567' }]));
  it('trim 한다', () =>
    expect(skuSearchQueries(' 샘플 ')).toEqual([{ name: '샘플' }]));
  it('8자리 경계', () => expect(skuSearchQueries('12345678')).toHaveLength(2));
});

describe('lineEditability', () => {
  const l = line({ coversBoxLabels: ['A1', 'A2'] });
  const boxes = [
    box({ id: 'b1', label: 'A1' }),
    box({ id: 'b2', label: 'A2', sortKey: 2 }),
  ];

  it('초안은 가능', () =>
    expect(lineEditability(shipment({ status: 'draft', boxes }), l)).toEqual({
      editable: true,
    }));
  it('expected 이고 덮는 상자가 전부 열림 → 가능', () =>
    expect(lineEditability(shipment({ status: 'expected', boxes }), l)).toEqual(
      { editable: true }
    ));
  it('receiving 이고 덮는 상자가 전부 열림 → 가능', () =>
    expect(
      lineEditability(shipment({ status: 'receiving', boxes }), l)
    ).toEqual({ editable: true }));
  it('받은 상자가 있으면 불가', () =>
    expect(
      lineEditability(
        shipment({
          status: 'receiving',
          boxes: [boxes[0], { ...boxes[1], status: 'received' }],
        }),
        l
      )
    ).toEqual({
      editable: false,
      reason: '받은 상자가 있어 고칠 수 없습니다',
    }));
  it('덮지 않는 상자가 받아졌어도 가능', () =>
    expect(
      lineEditability(
        shipment({
          status: 'receiving',
          boxes: [...boxes, box({ id: 'b3', label: 'Z9', status: 'received' })],
        }),
        l
      )
    ).toEqual({ editable: true }));
  it('closed 는 상자가 전부 열려 있어도 불가(다시 열어야 함)', () =>
    expect(lineEditability(shipment({ status: 'closed', boxes }), l)).toEqual({
      editable: false,
      reason: '끝난 선적입니다. 다시 열어야 고칠 수 있습니다',
    }));
  it('canceled 는 불가', () =>
    expect(lineEditability(shipment({ status: 'canceled', boxes }), l)).toEqual(
      {
        editable: false,
        reason: '취소된 선적입니다',
      }
    ));
});

describe('differenceText', () => {
  const covered = [
    box({ status: 'received' }),
    box({ id: 'b2', label: 'A2', status: 'open' }),
  ];
  const d = (
    state: 'pending' | 'not_arrived' | 'match' | 'short' | 'over',
    counted: number,
    expected: number | null
  ) => line({ difference: { state, counted, expected } });

  it('pending', () =>
    expect(differenceText(d('pending', 0, 10), covered)).toBe(
      '진행 중 (받은 상자 1/2)'
    ));
  it('match', () =>
    expect(differenceText(d('match', 10, 10), covered)).toBe('맞음'));
  it('short', () =>
    expect(differenceText(d('short', 7, 10), covered)).toBe('모자람 3'));
  it('over', () =>
    expect(differenceText(d('over', 12, 10), covered)).toBe('남음 2'));
  it('not_arrived', () =>
    expect(differenceText(d('not_arrived', 0, 10), covered)).toBe('안 옴'));
});

describe('hasDifference', () => {
  const withState = (
    state: 'pending' | 'not_arrived' | 'match' | 'short' | 'over'
  ) => line({ difference: { state, counted: 0, expected: 1 } });
  it('모자람·남음·안 옴만 true', () => {
    expect(hasDifference(withState('short'))).toBe(true);
    expect(hasDifference(withState('over'))).toBe(true);
    expect(hasDifference(withState('not_arrived'))).toBe(true);
  });
  it('맞음·진행 중은 false', () => {
    expect(hasDifference(withState('match'))).toBe(false);
    expect(hasDifference(withState('pending'))).toBe(false);
  });
});

describe('isValidLineQty', () => {
  it('1~1,000,000 정수만 맞다', () => {
    expect(isValidLineQty('1')).toBe(true);
    expect(isValidLineQty('1000000')).toBe(true);
    expect(isValidLineQty('0')).toBe(false);
    expect(isValidLineQty('1000001')).toBe(false);
    expect(isValidLineQty('1.5')).toBe(false);
    expect(isValidLineQty('')).toBe(false);
    expect(isValidLineQty('-3')).toBe(false);
  });
});

describe('cellDisplayText', () => {
  it('정수 number 는 지수 표기 없이 펼친다', () => {
    expect(cellDisplayText({ text: '8.80123E+12', value: 8801234567890 })).toBe(
      '8801234567890'
    );
  });
  it('그 밖에는 text 그대로', () => {
    expect(cellDisplayText({ text: '1.5', value: 1.5 })).toBe('1.5');
    expect(cellDisplayText({ text: 'abc', value: 'abc' })).toBe('abc');
    expect(cellDisplayText({ text: '', value: null })).toBe('');
  });
});

describe('boxRangeText', () => {
  it('연속 구간만 ~ 로 묶고 나머지는 쉼표', () => {
    expect(boxRangeText(['L1', 'L2', 'L3'])).toBe('L1~L3');
    expect(boxRangeText(['L1', 'L5'])).toBe('L1, L5');
    expect(boxRangeText(['L1', 'L5', 'L6', 'L7'])).toBe('L1, L5~L7');
    expect(boxRangeText(['L3'])).toBe('L3');
    expect(boxRangeText([])).toBe('');
  });
  it('접두사가 다르면 잇지 않는다', () => {
    expect(boxRangeText(['A1', 'B2'])).toBe('A1, B2');
  });
  it('0 채움 자릿수를 지킨다', () => {
    expect(boxRangeText(['L05', 'L06', 'L07'])).toBe('L05~L07');
    expect(boxRangeText(['L9', 'L10'])).toBe('L9~L10');
  });
  it('두 개 연속은 ~ 로 묶는다', () => {
    expect(boxRangeText(['L1', 'L2'])).toBe('L1~L2');
  });
});
