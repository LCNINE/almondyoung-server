import { generateTemplateWorkbook } from './product-import.template';
import { ProductImportParser } from './product-import.parser';

describe('generateTemplateWorkbook', () => {
  it('생성한 템플릿은 파서가 읽을 수 있고 필수 헤더를 갖는다', async () => {
    const buf = await generateTemplateWorkbook();
    const parsed = await new ProductImportParser().parse(buf);
    const headers = Object.keys(parsed.products[0].cells);
    expect(headers).toEqual(expect.arrayContaining(['productKey', 'name', 'categoryPath', 'marketPrice']));
    expect(parsed.products.length).toBeGreaterThanOrEqual(1); // 예시행 존재
  });
});
