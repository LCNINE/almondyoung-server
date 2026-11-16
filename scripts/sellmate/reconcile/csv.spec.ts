/**
 * 저녁 맞추기 CSV 읽기·쓰기 테스트 (DB 불필요).
 * 픽스처에 실제 품목명·바코드 금지 — TEST-0001, 8800000000001 꼴만 쓴다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as iconv from 'iconv-lite';
import { parseReconcileStock, parseSignedInt, readStockCsv } from './stock-csv';
import { parseOwnMallDisplayIds } from './orders-csv';
import { renderUploadCsv, writeUploadCsv } from './upload-csv';

// parse.ts 의 papaparse 기본 import 는 jest(esModuleInterop 없음)에서 못 뜬다 — 파일 읽기만 대체하고 나머지는 실물을 쓴다.
jest.mock('../parse', () => ({
  ...jest.requireActual('../parse'),
  readRows: jest.fn(async (f: string) =>
    (jest.requireActual('fs').readFileSync(f, 'utf-8') as string)
      .split('\n')
      .filter(Boolean)
      .map((l: string) => l.split(',')),
  ),
}));

const HEADER = ['옵션정보일련번호', '상품일련번호', '상품명', '바코드번호(서식)', '현재재고', '미발송주문수'];

describe('parseSignedInt', () => {
  it('부호·천단위 쉼표·공백을 받아들인다', () => {
    expect(parseSignedInt('-3')).toBe(-3);
    expect(parseSignedInt('1,234')).toBe(1234);
    expect(parseSignedInt(' 7 ')).toBe(7);
  });
  it('빈값·소수·문자·지수 표기는 null', () => {
    for (const s of ['', '1.5', 'N/A', '1e3']) expect(parseSignedInt(s)).toBeNull();
  });
});

describe('parseReconcileStock', () => {
  const parse = (...rows: string[][]) => parseReconcileStock([HEADER, ...rows], 'x.csv');

  it('행을 읽고 바코드 수식 감싸기를 벗긴다', () => {
    const r = parse(['1', '100', 'TEST-0001', '="8800000000001" ', '5', '2']);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { optionSerial: '1', productSerial: '100', name: 'TEST-0001', barcode: '8800000000001', current: 5, unshipped: 2 },
    ]);
  });
  it('현재재고 음수는 허용한다', () => {
    expect(parse(['1', '100', 'TEST-0001', '8800000000001', '-2', '0']).rows[0].current).toBe(-2);
  });
  it('미발송 음수는 오류', () => {
    const r = parse(['1', '100', 'TEST-0001', '8800000000001', '1', '-1']);
    expect(r.errors).toHaveLength(1);
    expect(r.rows).toHaveLength(0);
  });
  it('현재재고가 비면 0 으로 추정하지 않고 오류', () => {
    const r = parse(['1', '100', 'TEST-0001', '8800000000001', '', '0']);
    expect(r.errors).toHaveLength(1);
    expect(r.rows).toHaveLength(0);
  });
  it('같은 옵션 두 행: 값이 같으면 1건, 다르면 오류', () => {
    const same = parse(['1', '100', 'TEST-0001', '8800000000001', '5', '2'], ['1', '100', 'TEST-0001', '8800000000001', '5', '2']);
    expect(same.rows).toHaveLength(1);
    expect(same.errors).toEqual([]);
    const diff = parse(['1', '100', 'TEST-0001', '8800000000001', '5', '2'], ['1', '100', 'TEST-0001', '8800000000001', '6', '2']);
    expect(diff.errors).toHaveLength(1);
  });
  it('제외 상품은 rows 에서 빠지고 사유별로 세며 옵션 번호를 남긴다', () => {
    const r = parse(['9', '13248', 'TEST-0002', '8800000000009', '3', '0'], ['1', '100', 'TEST-0001', '8800000000001', '5', '2']);
    expect(r.rows.map((x) => x.optionSerial)).toEqual(['1']);
    expect(r.excludedSerials).toEqual(new Set(['9']));
    expect([...r.excluded.values()]).toEqual([1]);
  });
  it('미발송 열이 없는 헤더는 throw', () => {
    expect(() => parseReconcileStock([HEADER.slice(0, 5), ['1', '100', 'a', 'b', '1']], 'x.csv')).toThrow();
  });
});

describe('parseOwnMallDisplayIds', () => {
  it('자사몰 행만, 번호 꼴에서 displayId 를 뽑고 중복 제거', () => {
    const r = parseOwnMallDisplayIds(
      [['판매처', '주문번호'], ['자사몰', '20261120-1234'], ['쿠팡', '9000000001'], ['자사몰', '20261120-1234']],
      '자사몰',
    );
    expect(r).toEqual({ displayIds: [1234], errors: [] });
  });
  it('꼴이 안 맞는 자사몰 주문번호는 오류', () => {
    const r = parseOwnMallDisplayIds([['판매처', '주문번호'], ['자사몰', 'abc']], '자사몰');
    expect(r.errors).toHaveLength(1);
    expect(r.displayIds).toEqual([]);
  });
});

describe('renderUploadCsv', () => {
  it('바코드 순 정렬, CRLF', () => {
    expect(
      renderUploadCsv([{ barcode: '8800000000002', current: 5 }, { barcode: '8800000000001', current: 0 }]),
    ).toBe('바코드번호,재고수량\r\n8800000000001,0\r\n8800000000002,5\r\n');
  });
});

describe('파일 입출력', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-csv-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('writeUploadCsv 는 기본 euc-kr 로 쓴다', () => {
    const f = path.join(dir, 'up.csv');
    writeUploadCsv(f, [{ barcode: '8800000000001', current: 1 }]);
    expect(iconv.decode(fs.readFileSync(f), 'euc-kr')).toBe('바코드번호,재고수량\r\n8800000000001,1\r\n');
  });
  it('readStockCsv 는 파일명에서 기준시각, 바이트에서 sha256 을 낸다', async () => {
    const f = path.join(dir, 'stk_stockList_20261117_180000.csv');
    fs.writeFileSync(f, `${HEADER.join(',')}\n1,100,TEST-0001,8800000000001,5,2\n`);
    const r = await readStockCsv(f);
    expect(r.rows).toHaveLength(1);
    expect(r.snapshotAt.toISOString()).toBe('2026-11-17T09:00:00.000Z');
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('파일명에 시각이 없으면 throw', async () => {
    const f = path.join(dir, 'nodate.csv');
    fs.writeFileSync(f, `${HEADER.join(',')}\n`);
    await expect(readStockCsv(f)).rejects.toThrow();
  });
});
