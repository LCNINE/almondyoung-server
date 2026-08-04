import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFormWorkbook } from './form-export.workbook';
import { parseUploadWorkbook } from './bulk-upload.parser';

const SKILL = join(__dirname, '../../../../../../../../skills/product-bulk-form');
const PYTHON = join(SKILL, '.venv/bin/python');

// 파이썬 환경이 없는 CI 에서는 건너뛴다 — 동기화 테스트(form-export.columns-doc.spec.ts)가
// 가장 드리프트 위험이 큰 부분을 이미 항상 검사한다.
const describeIfPython = existsSync(PYTHON) ? describe : describe.skip;

describeIfPython('exceljs ↔ openpyxl 왕복', () => {
  it('스크립트가 고친 워크북을 우리 파서가 그대로 읽는다 — exportId 와 안 건드린 셀이 살아남는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bulk-form-'));
    const src = join(dir, 'form.xlsx');
    const out = join(dir, 'edited.xlsx');
    const changesPath = join(dir, 'changes.json');
    const exportId = '0198f3a1-1111-7000-8000-abcdefabcdef';

    writeFileSync(
      src,
      await buildFormWorkbook({
        exportId,
        products: [{ rowKey: 'P-000001', name: '티셔츠', basePrice: '19000', brand: 'ACME' }],
        options: [],
        variants: [],
        categories: [{ rowKey: 'P-000001', categoryPath: '여성패션>티셔츠', isPrimary: 'Y' }],
        constraints: [],
        images: [],
        categoryPaths: ['여성패션>티셔츠'],
      }),
    );

    writeFileSync(changesPath, JSON.stringify({ 변경: [{ 상품키: 'P-000001', 필드: { brand: 'NEWBRAND' } }] }));

    execFileSync(PYTHON, [join(SKILL, 'scripts/write_form.py'), src, changesPath, out]);

    const parsed = await parseUploadWorkbook(readFileSync(out));

    expect(parsed.exportId).toBe(exportId);
    expect(parsed.sheets.products).toHaveLength(1);
    expect(parsed.sheets.products[0].cells.rowKey).toBe('P-000001');
    expect(parsed.sheets.products[0].cells.brand).toBe('NEWBRAND');
    expect(parsed.sheets.products[0].cells.name).toBe('티셔츠'); // 안 건드림
    expect(parsed.sheets.products[0].cells.basePrice).toBe('19000'); // 안 건드림
    expect(parsed.sheets.categories).toHaveLength(1);
  });

  it('대표 카테고리가 0개인 레거시 상품이 섞여 있어도 다른 상품 수정을 막지 않는다 — 경고로 나온다', async () => {
    // 우리가 실제로 내보내는 워크북으로 재현한다. `addProductsToCategory` 가 기존 대표
    // 유무를 안 보고 isPrimary=false 로만 insert 하므로(categories.service.ts) 대표 0개인
    // 상품은 서버가 스스로 만드는 데이터다. 이것을 파일 수준으로 막으면 스크립트에 행 삭제
    // 기능이 없어 MD 가 빠져나갈 길이 없다 — 서버는 그 행만 invalid 로 떨구고 진행한다.
    const dir = mkdtempSync(join(tmpdir(), 'bulk-form-legacy-'));
    const src = join(dir, 'form.xlsx');
    const out = join(dir, 'edited.xlsx');
    const changesPath = join(dir, 'changes.json');

    writeFileSync(
      src,
      await buildFormWorkbook({
        exportId: '0198f3a1-2222-7000-8000-abcdefabcdef',
        products: [
          { rowKey: 'P-000001', name: '티셔츠', basePrice: '19000' },
          { rowKey: 'P-000002', name: '레거시', basePrice: '9000' },
        ],
        options: [],
        variants: [],
        categories: [
          { rowKey: 'P-000001', categoryPath: '여성패션>티셔츠', isPrimary: 'Y' },
          { rowKey: 'P-000002', categoryPath: '여성패션>니트', isPrimary: 'N' },
        ],
        constraints: [],
        images: [],
        categoryPaths: ['여성패션>티셔츠', '여성패션>니트'],
      }),
    );

    writeFileSync(changesPath, JSON.stringify({ 변경: [{ 상품키: 'P-000001', 필드: { brand: 'NEWBRAND' } }] }));

    const stdout = execFileSync(PYTHON, [join(SKILL, 'scripts/write_form.py'), src, changesPath, out], {
      encoding: 'utf-8',
    });

    expect(stdout).toContain('경고 1건');
    expect(stdout).toContain('P-000002');

    const parsed = await parseUploadWorkbook(readFileSync(out));
    expect(parsed.sheets.products).toHaveLength(2);
    expect(parsed.sheets.products[0].cells.brand).toBe('NEWBRAND');
  });
});
