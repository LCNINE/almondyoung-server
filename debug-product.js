// 실패하는 상품 데이터 분석
const fs = require('fs');
const testData = JSON.parse(fs.readFileSync('../데이터/test.json', 'utf8'));

// 노몬드 색소 데이터 찾기
const failedProduct = testData.find(p => p.title.includes('노몬드 색소'));

console.log('=== 실패한 상품 데이터 분석 ===');
console.log('제목:', failedProduct.title);
console.log('HTML 태그 개수:', failedProduct.detailHtmlTags?.length || 0);
console.log('첫 번째 HTML 태그 길이:', failedProduct.detailHtmlTags?.[0]?.length || 0);
console.log('전체 HTML 길이:', failedProduct.detailHtmlTags?.join('').length || 0);

// 성공한 상품과 비교
const successProduct = testData.find(p => p.title.includes('민생회복'));
console.log('\n=== 성공한 상품 데이터 ===');
console.log('제목:', successProduct.title);
console.log('HTML 태그 개수:', successProduct.detailHtmlTags?.length || 0);
console.log('전체 HTML 길이:', successProduct.detailHtmlTags?.join('').length || 0);

// 실제 상품 등록 데이터 생성해보기
function parsePrice(priceString) {
  if (!priceString) return 10000;
  const match = priceString.match(/[\d,]+/);
  if (!match) return 10000;
  const price = parseInt(match[0].replace(/,/g, ''));
  return price <= 0 ? 10000 : price;
}

const basePrice = parsePrice(failedProduct.membershipPrice);
const membershipPrice = parsePrice(failedProduct.membershipPrice);

const productData = {
  name: failedProduct.title,
  description: failedProduct.detailHtmlTags ? failedProduct.detailHtmlTags.join('') : '',
  brand: '아몬드영',
  thumbnailUploadId: 'dummy-id',
  basePrice,
  pricingStrategy: 'option_based',
  tags: ['신상품', '속눈썹'],
  detailHtmlTags: failedProduct.detailHtmlTags || [],
  isMembershipOnly: failedProduct.isMembershipProduct,
  membershipPrice,
  optionGroups: failedProduct.options ? failedProduct.options.map(option => ({
    name: option.title.toLowerCase(),
    displayName: option.title,
    sortOrder: 0,
    values: option.items.map((item, index) => ({
      value: item.value,
      displayName: item.text,
      sortOrder: index,
      price: basePrice + item.additionalPrice,
    })),
  })) : [],
};

console.log('\n=== 생성된 상품 데이터 크기 ===');
console.log('전체 JSON 크기:', JSON.stringify(productData).length, 'bytes');
console.log('description 크기:', productData.description.length, 'bytes');
console.log('detailHtmlTags 크기:', JSON.stringify(productData.detailHtmlTags).length, 'bytes');

// 가장 큰 HTML 태그 찾기
if (failedProduct.detailHtmlTags) {
  const largest = failedProduct.detailHtmlTags.reduce((max, tag) => 
    tag.length > max.length ? tag : max, '');
  console.log('가장 큰 HTML 태그 크기:', largest.length, 'bytes');
  console.log('가장 큰 HTML 태그 미리보기:', largest.substring(0, 200) + '...');
}