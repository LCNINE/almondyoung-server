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

// parse.ts 는 `import iconv from 'iconv-lite'`·`import Papa from 'papaparse'` 기본 import 를 쓰는데 jest 설정엔
// esModuleInterop 이 없어 default 가 undefined 다(TypeError: Cannot read properties of undefined (reading 'parse'/'decode')).
// parse.ts 는 건드리지 않고, 두 라이브러리를 «진짜 그대로» default 로도 노출해 실제 readRows 를 태운다.
jest.mock('iconv-lite', () => {
  const actual = jest.requireActual('iconv-lite');
  return { __esModule: true, ...actual, default: actual };
});
jest.mock('papaparse', () => {
  const actual = jest.requireActual('papaparse');
  return { __esModule: true, ...actual, default: actual };
});

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
      {
        optionSerial: '1',
        productSerial: '100',
        name: 'TEST-0001',
        barcode: '8800000000001',
        current: 5,
        unshipped: 2,
      },
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
    const same = parse(
      ['1', '100', 'TEST-0001', '8800000000001', '5', '2'],
      ['1', '100', 'TEST-0001', '8800000000001', '5', '2'],
    );
    expect(same.rows).toHaveLength(1);
    expect(same.errors).toEqual([]);
    const diff = parse(
      ['1', '100', 'TEST-0001', '8800000000001', '5', '2'],
      ['1', '100', 'TEST-0001', '8800000000001', '6', '2'],
    );
    expect(diff.errors).toHaveLength(1);
  });
  it('제외 상품은 rows 에서 빠지고 사유별로 세며 옵션 번호를 남긴다', () => {
    const r = parse(
      ['9', '13248', 'TEST-0002', '8800000000009', '3', '0'],
      ['1', '100', 'TEST-0001', '8800000000001', '5', '2'],
    );
    expect(r.rows.map((x) => x.optionSerial)).toEqual(['1']);
    expect(r.excludedSerials).toEqual(new Set(['9']));
    expect([...r.excluded.values()]).toEqual([1]);
  });
  it('제외 행의 바코드는 수식을 벗겨 excludedBarcodes 로 남긴다(빈 바코드는 뺀다)', () => {
    const r = parse(
      ['9', '13248', 'TEST-0002', '="8800000000009"', '3', '0'],
      ['8', '13248', 'TEST-0003', '', '3', '0'],
      ['1', '100', 'TEST-0001', '8800000000001', '5', '2'],
    );
    expect(r.excludedBarcodes).toEqual(new Set(['8800000000009']));
  });
  it('옵션정보일련번호만 빈 행은 오류, 완전히 빈 행은 건너뛴다', () => {
    const r = parse(
      ['', '100', 'TEST-0001', '8800000000001', '5', '2'],
      ['', '', '', '', '', ''],
      ['1', '100', 'TEST-0001', '8800000000002', '1', '0'],
    );
    expect(r.rows.map((x) => x.optionSerial)).toEqual(['1']);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('옵션정보일련번호');
  });
  it('«개발팀 데이터 내보내기용» 양식이 상품마다 넣는 합계 행(첫 칸 «합계», 재고 칸만 값)은 건너뛴다', () => {
    // 2026-11-19 라이브 export: 첫 열은 «이미지», 합계 행은 첫 칸이 «합계» 이고 현재재고·안정재고·재고금액에만 값이 있다
    const header = ['이미지', ...HEADER];
    const r = parseReconcileStock(
      [
        header,
        ['', '1', '100', 'TEST-0001', '8800000000001', '5', '2'],
        ['합계', '', '', '', '', '5', ''],
        ['', '2', '101', 'TEST-0002', '8800000000002', '3', '0'],
        [' 합계 ', '', '', '', '', '3', ''],
      ],
      'x.csv',
    );
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.optionSerial)).toEqual(['1', '2']);
  });
  it('첫 칸이 «합계» 여도 옵션정보일련번호가 있으면 상품 행으로 읽는다(합계 행으로 빼지 않는다)', () => {
    const r = parseReconcileStock([['이미지', ...HEADER], ['합계', '1', '100', 'TEST-0001', '8800000000001', '5', '2']], 'x.csv');
    expect(r.rows.map((x) => x.optionSerial)).toEqual(['1']);
  });
  it('첫 칸이 «합계» 가 아닌 옵션정보일련번호 빈 행은 여전히 오류', () => {
    const r = parseReconcileStock([['이미지', ...HEADER], ['소계', '', '', '', '', '5', '']], 'x.csv');
    expect(r.errors).toHaveLength(1);
  });
  it('미발송 열이 없는 헤더는 throw', () => {
    expect(() => parseReconcileStock([HEADER.slice(0, 5), ['1', '100', 'a', 'b', '1']], 'x.csv')).toThrow();
  });
});

describe('parseOwnMallDisplayIds', () => {
  it('자사몰 행만, 번호 꼴에서 displayId 를 뽑고 중복 제거', () => {
    const r = parseOwnMallDisplayIds(
      [
        ['판매처', '주문번호'],
        ['자사몰', '20261120-1234'],
        ['쿠팡', '9000000001'],
        ['자사몰', '20261120-1234'],
      ],
      '자사몰',
    );
    expect(r).toEqual({ displayIds: [1234], errors: [] });
  });
  it('셀메이트가 복사·나눈 주문(«셀-» 접두사가 쌓이고 끝에 -NN)은 원 주문 번호로 읽는다', () => {
    // 2026-11-19 라이브 미발송 export: «추가주문생성» 으로 만든 주문은 «셀-» 이 붙고, 다시 복사하면 «셀-셀-» 로 쌓인다
    const r = parseOwnMallDisplayIds(
      [
        ['판매처', '주문번호'],
        ['자사몰', '셀-20261119-7181-01'],
        ['자사몰', '셀-셀-20261113-6919-02'],
        ['자사몰', '셀-20261007-4994'],
        ['자사몰', '20261007-4994'],
      ],
      '자사몰',
    );
    expect(r).toEqual({ displayIds: [7181, 6919, 4994], errors: [] });
  });
  it('«셀-» 이 없는데 끝에 -NN 이 붙었거나, «셀-» 뒤가 날짜-번호 꼴이 아니면 여전히 오류', () => {
    const r = parseOwnMallDisplayIds(
      [
        ['판매처', '주문번호'],
        ['자사몰', '20261119-7181-01'],
        ['자사몰', '셀-S260825180411'],
        ['자사몰', '셀-20261119-'],
      ],
      '자사몰',
    );
    expect(r.displayIds).toEqual([]);
    expect(r.errors).toHaveLength(3);
  });
  it('꼴이 안 맞는 자사몰 주문번호는 오류', () => {
    const r = parseOwnMallDisplayIds(
      [
        ['판매처', '주문번호'],
        ['자사몰', 'abc'],
      ],
      '자사몰',
    );
    expect(r.errors).toHaveLength(1);
    expect(r.displayIds).toEqual([]);
  });
});

describe('renderUploadCsv', () => {
  it('바코드 순 정렬, CRLF', () => {
    expect(
      renderUploadCsv([
        { barcode: '8800000000002', current: 5 },
        { barcode: '8800000000001', current: 0 },
      ]),
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
  it('readStockCsv 는 실제 readRows 로 ="…" 셀을 벗기고 쉼표 따옴표를 읽는다', async () => {
    const f = path.join(dir, 'stk_stockList_20261117_190000.csv');
    fs.writeFileSync(f, `${HEADER.join(',')}\n1,100,"TEST-0001, 대형",="8800000000001",-2,3\n`);
    const r = await readStockCsv(f);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      {
        optionSerial: '1',
        productSerial: '100',
        name: 'TEST-0001, 대형',
        barcode: '8800000000001',
        current: -2,
        unshipped: 3,
      },
    ]);
  });
  it('readStockCsv 는 euc-kr 파일도 읽는다', async () => {
    const f = path.join(dir, 'stk_stockList_20261117_200000.csv');
    fs.writeFileSync(f, iconv.encode(`${HEADER.join(',')}\n1,100,테스트상품,="8800000000001",4,0\n`, 'euc-kr'));
    const r = await readStockCsv(f);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ name: '테스트상품', barcode: '8800000000001', current: 4 });
  });
  it('파일명에 시각이 없으면 throw', async () => {
    const f = path.join(dir, 'nodate.csv');
    fs.writeFileSync(f, `${HEADER.join(',')}\n`);
    await expect(readStockCsv(f)).rejects.toThrow();
  });
});
