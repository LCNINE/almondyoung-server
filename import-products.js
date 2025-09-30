#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// 설정
const PIM_API_BASE = 'http://localhost:3000';
const PRODUCTS_JSON_PATH = path.join(
  __dirname,
  '크롤링데이터',
  'products.json',
);
const PIM_IMAGES_BASE_URL = '/images'; // PIM 서버의 이미지 베이스 URL

// 카테고리 매핑
const CATEGORY_MAPPING = {
  신상: null, // 특별 카테고리는 나중에 처리
  베스트: null,
  클래스: 'class',
  캔바디자인: 'digital',
  노몬드: null, // 브랜드별로 분류 필요
  속눈썹펌: 'lash-wax',
  속눈썹연장: 'lash-lash',
  반영구: 'semi',
  네일아트: 'nail',
};

// 가격 파싱 함수
function parsePrice(priceStr) {
  if (!priceStr) return 0;
  return parseInt(priceStr.replace(/[^0-9]/g, '')) || 0;
}

// 이미지 URL 변환 함수
function convertImageUrl(localPath) {
  if (!localPath) return null;
  // "/images/파일명" -> "/images/파일명"으로 변환 (이미 올바른 형태)
  return localPath.replace('/images/', PIM_IMAGES_BASE_URL + '/');
}

// HTML 태그에서 이미지 URL 변환
function convertDetailImages(detailHtmlTags) {
  if (!Array.isArray(detailHtmlTags)) return '';

  return detailHtmlTags
    .map((tag) => {
      // <img src="images/파일명.jpg" alt="..." /> 형태를 변환
      return tag.replace(/src="images\//g, `src="${PIM_IMAGES_BASE_URL}/`);
    })
    .join('\n');
}

// 카테고리 ID 조회
async function getCategoryIdBySlug(slug) {
  try {
    const response = await axios.get(`${PIM_API_BASE}/categories`);
    const categories = response.data.categories;

    // 재귀적으로 카테고리 찾기
    function findCategoryBySlug(cats, targetSlug) {
      for (const cat of cats) {
        if (cat.slug === targetSlug) {
          return cat.id;
        }
        if (cat.children && cat.children.length > 0) {
          const found = findCategoryBySlug(cat.children, targetSlug);
          if (found) return found;
        }
      }
      return null;
    }

    return findCategoryBySlug(categories, slug);
  } catch (error) {
    console.error(`카테고리 조회 실패 (${slug}):`, error.message);
    return null;
  }
}

// 상품별 카테고리 결정
async function determineCategoryId(product) {
  const crawledCategory = product.category;
  const mappedSlug = CATEGORY_MAPPING[crawledCategory];

  if (!mappedSlug) {
    // 특별 처리가 필요한 카테고리들
    if (crawledCategory === '노몬드') {
      // 상품명을 보고 적절한 카테고리 결정
      const title = product.title.toLowerCase();
      if (title.includes('네일')) return await getCategoryIdBySlug('nail');
      if (title.includes('속눈썹') || title.includes('래쉬'))
        return await getCategoryIdBySlug('lash');
      if (title.includes('반영구') || title.includes('색소'))
        return await getCategoryIdBySlug('semi');
      // 기본값으로 반영구 카테고리
      return await getCategoryIdBySlug('semi');
    }

    // 신상, 베스트는 일단 null로 처리 (나중에 특별 카테고리 생성)
    return null;
  }

  return await getCategoryIdBySlug(mappedSlug);
}

// 상품 마스터 생성
async function createProductMaster(product) {
  try {
    console.log(`\n🔄 상품 처리 중: ${product.title}`);

    // 카테고리 ID 결정
    const categoryId = await determineCategoryId(product);

    // 가격 정보 파싱
    const membershipPrice = parsePrice(product.membershipPrice);
    const regularPrice = parsePrice(product.regularMemberPrice);
    const basePrice = membershipPrice || regularPrice || 0;

    // 상세 설명 (HTML을 JSON으로 저장)
    const detailDescription = convertDetailImages(product.detailHtmlTags);

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

    // 브랜드 추출 (null이면 빈 문자열 또는 기본값)
    const brand = extractBrand(product.title);

    // 상품 마스터 생성 요청
    const masterData = {
      name: product.title,
      description: detailDescription,
      brand: brand || undefined, // null 대신 undefined 사용 (옵션 필드)
      thumbnail: thumbnailUrl || undefined, // null 대신 undefined
      basePrice: basePrice,
      pricingStrategy:
        optionGroups.length > 0 ? 'option_based' : 'variant_based',

      // 멤버십 관련 설정
      isMembershipOnly: product.isMembershipProduct || false,
      membershipPrice: membershipPrice > 0 ? membershipPrice : undefined,

      // 이미지 (상세 이미지는 images 배열에)
      images: thumbnailUrl ? [thumbnailUrl] : [],

      // 옵션 그룹
      optionGroups: optionGroups,

      // 기타 속성
      attributes: {
        originalCategory: product.category,
        crawledFrom: 'almondyoung',
        hasOptions: optionGroups.length > 0,
        totalOptionCombinations: product.totalOptionCombinations || 1,
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

// 브랜드 추출 함수
function extractBrand(title) {
  const brands = [
    '노몬드',
    'Drawy',
    'MAST',
    '래쉬몬스터',
    '래쉬클리닉',
    '미스테이',
    '티나',
    '젤로젤로',
  ];
  for (const brand of brands) {
    if (title.includes(brand)) {
      return brand;
    }
  }
  return null;
}

// 메인 임포트 함수
async function importProducts() {
  try {
    console.log('🚀 상품 임포트 시작...');

    // products.json 읽기
    const productsData = JSON.parse(
      fs.readFileSync(PRODUCTS_JSON_PATH, 'utf8'),
    );
    console.log(`📊 총 ${productsData.length}개 상품 발견`);

    // 카테고리별 통계
    const categoryStats = {};
    productsData.forEach((product) => {
      const cat = product.category;
      categoryStats[cat] = (categoryStats[cat] || 0) + 1;
    });

    console.log('📈 카테고리별 상품 수:');
    Object.entries(categoryStats).forEach(([cat, count]) => {
      console.log(`  ${cat}: ${count}개`);
    });

    // 처리할 상품 수 제한 (테스트용)
    const LIMIT = productsData.length; // 전체 상품 처리
    const productsToProcess = productsData.slice(0, LIMIT);

    console.log(`\n🔄 ${productsToProcess.length}개 상품 처리 시작...`);

    let successCount = 0;
    let failCount = 0;

    for (const product of productsToProcess) {
      const result = await createProductMaster(product);
      if (result) {
        successCount++;
      } else {
        failCount++;
      }

      // API 부하 방지를 위한 딜레이
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log('\n📊 임포트 완료!');
    console.log(`✅ 성공: ${successCount}개`);
    console.log(`❌ 실패: ${failCount}개`);
  } catch (error) {
    console.error('❌ 임포트 실패:', error.message);
  }
}

// 실행
if (require.main === module) {
  importProducts();
}

module.exports = {
  importProducts,
  createProductMaster,
  determineCategoryId,
  convertImageUrl,
  convertDetailImages,
};
