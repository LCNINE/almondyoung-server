import * as ExcelJS from 'exceljs';
import { generateTemplateWorkbook, PRODUCT_HEADERS, PRODUCT_EXAMPLE_ROW } from './product-import.template';
import { ProductImportParser } from './product-import.parser';
import { ProductImportNormalizer } from './product-import.normalizer';
import { ProductImportValidator } from './product-import.validator';

/**
 * exceljs 의 ambient Buffer 셰임(index.d.ts)과 @types/node 의 Buffer<T> 가 병합돼
 * `.load()` 호출부에서 TS2345 가 난다 — product-import.parser.ts 의 동일 주석 참고.
 * 값이 아니라 호출부 타입만 로컬 재선언해 우회한다(런타임은 평범한 Node Buffer).
 */
async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const xlsx = wb.xlsx as unknown as {
    load(buffer: Buffer, options?: Partial<ExcelJS.XlsxReadOptions>): Promise<ExcelJS.Workbook>;
  };
  await xlsx.load(buffer);
  return wb;
}

describe('generateTemplateWorkbook', () => {
  it('생성한 템플릿은 파서가 읽을 수 있고 필수 헤더를 갖는다', async () => {
    const buf = await generateTemplateWorkbook();
    const parsed = await new ProductImportParser().parse(buf);
    const headers = Object.keys(parsed.products[0].cells);
    expect(headers).toEqual(expect.arrayContaining(['productKey', 'name', 'categoryPath', 'marketPrice']));
    expect(parsed.products.length).toBeGreaterThanOrEqual(1); // 예시행 존재
  });

  it('템플릿 예시 행은 자기 파이프라인을 오류 없이 통과한다', async () => {
    const buffer = await generateTemplateWorkbook();
    const parsed = await new ProductImportParser().parse(buffer);
    const records = new ProductImportValidator().validate(new ProductImportNormalizer().normalize(parsed, []));

    expect(parsed.variants.length).toBeGreaterThan(0);
    // categoryPath 는 실제 카테고리 트리가 필요하므로 그 오류만 허용한다
    const unexpected = records.flatMap((r) => r.errors).filter((e) => !/카테고리/.test(e.message));
    expect(unexpected).toEqual([]);

    // Task 7 에서 basePrice 가 필수가 되었으므로 이제 validator 가 채운 값을 확인할 수 있다.
    expect(records[0].basePrice).toBeGreaterThan(0);
    expect(records[0].membershipPrice).toBeGreaterThan(0);
  });

  it('Products 예시 행에 판매가 컬럼이 실제 값으로 들어있다', async () => {
    const parsed = await new ProductImportParser().parse(await generateTemplateWorkbook());
    // Task 7 이 basePrice 를 필수로 만들기 전이라 validator 는 아직 이 값을 읽지 않는다.
    // 원본 셀을 직접 확인해 템플릿이 빈 칸을 내보내지 않음을 보장한다.
    expect(Number(parsed.products[0].cells.basePrice)).toBeGreaterThan(0);
    expect(Number(parsed.products[0].cells.membershipPrice)).toBeGreaterThan(0);
  });

  it('Variants 예시 행은 Options 축을 전부 지정한다', async () => {
    const parsed = await new ProductImportParser().parse(await generateTemplateWorkbook());
    const axes = parsed.options.filter((o) => o.cells.productKey === 'P1').length;
    for (const row of parsed.variants) {
      expect(row.cells.optionCombination.split(';').filter((s) => s.trim() !== '')).toHaveLength(axes);
    }
  });

  it('Products 헤더에 v3 3단계 컬럼 6개가 있다', async () => {
    const parsed = await new ProductImportParser().parse(await generateTemplateWorkbook());
    const headers = Object.keys(parsed.products[0].cells);
    expect(headers).toEqual(
      expect.arrayContaining([
        'seoTitle',
        'seoDescription',
        'seoKeywords',
        'isWholesaleOnly',
        'salesStartDate',
        'salesEndDate',
      ]),
    );
    // 하위호환 컬럼은 남긴다
    expect(headers).toContain('categoryPath');
  });

  it('Categories·Constraints 예시 시트가 있고 P1 을 가리킨다', async () => {
    const parsed = await new ProductImportParser().parse(await generateTemplateWorkbook());
    expect(parsed.categories.length).toBeGreaterThanOrEqual(2);
    expect(parsed.categories.every((r) => r.cells.productKey === 'P1')).toBe(true);
    expect(parsed.categories.filter((r) => r.cells.isPrimary === 'Y')).toHaveLength(1);
    expect(parsed.constraints).toHaveLength(1);
    expect(parsed.constraints[0].cells.productKey).toBe('P1');
  });

  it('Products.categoryPath 는 비어 있다 (Categories 시트와 충돌하지 않게)', async () => {
    const parsed = await new ProductImportParser().parse(await generateTemplateWorkbook());
    expect(parsed.products[0].cells.categoryPath).toBe('');
  });

  it('Products 헤더에 이미지 컬럼 2개가 있다', async () => {
    const wb = await loadWorkbook(await generateTemplateWorkbook());
    const headers = wb.getWorksheet('Products')!.getRow(1).values as string[];
    expect(headers).toContain('thumbnailImageKey');
    expect(headers).toContain('additionalImageKeys');
  });

  it('Images 시트가 imageKey/sourceUrl 헤더로 있다', async () => {
    const wb = await loadWorkbook(await generateTemplateWorkbook());
    const sheet = wb.getWorksheet('Images');
    expect(sheet).toBeDefined();
    expect((sheet!.getRow(1).values as string[]).filter(Boolean)).toEqual(['imageKey', 'sourceUrl']);
  });

  it('예시 description 이 본문 디렉티브를 imageKey 로 쓴다', async () => {
    const wb = await loadWorkbook(await generateTemplateWorkbook());
    const headers = (wb.getWorksheet('Products')!.getRow(1).values as string[]) ?? [];
    const col = headers.indexOf('description');
    const value = String(wb.getWorksheet('Products')!.getRow(2).getCell(col).text);
    expect(value).toMatch(/::product-image\{imageKey="IMG-2"\}/);
  });

  it('Products 헤더와 예시 행의 길이가 같다', () => {
    // 하나라도 어긋나면 그 뒤 컬럼이 전부 밀려 MD 가 받는 워크북이 조용히 틀어진다.
    expect(PRODUCT_EXAMPLE_ROW).toHaveLength(PRODUCT_HEADERS.length);
  });

  it('이미지 컬럼이 헤더에서 기대한 자리에 있고 예시 값이 그 자리에 대응한다', async () => {
    const wb = await loadWorkbook(await generateTemplateWorkbook());
    const sheet = wb.getWorksheet('Products')!;
    const headers = (sheet.getRow(1).values as string[]) ?? [];
    const example = (sheet.getRow(2).values as string[]) ?? [];

    // 위치를 헤더에서 찾아 그 위치의 예시 셀을 본다 — 인덱스를 코드에 박지 않는다.
    const at = (name: string): string => String(example[headers.indexOf(name)] ?? '');
    expect(at('thumbnailImageKey')).toBe('IMG-1');
    expect(at('additionalImageKeys')).toBe('IMG-3|IMG-4');
    expect(at('description')).toMatch(/imageKey="IMG-2"/);
    // 정렬이 밀리면 이 셋 중 최소 하나가 엉뚱한 값이 된다.
  });

  it('예시 SEO·구매제약이 검증기를 통과하고, 판매기간은 예시로 채워 넣지 않는다', async () => {
    const parsed = await new ProductImportParser().parse(await generateTemplateWorkbook());
    const records = new ProductImportValidator().validate(new ProductImportNormalizer().normalize(parsed, []));
    const p1 = records.find((r) => r.productKey === 'P1' && Object.keys(r.raw).length > 0);

    // 판매기간은 등록 후 화면에서 고칠 수 없으므로 예시 행이 실수로 살아있는 값을 실어
    // 나르면 안 된다 — 템플릿의 salesStartDate/salesEndDate 셀은 비어 있어야 한다.
    expect(p1!.salesStartDate).toBeUndefined();
    expect(p1!.salesEndDate).toBeUndefined();
    expect(p1!.version.seoKeywords).toEqual(expect.arrayContaining(['니트']));
    expect(p1!.purchaseConstraint).toEqual({ requiresMembership: false, lifetimeQuantityLimit: 2 });
  });
});
