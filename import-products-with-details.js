const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const PRODUCTS_JSON_PATH = path.join(
  __dirname,
  '크롤링데이터',
  'products.json',
);
const SOURCE_IMAGE_DIR = path.join(__dirname, '크롤링데이터', 'images');
const PIM_API_BASE = 'http://localhost:3000';

// 카테고리 매핑 (크롤링 카테고리 → PIM 카테고리 ID)
const CATEGORY_MAPPING = {
  신상: null, // 여러 카테고리에 걸쳐있을 수 있음
  베스트: null,
  클래스: null,
  캔바디자인: 'd6d42f54-018e-7bfb-be18-5e0b66e90f40', // CAN-B-DESIGN
  퍼마블렌드: null,
  노몬드: 'cb8e2c7e-018e-7bfb-be18-5e0ad50f0d66', // NOMOND
  속눈썹펌: '9f9e5eb0-018e-7bfb-be18-5e0a8abc7a74', // 속눈썹 펌
  속눈썹연장: '9c5c77a4-018e-7bfb-be18-5e0a7fb8e3b5', // 속눈썹 연장
  반영구: 'a22029de-018e-7bfb-be18-5e0a9b78adfc', // 반영구
  네일아트: 'a477f0dc-018e-7bfb-be18-5e0aa18af4f1', // 네일아트
};

// 가격 파싱 함수
function parsePrice(priceStr) {
  if (!priceStr) return 0;
  const cleaned = priceStr.toString().replace(/[^0-9]/g, '');
  return parseInt(cleaned, 10) || 0;
}

// 브랜드 추출 함수
function extractBrand(title) {
  const brandKeywords = [
    'CAN-B-DESIGN',
    'NOMOND',
    '노몬드',
    '캔바디자인',
    '비키니',
    'BIKINI',
  ];

  for (const keyword of brandKeywords) {
    if (title.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

// 카테고리 결정 함수
async function determineCategoryId(product) {
  const category = product.category;

  // 직접 매핑이 있으면 사용
  if (CATEGORY_MAPPING[category]) {
    return CATEGORY_MAPPING[category];
  }

  // 신상/베스트는 상품명에서 브랜드/타입 추출
  if (category === '신상' || category === '베스트') {
    const title = product.title;

    // 브랜드 기반 매핑
    if (title.includes('노몬드') || title.includes('NOMOND')) {
      return CATEGORY_MAPPING['노몬드'];
    }
    if (title.includes('캔바디자인') || title.includes('CAN-B-DESIGN')) {
      return CATEGORY_MAPPING['캔바디자인'];
    }

    // 상품 타입 기반 매핑
    if (title.includes('속눈썹펌') || title.includes('펌')) {
      return CATEGORY_MAPPING['속눈썹펌'];
    }
    if (title.includes('속눈썹연장') || title.includes('연장')) {
      return CATEGORY_MAPPING['속눈썹연장'];
    }
    if (title.includes('반영구')) {
      return CATEGORY_MAPPING['반영구'];
    }
    if (title.includes('네일')) {
      return CATEGORY_MAPPING['네일아트'];
    }
  }

  return null; // 매핑 실패 시 null
}

// 이미지 파일 업로드 함수
async function uploadImageFile(imagePath) {
  try {
    const fullPath = path.join(SOURCE_IMAGE_DIR, imagePath);

    if (!fs.existsSync(fullPath)) {
      console.log(`⚠️  이미지 파일 없음: ${imagePath}`);
      return null;
    }

    const form = new FormData();
    form.append('file', fs.createReadStream(fullPath));

    const response = await axios.post(`${PIM_API_BASE}/uploads`, form, {
      headers: {
        ...form.getHeaders(),
      },
    });

    console.log(`✅ 이미지 업로드 완료: ${imagePath} → ${response.data.url}`);
    return response.data.url;
  } catch (error) {
    console.error(`❌ 이미지 업로드 실패 (${imagePath}):`, error.message);
    return null;
  }
}

// HTML에서 이미지 경로 추출 및 업로드 후 URL 교체
async function processDetailImages(detailHtmlTags) {
  if (!detailHtmlTags || detailHtmlTags.length === 0) {
    return [];
  }

  const processedTags = [];
  const imageRegex = /<img\s+src="images\/([^"]+)"/g;

  for (const htmlTag of detailHtmlTags) {
    let processedHtml = htmlTag;
    const matches = [...htmlTag.matchAll(imageRegex)];

    for (const match of matches) {
      const imageName = match[1];
      const uploadedUrl = await uploadImageFile(imageName);

      if (uploadedUrl) {
        // 로컬 URL로 교체
        processedHtml = processedHtml.replace(
          `images/${imageName}`,
          uploadedUrl,
        );
      }
    }

    processedTags.push(processedHtml);
  }

  return processedTags;
}

// 상품 마스터 생성 함수
async function createProductMaster(product) {
  try {
    console.log(`\n🔄 상품 처리 중: ${product.title}`);

    // 문제가 있는 상품 건너뛰기 (모든 카테고리)
    if (product.title === '노몬드 색소 (리퀴드)') {
      console.log(`⚠️  문제 상품 - 건너뜀 (카테고리: ${product.category})`);
      return { skipped: true };
    }

    // 중복 체크: 동일한 이름의 상품이 이미 존재하는지 확인
    try {
      const checkResponse = await axios.get(`${PIM_API_BASE}/masters`, {
        params: { page: 1, limit: 1, search: product.title },
      });
      if (checkResponse.data.data && checkResponse.data.data.length > 0) {
        console.log(`⚠️  이미 존재하는 상품 - 건너뜀`);
        return { skipped: true };
      }
    } catch (err) {
      // 체크 실패 시 무시하고 계속 진행
    }

    // 카테고리 ID 결정
    const categoryId = await determineCategoryId(product);

    // 가격 정보 파싱
    const membershipPrice = parsePrice(product.membershipPrice);
    const regularPrice = parsePrice(product.regularMemberPrice);
    const basePrice = membershipPrice || regularPrice || 0;

    // 상세 설명 이미지 업로드 및 HTML 변환
    console.log(`📸 상세 이미지 처리 중...`);
    const processedDetailHtml = await processDetailImages(
      product.detailHtmlTags,
    );

    // 상세 설명을 JSON 문자열로 저장 (관리자 페이지에서 파싱해서 사용)
    const detailDescription = JSON.stringify(processedDetailHtml);

    // 썸네일 이미지 URL 변환 (로컬 경로 사용)
    const thumbnailUrl = product.localThumbnailPath || null;

    // 옵션 그룹 변환
    const optionGroups =
      product.options?.map((option) => ({
        name: option.title.toLowerCase().replace(/\s+/g, '_'),
        displayName: option.title,
        sortOrder: 0,
        values: option.items.map((item, index) => ({
          value: item.value,
          displayName: item.text,
          sortOrder: index,
          price: item.additionalPrice || 0,
        })),
      })) || [];

    // 브랜드 추출
    const brand = extractBrand(product.title);

    // 상품 마스터 생성 요청
    const masterData = {
      name: product.title,
      description: detailDescription, // JSON 문자열로 저장
      brand: brand || undefined,
      thumbnail: thumbnailUrl || undefined,
      basePrice: basePrice,
      pricingStrategy:
        optionGroups.length > 0 ? 'option_based' : 'variant_based',

      // 멤버십 관련 설정
      isMembershipOnly: product.isMembershipProduct || false,
      membershipPrice: membershipPrice > 0 ? membershipPrice : undefined,

      // 이미지 (썸네일만)
      images: thumbnailUrl ? [thumbnailUrl] : [],

      // 옵션 그룹
      optionGroups: optionGroups,

      // 기타 속성
      attributes: {
        originalCategory: product.category,
        crawledFrom: 'almondyoung',
        hasOptions: optionGroups.length > 0,
        totalOptionCombinations: product.totalOptionCombinations || 1,
        detailImageCount: processedDetailHtml.length,
      },
    };

    // 카테고리가 있으면 추가
    if (categoryId) {
      masterData.categoryId = categoryId;
    }

    console.log(`📦 생성 데이터:`, {
      name: masterData.name,
      basePrice: masterData.basePrice,
      thumbnail: masterData.thumbnail,
      categoryId: categoryId,
      optionGroups: optionGroups.length,
      isMembershipOnly: masterData.isMembershipOnly,
      detailHtmlTags: processedDetailHtml.length,
    });

    // API 호출
    const response = await axios.post(`${PIM_API_BASE}/masters`, masterData);
    console.log(`✅ 상품 생성 완료: ${response.data.id}`);
    return response.data;
  } catch (error) {
    console.error(`❌ 상품 생성 실패 (${product.title}):`, error.message);
    if (error.response) {
      console.error(`  상태 코드: ${error.response.status}`);
      console.error(
        `  에러 응답:`,
        JSON.stringify(error.response.data, null, 2),
      );
    }
    return null;
  }
}

// 메인 실행 함수
async function importProducts() {
  console.log('🚀 상품 임포트 시작...');

  const productsData = JSON.parse(fs.readFileSync(PRODUCTS_JSON_PATH, 'utf8'));
  console.log(`📊 총 ${productsData.length}개 상품 발견`);

  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  // 전체 상품 처리
  const LIMIT = productsData.length;

  for (let i = 0; i < Math.min(LIMIT, productsData.length); i++) {
    const product = productsData[i];
    const result = await createProductMaster(product);

    if (result && result.skipped) {
      skippedCount++;
    } else if (result) {
      successCount++;
    } else {
      failCount++;
    }

    // API 부하 방지를 위한 딜레이
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log('\n📊 임포트 완료!');
  console.log(`✅ 성공: ${successCount}개`);
  console.log(`⚠️  건너뜀: ${skippedCount}개`);
  console.log(`❌ 실패: ${failCount}개`);
}

importProducts();
