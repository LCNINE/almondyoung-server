import { BadRequestError } from '@app/shared';
import {
  expandBoxLabel,
  ListCell,
  ListInput,
  normalizeBarcode,
  parseShipmentList,
} from './inbound-shipment-list.parser';

const c = (text: string, value: ListCell['value'] = text, formula?: string): ListCell => ({
  text,
  value,
  ...(formula ? { formula } : {}),
});

const HEADER = ['박스번호', 'NO', '제품명', '이미지', '수량', '옵션', '바코드', '총수량', '비고'];

interface RowSpec {
  box?: ListCell;
  no?: ListCell;
  name?: ListCell;
  qty?: ListCell;
  option?: ListCell;
  barcode?: ListCell;
  total?: ListCell;
  remark?: ListCell;
}

const row = (rowNumber: number, s: RowSpec) => ({
  rowNumber,
  cells: [
    s.box ?? c(''),
    s.no ?? c(''),
    s.name ?? c('샘플 상품'),
    c(''),
    s.qty ?? c('1', 1),
    s.option ?? c(''),
    s.barcode ?? c('10390520010'),
    s.total ?? c(''),
    s.remark ?? c(''),
  ],
});

const input = (rows: ReturnType<typeof row>[], header = HEADER): ListInput => ({ header, rows });

describe('parseShipmentList', () => {
  it('expands a range into one box per label', () => {
    expect(expandBoxLabel('L5-L9')).toEqual({ labels: ['L5', 'L6', 'L7', 'L8', 'L9'], issue: null });
    expect(expandBoxLabel('LM66-LM68')).toEqual({ labels: ['LM66', 'LM67', 'LM68'], issue: null });
    expect(expandBoxLabel('L5~L9').labels).toHaveLength(5);
    expect(expandBoxLabel('L5-9').labels).toEqual(['L5', 'L6', 'L7', 'L8', 'L9']);
    expect(expandBoxLabel(' l 1 ')).toEqual({ labels: ['L1'], issue: null });
  });

  it('guesses a dangling range', () => {
    expect(expandBoxLabel('L86-')).toEqual({ labels: ['L86'], issue: 'box_label_guess' });
  });

  it('rejects a reversed or huge range', () => {
    expect(expandBoxLabel('L9-L5')).toEqual({ labels: [], issue: 'box_range_invalid' });
    expect(expandBoxLabel('L1-L60')).toEqual({ labels: [], issue: 'box_range_invalid' });
  });

  it('reports a missing box label', () => {
    expect(expandBoxLabel('  ')).toEqual({ labels: [], issue: 'box_label_missing' });
  });

  it('same label on non-adjacent rows is one box', () => {
    const r = parseShipmentList(
      input([
        row(2, { box: c('L23') }),
        row(3, { box: c('L24') }),
        row(4, { box: c('L23') }),
      ]),
    );
    expect(r.boxes).toHaveLength(2);
    expect(r.boxes.map((b) => [b.label, b.sortKey])).toEqual([
      ['L23', 0],
      ['L24', 1],
    ]);
  });

  it('normalizes barcodes', () => {
    expect(normalizeBarcode(c('10390520010\n'))).toEqual({ barcode: '10390520010', issue: null });
    expect(normalizeBarcode(c('12655120005', 12655120005))).toEqual({
      barcode: '12655120005',
      issue: null,
    });
    expect(normalizeBarcode(c('="11211211211"'))).toEqual({ barcode: '11211211211', issue: null });
    expect(normalizeBarcode(c('176-23'))).toEqual({ barcode: null, issue: 'foreign_code' });
    expect(normalizeBarcode(c('장갑'))).toEqual({ barcode: null, issue: 'barcode_is_text' });
    expect(normalizeBarcode(c('메모 abc'), c('메모 abc'))).toEqual({
      barcode: null,
      issue: 'barcode_is_text',
    });
    expect(normalizeBarcode(c(''))).toEqual({ barcode: null, issue: 'barcode_missing' });
    expect(normalizeBarcode(null)).toEqual({ barcode: null, issue: 'barcode_missing' });
  });

  it('reads formula quantity', () => {
    const r = parseShipmentList(
      input([
        row(2, { box: c('L1'), qty: c('208', 208, '199+9') }),
        row(3, { box: c('L1'), qty: c('abc') }),
        row(4, { box: c('L1'), qty: c('0', 0) }),
        row(5, { box: c('L1'), qty: c('12', 12) }),
      ]),
    );
    expect(r.lines[0].expectedQty).toBe(208);
    expect(r.lines[0].issues).toContain('qty_formula');
    expect(r.lines[1].expectedQty).toBeNull();
    expect(r.lines[1].issues).toContain('qty_invalid');
    expect(r.lines[2].expectedQty).toBeNull();
    expect(r.lines[2].issues).toContain('qty_invalid');
    expect(r.lines[3].expectedQty).toBe(12);
    expect(r.lines[3].issues).toEqual([]);
  });

  it('flags a date-coerced option', () => {
    const r = parseShipmentList(
      input([row(2, { box: c('L1'), option: c('2026-01-03', '2026-01-03T00:00:00.000Z') })]),
    );
    expect(r.lines[0].issues).toContain('option_date_coerced');
    expect(r.lines[0].raw.option?.text).toBe('2026-01-03');
  });

  it('marks forward and contact hints', () => {
    const fwd = '도착하면 acme 에 발송바람:';
    const r = parseShipmentList(
      input([
        row(2, { box: c('L1'), remark: c(fwd) }),
        row(3, { box: c('L2'), remark: c('도착하면 ○○님께 연락바람') }),
      ]),
    );
    expect(r.lines[0].issues).toContain('forward_hint');
    expect(r.lines[1].issues).toContain('contact_hint');
    expect(r.boxes[0].forwardHint).toBe(fwd);
    expect(r.boxes[1].forwardHint).toBeNull();
  });

  it('ignores total and NO', () => {
    const r = parseShipmentList(
      input([row(2, { box: c('L1'), no: c(''), total: c('총수량:15개') })]),
    );
    expect(r.lines[0].issues).toEqual([]);
    expect(r.lines[0].raw.total?.text).toBe('총수량:15개');
  });

  it('creates no box for a line without a valid box label', () => {
    const r = parseShipmentList(input([row(2, { box: c('') })]));
    expect(r.boxes).toEqual([]);
    expect(r.lines[0].boxLabels).toEqual([]);
    expect(r.lines[0].issues).toContain('box_label_missing');
  });

  it('requires box, quantity and barcode columns', () => {
    const header = HEADER.filter((h) => h !== '바코드');
    expect(() => parseShipmentList({ header, rows: [] })).toThrow(BadRequestError);
  });

  it('caps rows at 2000', () => {
    const blank = (n: number) => ({ rowNumber: n, cells: HEADER.map(() => c('')) });
    const data = (n: number) => row(n, { box: c('L1') });
    const tooMany = Array.from({ length: 2001 }, (_, i) => data(i + 2));
    expect(() => parseShipmentList(input(tooMany))).toThrow(BadRequestError);
    const ok = [
      ...Array.from({ length: 1000 }, (_, i) => blank(i + 2)),
      ...Array.from({ length: 2000 }, (_, i) => data(i + 1002)),
    ];
    expect(parseShipmentList(input(ok)).lines).toHaveLength(2000);
  });

  it('rejects duplicate rowNumber', () => {
    expect(() => parseShipmentList(input([row(5, { box: c('L1') }), row(5, { box: c('L2') })]))).toThrow(
      BadRequestError,
    );
  });
});
