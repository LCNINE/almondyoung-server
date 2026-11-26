import * as ExcelJS from 'exceljs';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readPhoneList, toDisplayPhone, writeUploadWorkbook } from './workbook';

const tmp = () => mkdtempSync(join(tmpdir(), 'sms-link-export-'));

describe('toDisplayPhone', () => {
  it('E.164 를 010-xxxx-xxxx 로', () => {
    expect(toDisplayPhone('+821000001111')).toBe('010-0000-1111');
  });
});

describe('writeUploadWorkbook', () => {
  it('머리글 두 칸과 텍스트 두 칸만 쓴다', async () => {
    const path = join(tmp(), 'out.xlsx');
    await writeUploadWorkbook([{ phone: '010-0000-1111', body: '가\n나' }], path);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    expect(workbook.worksheets).toHaveLength(1);
    const sheet = workbook.worksheets[0];
    expect(sheet.getCell('A1').value).toBe('휴대폰번호');
    expect(sheet.getCell('B1').value).toBe('실제발송할 문구');
    expect(sheet.getCell('A2').value).toBe('010-0000-1111');
    expect(sheet.getCell('B2').value).toBe('가\n나');
    expect(sheet.getCell('B2').formula).toBeUndefined();
    expect(sheet.getCell('C1').value).toBeNull();
    expect(sheet.getCell('C2').value).toBeNull();
  });
});

describe('readPhoneList', () => {
  it('xlsx 첫 시트 A열을 읽고 숫자가 아닌 1행은 머리글로 건너뛴다', async () => {
    const path = join(tmp(), 'list.xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['휴대폰번호']);
    sheet.addRow([1000001111]);
    sheet.addRow(['010-0000-2222']);
    await workbook.xlsx.writeFile(path);

    expect(await readPhoneList(path)).toEqual(['1000001111', '010-0000-2222']);
  });

  it('csv 는 한 줄에 하나, 빈 줄은 뺀다', async () => {
    const path = join(tmp(), 'list.csv');
    writeFileSync(path, '01000001111\n\n010-0000-2222\n');

    expect(await readPhoneList(path)).toEqual(['01000001111', '010-0000-2222']);
  });

  it('csv 도 숫자가 아닌 1행은 머리글로 건너뛴다', async () => {
    const path = join(tmp(), 'list-with-header.csv');
    writeFileSync(path, '휴대폰번호\r\n010-0000-1111\r\nabc\r\n');

    expect(await readPhoneList(path)).toEqual(['010-0000-1111', 'abc']);
  });
});
