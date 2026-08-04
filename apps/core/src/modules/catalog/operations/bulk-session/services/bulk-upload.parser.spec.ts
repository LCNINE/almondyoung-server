import { buildFormWorkbook } from './form-export.workbook';
import { parseUploadWorkbook, MAX_UPLOAD_PRODUCT_ROWS } from './bulk-upload.parser';
import * as ExcelJS from 'exceljs';

const workbook = async (over: Partial<Parameters<typeof buildFormWorkbook>[0]> = {}) =>
  buildFormWorkbook({
    exportId: '11111111-1111-7111-8111-111111111111',
    products: [{ rowKey: 'P-000001', name: '티셔츠', basePrice: '19000', brand: 'ACME' }],
    options: [],
    variants: [],
    categories: [],
    constraints: [],
    images: [],
    categoryPaths: ['여성패션>티셔츠'],
    ...over,
  });

describe('parseUploadWorkbook', () => {
  it('1단계가 만든 워크북을 그대로 되읽는다', async () => {
    const parsed = await parseUploadWorkbook(await workbook());
    expect(parsed.exportId).toBe('11111111-1111-7111-8111-111111111111');
    expect(parsed.sheets.products).toHaveLength(1);
    expect(parsed.sheets.products[0].cells.name).toBe('티셔츠');
    expect(parsed.sheets.products[0].rowNumber).toBe(2);
  });

  it('한국어 헤더를 내부 키로 바꾼다', async () => {
    const parsed = await parseUploadWorkbook(await workbook());
    expect(parsed.sheets.products[0].cells.basePrice).toBe('19000');
    expect(parsed.sheets.products[0].cells['판매가']).toBeUndefined();
  });

  it('숨은 메타 시트가 없으면 exportId 가 null 이다 (신규 전용 세션)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('상품');
    ws.addRow(['상품키', '상품명', '판매가']);
    ws.addRow(['A', '새 상품', '1000']);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    expect((await parseUploadWorkbook(buffer)).exportId).toBeNull();
  });

  it('모르는 열은 무시한다 (작업자 메모 열이 안전하다)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('상품');
    ws.addRow(['상품키', '상품명', '판매가', '작업메모']);
    ws.addRow(['A', '새 상품', '1000', '내일 확인']);
    const parsed = await parseUploadWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(parsed.sheets.products[0].cells).toEqual({ rowKey: 'A', name: '새 상품', basePrice: '1000' });
  });

  it('열 순서가 바뀌어도 이름으로 찾는다', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('상품');
    ws.addRow(['판매가', '상품명', '상품키']);
    ws.addRow(['1000', '새 상품', 'A']);
    const parsed = await parseUploadWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(parsed.sheets.products[0].cells.rowKey).toBe('A');
  });

  it('present 에 실제로 있던 열만 담긴다', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('상품');
    ws.addRow(['상품키', '상품명', '판매가']);
    ws.addRow(['A', '새 상품', '1000']);
    const parsed = await parseUploadWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(parsed.present.products.has('name')).toBe(true);
    expect(parsed.present.products.has('brand')).toBe(false);
  });

  it('엑셀이 아니면 파일 오류다', async () => {
    await expect(parseUploadWorkbook(Buffer.from('not xlsx'))).rejects.toThrow('유효한 엑셀');
  });

  it('상품 시트가 없으면 파일 오류다', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('아무거나');
    await expect(parseUploadWorkbook(Buffer.from(await wb.xlsx.writeBuffer()))).rejects.toThrow('"상품"');
  });

  it('상품 시트에 필수 열이 없으면 파일 오류다', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('상품');
    ws.addRow(['상품명', '판매가']);
    ws.addRow(['새 상품', '1000']);
    await expect(parseUploadWorkbook(Buffer.from(await wb.xlsx.writeBuffer()))).rejects.toThrow('상품키');
  });

  it('데이터 행이 없으면 파일 오류다', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('상품');
    ws.addRow(['상품키', '상품명', '판매가']);
    await expect(parseUploadWorkbook(Buffer.from(await wb.xlsx.writeBuffer()))).rejects.toThrow('데이터 행이 없습니다');
  });

  it('상품 행 상한을 넘으면 파일 오류다', async () => {
    const products = Array.from({ length: MAX_UPLOAD_PRODUCT_ROWS + 1 }, (_, i) => ({
      rowKey: `P-${i}`,
      name: 'x',
      basePrice: '1000',
    }));
    await expect(parseUploadWorkbook(await workbook({ products }))).rejects.toThrow('상한');
  });

  it('날짜 서식 셀을 워크북 규격 문자열로 되돌린다', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('상품');
    ws.addRow(['상품키', '상품명', '판매가', '판매시작']);
    ws.addRow(['A', 'x', '1000', new Date(Date.UTC(2026, 7, 1, 9, 0))]);
    const parsed = await parseUploadWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(parsed.sheets.products[0].cells.salesStartDate).toBe('2026-08-01 09:00');
  });

  it('카테고리 참조 시트는 읽지 않는다', async () => {
    const parsed = await parseUploadWorkbook(await workbook());
    expect('categoryReference' in parsed.sheets).toBe(false);
  });

  it('중간 빈 행이 있어도 rowNumber 는 엑셀의 실제 물리 행 번호다', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('상품');
    ws.addRow(['상품키', '상품명', '판매가']); // 1행: 헤더
    ws.addRow(['A', '첫 번째', '1000']); // 2행: 데이터
    ws.addRow(['', '', '']); // 3행: 빈 행 (건너뜀)
    ws.addRow(['B', '두 번째', '2000']); // 4행: 데이터
    const parsed = await parseUploadWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(parsed.sheets.products).toHaveLength(2);
    expect(parsed.sheets.products[0].rowNumber).toBe(2);
    expect(parsed.sheets.products[1].rowNumber).toBe(4);
  });

  it('같은 헤더가 두 열에 있으면 파일 오류다', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('상품');
    ws.addRow(['상품키', '상품명', '상품명']); // 중복 헤더
    ws.addRow(['A', '첫 번째', '두 번째']);
    await expect(parseUploadWorkbook(Buffer.from(await wb.xlsx.writeBuffer()))).rejects.toThrow('상품명');
    await expect(parseUploadWorkbook(Buffer.from(await wb.xlsx.writeBuffer()))).rejects.toThrow('중복');
  });

  it('모르는 열이 여러 개 있어도 여전히 무시한다 (회귀)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('상품');
    ws.addRow(['상품키', '상품명', '판매가', '작업메모1', '작업메모2']);
    ws.addRow(['A', '새 상품', '1000', '메모1', '메모2']);
    const parsed = await parseUploadWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(parsed.sheets.products[0].cells).toEqual({ rowKey: 'A', name: '새 상품', basePrice: '1000' });
  });
});
