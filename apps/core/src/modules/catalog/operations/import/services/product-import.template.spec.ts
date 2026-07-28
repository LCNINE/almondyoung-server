import { generateTemplateWorkbook } from './product-import.template';
import { ProductImportParser } from './product-import.parser';
import { ProductImportNormalizer } from './product-import.normalizer';
import { ProductImportValidator } from './product-import.validator';

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
});
