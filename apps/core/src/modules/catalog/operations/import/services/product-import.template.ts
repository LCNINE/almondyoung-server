import * as ExcelJS from 'exceljs';

const PRODUCT_HEADERS = [
  'productKey',
  'name',
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

export async function generateTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const products = wb.addWorksheet('Products');
  products.addRow(PRODUCT_HEADERS);
  products.addRow([
    'P1',
    '예시 니트',
    'PROD-001',
    'ACME',
    '',
    '부드러운 니트',
    '아크릴 100%',
    '19000',
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
  options.addRow(['P1', '색상', '빨강|파랑|검정', '0']);
  options.addRow(['P1', '사이즈', 'S|M|L', '1']);

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}
