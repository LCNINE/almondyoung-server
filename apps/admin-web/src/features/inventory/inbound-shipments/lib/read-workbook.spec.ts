import * as XLSX from 'xlsx';
import {
  readInboundShipmentWorkbook,
  WorkbookReadError,
} from './read-workbook';

type Sheets = Array<{ name: string; ws: XLSX.WorkSheet }>;

function toBytes(sheets: Sheets): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, s.ws, s.name);
  const out: ArrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return out;
}

const one = (ws: XLSX.WorkSheet): ArrayBuffer =>
  toBytes([{ name: 'Sheet1', ws }]);
const HEADER = [
  '박스번호',
  'NO',
  '제품명',
  '이미지',
  '수량',
  '옵션',
  '바코드',
  '총수량',
  '비고',
];

describe('readInboundShipmentWorkbook', () => {
  it('병합 칸의 값을 범위 전체에 채운다', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['박스번호', '수량'],
      ['L5-L9', 1],
      [null, 2],
      [null, 3],
    ]);
    ws['!merges'] = [XLSX.utils.decode_range('A2:A4')];
    const r = readInboundShipmentWorkbook(one(ws));
    expect(r.rows.map((x) => x.cells[0].text)).toEqual([
      'L5-L9',
      'L5-L9',
      'L5-L9',
    ]);
  });

  it('머리글은 첫 비어 있지 않은 행이다', () => {
    const ws = XLSX.utils.aoa_to_sheet([[], ['박스번호', '수량'], ['L1', 5]]);
    const r = readInboundShipmentWorkbook(one(ws));
    expect(r.header).toEqual(['박스번호', '수량']);
    expect(r.rows[0].rowNumber).toBe(3);
  });

  it('중간 빈 행은 남기고 번호를 건너뛰지 않으며 dataRowCount 는 빈 행을 세지 않는다', () => {
    const ws = XLSX.utils.aoa_to_sheet([['a', 'b'], ['L1', 1], [], ['L2', 2]]);
    const r = readInboundShipmentWorkbook(one(ws));
    expect(r.rows.map((x) => x.rowNumber)).toEqual([2, 3, 4]);
    expect(r.dataRowCount).toBe(2);
  });

  it('끝의 빈 행·빈 열을 자른다', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      HEADER,
      ['L1', 1, 'x', '', 3, '', '1234567890123', 3, ''],
      ['L2', 2, 'y', '', 4, '', '1234567890124', 4, ''],
    ]);
    ws['!ref'] = 'A1:Z1000';
    const r = readInboundShipmentWorkbook(one(ws));
    expect(r.header).toHaveLength(9);
    expect(r.rows).toHaveLength(2);
    for (const row of r.rows) expect(row.cells).toHaveLength(9);
  });

  it('수식 칸은 formula 를 싣는다', () => {
    const ws = XLSX.utils.aoa_to_sheet([['수량'], [0]]);
    ws['A2'] = { t: 'n', v: 208, f: '199+9' };
    const r = readInboundShipmentWorkbook(one(ws));
    expect(r.rows[0].cells[0]).toEqual({
      text: '208',
      value: 208,
      formula: '199+9',
    });
  });

  it('숫자 바코드는 숫자 그대로 둔다', () => {
    const ws = XLSX.utils.aoa_to_sheet([['바코드'], [10390520010]]);
    const r = readInboundShipmentWorkbook(one(ws));
    expect(r.rows[0].cells[0].value).toBe(10390520010);
  });

  it('날짜 칸은 ISO 문자열 value 와 표시 text 를 갖는다', () => {
    const ws = XLSX.utils.aoa_to_sheet(
      [['옵션'], [new Date(Date.UTC(2026, 9, 1))]],
      { cellDates: true }
    );
    const r = readInboundShipmentWorkbook(one(ws));
    const cell = r.rows[0].cells[0];
    expect(typeof cell.value).toBe('string');
    expect(cell.value).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(cell.text).not.toBe('');
    expect(cell.text).not.toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('첫 시트가 비면 데이터 있는 시트를 쓴다', () => {
    const empty = XLSX.utils.aoa_to_sheet([]);
    const data = XLSX.utils.aoa_to_sheet([['박스번호'], ['L1']]);
    const r = readInboundShipmentWorkbook(
      toBytes([
        { name: '빈', ws: empty },
        { name: '데이터', ws: data },
      ])
    );
    expect(r.sheetName).toBe('데이터');
  });

  it('모든 시트가 비면 WorkbookReadError', () => {
    expect(() =>
      readInboundShipmentWorkbook(one(XLSX.utils.aoa_to_sheet([])))
    ).toThrow(WorkbookReadError);
  });

  it('엑셀이 아닌 바이트는 WorkbookReadError', () => {
    expect(() =>
      readInboundShipmentWorkbook(new TextEncoder().encode('hello').buffer)
    ).toThrow(WorkbookReadError);
  });
});
