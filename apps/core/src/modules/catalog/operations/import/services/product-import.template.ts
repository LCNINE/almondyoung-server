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
];

const OPTION_HEADERS = ['productKey', 'optionName', 'optionValues', 'sortOrder'];
const VARIANT_HEADERS = ['productKey', 'optionCombination', 'basePrice', 'membershipPrice', 'variantCode'];

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
    '여성패션>니트',
    'N',
    'N',
    'N',
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

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}
