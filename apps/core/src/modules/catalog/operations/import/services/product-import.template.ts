import * as ExcelJS from 'exceljs';

const PRODUCT_HEADERS = [
  'productKey',
  'name',
  'basePrice',
  'membershipPrice',
  'productCode',
  'brand',
  'alternativeName',
  'description',
  'material',
  'marketPrice',
  'supplyPrice',
  'productType',
  'fulfillmentKind',
  'salesClassification',
  'purchaseClassification',
  'ageRestriction',
  'minQuantity',
  'maxQuantity',
  'seller',
  'categoryPath',
  'isOverseas',
  'isVisibleToMembersOnly',
  'hideMembershipPriceForNonMembers',
  'seoTitle',
  'seoDescription',
  'seoKeywords',
  'isWholesaleOnly',
  'salesStartDate',
  'salesEndDate',
];

const OPTION_HEADERS = ['productKey', 'optionName', 'optionValues', 'sortOrder'];
const VARIANT_HEADERS = ['productKey', 'optionCombination', 'basePrice', 'membershipPrice', 'variantCode'];
const CATEGORY_HEADERS = ['productKey', 'categoryPath', 'isPrimary'];
const CONSTRAINT_HEADERS = ['productKey', 'requiresMembership', 'lifetimeQuantityLimit'];

export async function generateTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const products = wb.addWorksheet('Products');
  products.addRow(PRODUCT_HEADERS);
  products.addRow([
    'P1',
    '예시 니트',
    '29000',
    '26000',
    'PROD-001',
    'ACME',
    '',
    '부드러운 니트',
    '아크릴 100%',
    '39000',
    '12000',
    'regular_sale',
    'physical',
    '의류',
    '사입',
    '0',
    '1',
    '10',
    'ACME',
    // categoryPath 는 하위호환으로 남긴 단일 지정 컬럼이다. 아래 Categories 시트와
    // **같은 상품에 동시 사용하면 행 오류**라 예시는 시트 쪽만 채운다.
    '',
    'N',
    'N',
    'N',
    '겨울 니트 추천',
    '부드럽고 따뜻한 겨울 니트',
    // '|' 구분 — optionValues 와 같은 규칙
    '니트|겨울|여성니트',
    'N',
    // salesStartDate/salesEndDate 는 'YYYY-MM-DD' 또는 'YYYY-MM-DD HH:mm' 형식이다. 날짜만
    // 주면 KST 기준으로 시작은 00:00, 종료는 23:59:59 로 해석한다. 둘 다 비우면 판매기간
    // 제한이 없다는 뜻이다. 이 필드는 등록 후 화면에서 고칠 수 없는(유일한 쓰기 경로가
    // 임포트뿐인) 필드라 예시 행에는 값을 채우지 않는다 — 지우지 않고 그대로 올리면 그
    // 값이 실제 판매기간으로 굳는다.
    '',
    '',
  ]);

  const options = wb.addWorksheet('Options');
  options.addRow(OPTION_HEADERS);
  options.addRow(['P1', '색상', '빨강|파랑', '0']);
  options.addRow(['P1', '사이즈', 'S|M|L', '1']);

  // 선택 시트. 조합별로 가격을 달리하거나 variantCode 를 심을 때만 채운다.
  // 빈 칸은 Products 기본가를 상속한다. 축 순서는 무시된다.
  const variants = wb.addWorksheet('Variants');
  variants.addRow(VARIANT_HEADERS);
  variants.addRow(['P1', '색상=빨강;사이즈=L', '31000', '', 'KNIT-RD-L']);
  variants.addRow(['P1', '색상=파랑;사이즈=S', '', '', 'KNIT-BL-S']);

  // 선택 시트. 상품 하나를 여러 카테고리에 넣을 때 쓴다. isPrimary 는 **상품당 정확히 1개**.
  // 기존 트리에 이미 있는 카테고리만 지정할 수 있다(임포트가 카테고리를 만들지는 않는다).
  const categories = wb.addWorksheet('Categories');
  categories.addRow(CATEGORY_HEADERS);
  categories.addRow(['P1', '여성패션>니트', 'Y']);
  categories.addRow(['P1', '기획전>겨울신상', 'N']);

  // 선택 시트. 상품당 최대 한 행. 둘 다 비우면 제약을 만들지 않는다.
  const constraints = wb.addWorksheet('Constraints');
  constraints.addRow(CONSTRAINT_HEADERS);
  constraints.addRow(['P1', 'N', '2']);

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}
