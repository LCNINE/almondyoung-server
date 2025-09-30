const fs = require('fs');
const axios = require('axios');

// 🚀 급속 상품 임포트 - 카테고리별 별개 상품으로 처리

const BASE_URL = 'http://localhost:3000';
const ALMOND_BASE_URL = 'https://almondyoung.com';

// 크롤링 카테고리 → PIM 카테고리 매핑 (단일)
const CATEGORY_MAPPING = {
  신상: 'digital', // 신상 → 디지털 템플릿
  베스트: 'lash-lash', // 베스트 → 속눈썹 래쉬
  캔바디자인: 'digital', // 캔바디자인 → 디지털 템플릿
  노몬드: 'semi-ink', // 노몬드 → 반영구 색소
  속눈썹펌: 'lash-lot', // 속눈썹펌 → 롯드
  속눈썹연장: 'lash-lash', // 속눈썹연장 → 래쉬
  반영구: 'semi-ink', // 반영구 → 색소
  네일아트: 'nail-gel', // 네일아트 → 젤네일
};

// PIM 카테고리 ID 캐시
let categoryCache = null;

async function loadCategories() {
  if (categoryCache) return categoryCache;

  console.log('📂 카테고리 정보 로딩 중...');
  const response = await axios.get(`${BASE_URL}/categories`);
  const categories = response.data.categories;

  // slug → id 매핑 생성
  categoryCache = {};
  function mapCategories(cats) {
    cats.forEach((cat) => {
      categoryCache[cat.slug] = cat.id;
      if (cat.children && cat.children.length > 0) {
        mapCategories(cat.children);
      }
    });
  }
  mapCategories(categories);

  console.log(`✅ ${Object.keys(categoryCache).length}개 카테고리 로딩 완료`);
  return categoryCache;
}

// 상대경로를 절대경로로 변환
function convertToAbsoluteUrl(htmlContent) {
  if (!htmlContent) return htmlContent;

  // /web/upload/... → https://almondyoung.com/web/upload/...
  return htmlContent
    .replace(
      /ec-data-src="\/web\/upload\//g,
      `ec-data-src="${ALMOND_BASE_URL}/web/upload/`,
    )
    .replace(/src="\/web\/upload\//g, `src="${ALMOND_BASE_URL}/web/upload/`);
}

// 가격 파싱 (멤버십가 우선)
function parsePrice(membershipPrice, regularPrice) {
  const membershipMatch = membershipPrice?.match(/[\d,]+/);
  if (membershipMatch) {
    return parseInt(membershipMatch[0].replace(/,/g, ''));
  }

  const regularMatch = regularPrice?.match(/[\d,]+/);
  if (regularMatch) {
    return parseInt(regularMatch[0].replace(/,/g, ''));
  }

  return 1000; // 기본값 (최소 1000원)
}

// 카테고리 ID 결정 (단일)
function determineCategoryId(crawledCategory, categories) {
  const slug = CATEGORY_MAPPING[crawledCategory] || 'digital'; // 기본값: 디지털 템플릿
  return categories[slug] || categories['digital'];
}

// 상품 업데이트
async function updateProductMaster(productId, product, categories) {
  try {
    const categoryId = determineCategoryId(product.category, categories);
    const basePrice = Math.max(
      1,
      parsePrice(product.membershipPrice, product.regularMemberPrice),
    ); // 최소 1원

    // 썸네일 URL (이미 절대경로)
    const thumbnailUrl = product.thumbnail?.originalUrl || null;

    // 상세 설명 HTML 처리 (상대경로 → 절대경로)
    const processedDescription =
      product.detailHtmlTags?.map((tag) => convertToAbsoluteUrl(tag)) || [];

    const payload = {
      name: product.title,
      description: JSON.stringify(processedDescription), // JSON 문자열로 저장
      basePrice: basePrice,
      thumbnail: thumbnailUrl, // 썸네일 URL 추가
      categoryId: categoryId, // 단일 카테고리
      pricingStrategy: 'option_based', // 필수 필드
      isMembershipOnly: product.isMembershipProduct || false,
      membershipPrice: product.isMembershipProduct ? basePrice : undefined, // 멤버십 가격 설정
      optionGroups:
        product.options?.map((option) => ({
          name: option.title,
          displayName: option.title,
          values:
            option.items?.map((item) => ({
              value: item.value,
              displayName: item.text,
              price: item.additionalPrice || 0,
            })) || [],
        })) || [],
    };

    console.log('🔄 업데이트 데이터:', {
      id: productId,
      name: payload.name,
      category: product.category,
      basePrice: payload.basePrice,
      membershipPrice: payload.membershipPrice || 'N/A',
      thumbnail: payload.thumbnail ? '✅ 있음' : '❌ 없음',
      optionGroups: payload.optionGroups.length,
      isMembershipOnly: payload.isMembershipOnly,
      descriptionTags: processedDescription.length,
    });

    const response = await axios.put(
      `${BASE_URL}/masters/${productId}`,
      payload,
    );
    console.log(`✅ 상품 업데이트 완료: ${productId}`);
    return productId;
  } catch (error) {
    console.error(
      `❌ 상품 업데이트 실패 (${product.title}):`,
      error.response?.data?.message || error.message,
    );
    return null;
  }
}

// 상품 생성
async function createProductMaster(product, categories) {
  try {
    const categoryId = determineCategoryId(product.category, categories);
    const basePrice = Math.max(
      1,
      parsePrice(product.membershipPrice, product.regularMemberPrice),
    ); // 최소 1원

    // 썸네일 URL (이미 절대경로)
    const thumbnailUrl = product.thumbnail?.originalUrl || null;

    // 상세 설명 HTML 처리 (상대경로 → 절대경로)
    const processedDescription =
      product.detailHtmlTags?.map((tag) => convertToAbsoluteUrl(tag)) || [];

    const payload = {
      name: product.title,
      description: JSON.stringify(processedDescription), // JSON 문자열로 저장
      basePrice: basePrice,
      thumbnail: thumbnailUrl, // 썸네일 URL 추가
      categoryId: categoryId, // 단일 카테고리
      pricingStrategy: 'option_based', // 필수 필드
      isMembershipOnly: product.isMembershipProduct || false,
      membershipPrice: product.isMembershipProduct ? basePrice : undefined, // 멤버십 가격 설정
      optionGroups:
        product.options?.map((option) => ({
          name: option.title,
          displayName: option.title,
          values:
            option.items?.map((item) => ({
              value: item.value,
              displayName: item.text,
              price: item.additionalPrice || 0,
            })) || [],
        })) || [],
    };

    console.log('📦 생성 데이터:', {
      name: payload.name,
      category: product.category,
      basePrice: payload.basePrice,
      membershipPrice: payload.membershipPrice || 'N/A',
      thumbnail: payload.thumbnail ? '✅ 있음' : '❌ 없음',
      optionGroups: payload.optionGroups.length,
      isMembershipOnly: payload.isMembershipOnly,
      descriptionTags: processedDescription.length,
    });

    const response = await axios.post(`${BASE_URL}/masters`, payload);
    console.log(`✅ 상품 생성 완료: ${response.data.id}`);
    return response.data.id;
  } catch (error) {
    console.error(
      `❌ 상품 생성 실패 (${product.title}):`,
      error.response?.data?.message || error.message,
    );
    return null;
  }
}

// 기존 상품 찾기 (제품명 기준)
async function findExistingProduct(productName) {
  try {
    const response = await axios.get(
      `${BASE_URL}/masters?search=${encodeURIComponent(productName)}`,
    );
    const masters = response.data.masters || [];

    // 같은 이름인 상품 찾기
    const existingProduct = masters.find(
      (master) => master.name === productName,
    );
    return existingProduct || null;
  } catch (error) {
    console.error('기존 상품 조회 실패:', error.message);
    return null;
  }
}

// 메인 실행
async function main() {
  try {
    console.log('🚀 급속 상품 임포트 시작...');
    console.log('📋 전략: 카테고리별 별개 상품으로 처리');

    // 카테고리 로딩
    const categories = await loadCategories();

    // 상품 데이터 로딩
    const productsData = fs.readFileSync(
      '/home/jihun/다운로드/그룹/almondyoung-server-1/크롤링데이터/products.json',
      'utf8',
    );
    const products = JSON.parse(productsData);

    console.log(`📊 총 ${products.length}개 상품 발견`);

    let successCount = 0;
    let updateCount = 0;
    let failCount = 0;

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      console.log(
        `🔄 상품 처리 중 (${i + 1}/${products.length}): ${product.title} [${product.category}]`,
      );

      // 기존 상품 찾기
      const existingProduct = await findExistingProduct(product.title);

      let result;
      if (existingProduct) {
        console.log(
          `🔄 기존 상품 발견 - 업데이트 진행 (ID: ${existingProduct.id})`,
        );
        result = await updateProductMaster(
          existingProduct.id,
          product,
          categories,
        );
        if (result) {
          updateCount++;
        } else {
          failCount++;
        }
      } else {
        console.log('🆕 신규 상품 - 생성 진행');
        result = await createProductMaster(product, categories);
        if (result) {
          successCount++;
        } else {
          failCount++;
        }
      }

      // 속도 조절 (API 부하 방지)
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    console.log('\n📊 임포트 완료!');
    console.log(`🆕 신규 생성: ${successCount}개`);
    console.log(`🔄 업데이트: ${updateCount}개`);
    console.log(`❌ 실패: ${failCount}개`);
  } catch (error) {
    console.error('❌ 임포트 실패:', error.message);
  }
}

// 실행
if (require.main === module) {
  main();
}
