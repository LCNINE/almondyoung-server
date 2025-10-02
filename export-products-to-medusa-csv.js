// PIM 상품 데이터를 Medusa CSV 포맷으로 내보내기
const fs = require('fs');
const PIM_BASE_URL = 'http://localhost:3000';

async function fetchWithTimeout(url, options = {}, timeout = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// CSV 특수문자 이스케이프 처리
function escapeCsv(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // 쉼표, 따옴표, 줄바꿈이 있으면 따옴표로 감싸기
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// HTML에서 텍스트만 추출 (간단한 버전)
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '') // HTML 태그 제거
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

// 모든 상품 조회 (페이지네이션 없이)
async function fetchAllProducts() {
  console.log('📦 모든 상품 데이터 조회 중...\n');

  const response = await fetchWithTimeout(`${PIM_BASE_URL}/masters`);
  if (!response.ok) {
    throw new Error(`상품 조회 실패: ${response.statusText}`);
  }

  const data = await response.json();
  console.log(`✅ ${data.total}개 상품 발견\n`);
  return data.data;
}

// 상품 상세 정보 조회 (옵션 포함)
async function fetchProductDetail(productId) {
  try {
    const response = await fetchWithTimeout(
      `${PIM_BASE_URL}/masters/${productId}`,
      {},
      10000,
    );
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error(`⚠️  상품 ${productId} 상세 조회 실패:`, error.message);
    return null;
  }
}

// PIM 상품을 Medusa CSV 행으로 변환
function convertToMedusaCsvRows(product, detail) {
  const rows = [];

  // 기본 상품 정보
  const productHandle = product.name
    .toLowerCase()
    .replace(/\[.*?\]/g, '') // [웰컴 멤버십] 같은 대괄호 제거
    .trim()
    .replace(/\s+/g, '-') // 공백을 하이픈으로
    .replace(/[^a-z0-9가-힣-]/g, '') // 특수문자 제거
    .substring(0, 100); // 최대 길이 제한

  const productTitle = product.name;
  const productStatus = product.status === 'ACTIVE' ? 'published' : 'draft';
  const productDescription = detail?.description
    ? stripHtml(detail.description)
    : '';
  const productThumbnail = product.thumbnail || '';

  // 카테고리 정보 - 상세 API에서 제공하지 않으므로 빈 배열
  const categoryIds = [];

  // 태그 정보
  const tags = detail?.tags || [];

  // 이미지 정보 - { primary: url, additional: [] } 형태
  const imageData = detail?.images || { primary: null, additional: [] };
  const imageUrls = [];
  if (imageData.primary) {
    imageUrls.push(imageData.primary);
  }
  if (Array.isArray(imageData.additional)) {
    imageUrls.push(...imageData.additional);
  }

  // 옵션 그룹과 variants 정보 가져오기
  const optionGroups = detail?.optionGroups || [];
  const variants = detail?.variants || [];

  // optionValueId로 displayName 찾기 위한 맵 생성
  const optionValueMap = new Map();
  optionGroups.forEach((group) => {
    group.values?.forEach((val) => {
      optionValueMap.set(val.id, {
        groupName: group.displayName || group.name,
        valueName: val.displayName || val.value,
      });
    });
  });

  // variants가 없거나 단일 기본 variant인 경우
  if (
    variants.length === 0 ||
    (variants.length === 1 &&
      variants[0].isDefault &&
      (!variants[0].optionValues || variants[0].optionValues.length === 0))
  ) {
    // 단일 variant
    rows.push({
      'Product Handle': productHandle,
      'Product Title': productTitle,
      'Product Status': productStatus,
      'Product Description': productDescription,
      'Product Thumbnail': productThumbnail,
      'Product Image 1': imageUrls[0] || '',
      'Product Image 2': imageUrls[1] || '',
      'Product Image 3': imageUrls[2] || '',
      'Product Image 4': imageUrls[3] || '',
      'Product Image 5': imageUrls[4] || '',
      'Product Category 1': categoryIds[0] || '',
      'Product Category 2': categoryIds[1] || '',
      'Product Category 3': categoryIds[2] || '',
      'Product Tag 1': tags[0] || '',
      'Product Tag 2': tags[1] || '',
      'Product Tag 3': tags[2] || '',
      'Product Discountable': 'true',
      'Variant Title': 'Default',
      'Variant Sku': variants[0]?.id || `${product.id}-default`,
      'Variant Price KRW': product.basePrice || 0,
      'Variant Manage Inventory': 'true',
      'Variant Allow Backorder': 'false',
    });
  } else {
    // 여러 variants가 있는 경우: 각 variant마다 한 행
    variants.forEach((variant, index) => {
      const variantPrice =
        (product.basePrice || 0) + (variant.priceAdjustment || 0);

      // 옵션 정보 추출
      let optionName = '';
      let optionValue = '';

      // PIM에서는 variant.optionValues가 비어있고 variantName에 옵션 값이 들어있음
      if (variant.variantName) {
        optionValue = variant.variantName;
        // 첫 번째 optionGroup의 이름을 사용
        if (optionGroups.length > 0) {
          optionName = optionGroups[0].displayName || optionGroups[0].name;
        }
      } else if (variant.optionValues && variant.optionValues.length > 0) {
        // optionValues가 있는 경우 (레거시 지원)
        const firstOptionValue = variant.optionValues[0];
        const optionInfo = optionValueMap.get(firstOptionValue.optionValueId);
        if (optionInfo) {
          optionName = optionInfo.groupName;
          optionValue = optionInfo.valueName;
        }
      }

      const variantTitle =
        variant.variantName || optionValue || `Variant ${index + 1}`;

      const row = {
        'Product Handle': productHandle,
        'Product Title': productTitle,
        'Product Status': productStatus,
        'Product Description': productDescription,
        'Product Thumbnail': productThumbnail,
        'Variant Title': variantTitle,
        'Variant Sku': variant.id,
        'Variant Price KRW': variantPrice,
        'Variant Manage Inventory': 'true',
        'Variant Allow Backorder': 'false',
      };

      // 옵션이 있으면 추가
      if (optionName && optionValue) {
        row['Variant Option 1 Name'] = optionName;
        row['Variant Option 1 Value'] = optionValue;
      }

      // 첫 번째 행에만 상품 정보 추가
      if (index === 0) {
        row['Product Image 1'] = imageUrls[0] || '';
        row['Product Image 2'] = imageUrls[1] || '';
        row['Product Image 3'] = imageUrls[2] || '';
        row['Product Image 4'] = imageUrls[3] || '';
        row['Product Image 5'] = imageUrls[4] || '';
        row['Product Category 1'] = categoryIds[0] || '';
        row['Product Category 2'] = categoryIds[1] || '';
        row['Product Category 3'] = categoryIds[2] || '';
        row['Product Tag 1'] = tags[0] || '';
        row['Product Tag 2'] = tags[1] || '';
        row['Product Tag 3'] = tags[2] || '';
        row['Product Discountable'] = 'true';
      }

      rows.push(row);
    });
  }

  return rows;
}

// CSV 파일 생성
async function exportToMedusaCsv() {
  console.log('🚀 Medusa CSV 내보내기 시작\n');
  console.log('='.repeat(60) + '\n');

  try {
    // 1. 모든 상품 조회
    const products = await fetchAllProducts();

    if (products.length === 0) {
      console.log('⚠️  내보낼 상품이 없습니다.');
      return;
    }

    // 2. 각 상품의 상세 정보 조회 및 변환
    console.log('🔄 상품 상세 정보 조회 및 변환 중...\n');
    const allRows = [];

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      process.stdout.write(
        `  [${i + 1}/${products.length}] ${product.name.substring(0, 50)}...\r`,
      );

      const detail = await fetchProductDetail(product.id);
      if (detail) {
        const rows = convertToMedusaCsvRows(product, detail);
        allRows.push(...rows);
      }

      // API 부하 방지를 위한 짧은 대기
      if (i < products.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    console.log('\n\n✅ 변환 완료!\n');

    // 3. CSV 헤더 정의
    const headers = [
      'Product Handle',
      'Product Title',
      'Product Status',
      'Product Description',
      'Product Thumbnail',
      'Product Image 1',
      'Product Image 2',
      'Product Image 3',
      'Product Image 4',
      'Product Image 5',
      'Product Category 1',
      'Product Category 2',
      'Product Category 3',
      'Product Tag 1',
      'Product Tag 2',
      'Product Tag 3',
      'Product Discountable',
      'Variant Title',
      'Variant Sku',
      'Variant Price KRW',
      'Variant Option 1 Name',
      'Variant Option 1 Value',
      'Variant Manage Inventory',
      'Variant Allow Backorder',
    ];

    // 4. CSV 문자열 생성
    let csvContent = headers.join(',') + '\n';

    allRows.forEach((row) => {
      const rowValues = headers.map((header) => escapeCsv(row[header] || ''));
      csvContent += rowValues.join(',') + '\n';
    });

    // 5. 파일 저장
    const filename = `medusa-products-${new Date().toISOString().split('T')[0]}.csv`;
    fs.writeFileSync(filename, csvContent, 'utf8');

    console.log('============================================================');
    console.log('📊 내보내기 결과:');
    console.log(`  ✅ 총 상품 수: ${products.length}개`);
    console.log(`  ✅ 총 variant 수: ${allRows.length}개`);
    console.log(`  📄 파일명: ${filename}`);
    console.log(
      '============================================================\n',
    );
    console.log('🎉 CSV 파일 생성 완료!\n');
    console.log('💡 다음 단계:');
    console.log('  1. Medusa Admin에 로그인');
    console.log('  2. Products 페이지로 이동');
    console.log('  3. Import 버튼 클릭');
    console.log(`  4. ${filename} 파일 업로드\n`);
  } catch (error) {
    console.error('\n❌ 오류 발생:', error.message);
    console.error(error.stack);
  }
}

exportToMedusaCsv().catch(console.error);
