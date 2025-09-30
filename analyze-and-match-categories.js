// 카테고리 분석 및 매칭 스크립트
const PIM_BASE_URL = 'http://localhost:3000';

// 타임아웃 fetch 함수
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

// 모든 카테고리 조회
async function getAllCategories() {
  console.log('📁 카테고리 목록 조회 중...\n');
  const response = await fetchWithTimeout(`${PIM_BASE_URL}/categories`);
  const categoryTree = await response.json();

  const categoryMap = new Map();
  const categoryList = [];

  function flattenCategories(categories, depth = 0) {
    for (const cat of categories) {
      categoryMap.set(cat.name, cat.id);
      categoryMap.set(cat.id, cat.name);
      categoryList.push({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        depth,
      });
      if (cat.children && cat.children.length > 0) {
        flattenCategories(cat.children, depth + 1);
      }
    }
  }

  if (categoryTree.categories) {
    flattenCategories(categoryTree.categories);
  }

  console.log(`✅ 총 ${categoryList.length}개 카테고리 발견\n`);
  console.log('📋 카테고리 목록:');
  categoryList.forEach((cat) => {
    const indent = '  '.repeat(cat.depth);
    console.log(`${indent}- ${cat.name} (${cat.id})`);
  });

  return { categoryMap, categoryList };
}

// 모든 상품 조회 (페이지네이션 처리)
async function getAllProducts() {
  console.log('\n\n🛍️  상품 목록 조회 중...\n');

  let allProducts = [];
  let page = 1;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const response = await fetchWithTimeout(
      `${PIM_BASE_URL}/masters?page=${page}&limit=${limit}`,
    );
    const data = await response.json();

    allProducts = allProducts.concat(data.data || []);

    console.log(
      `  페이지 ${page}: ${data.data?.length || 0}개 (총 ${allProducts.length}개)`,
    );

    hasMore = data.data && data.data.length === limit;
    page++;

    // 안전장치
    if (page > 20) break;
  }

  console.log(`\n✅ 총 ${allProducts.length}개 상품 발견\n`);
  return allProducts;
}

// 상품의 카테고리 조회
async function getProductCategories(productId) {
  try {
    const response = await fetchWithTimeout(
      `${PIM_BASE_URL}/masters/${productId}`,
      {},
      5000,
    );
    if (!response.ok) return [];

    const product = await response.json();
    // 카테고리 정보가 있는지 확인 (응답 구조에 따라 조정 필요)
    return product.categories || [];
  } catch (error) {
    return [];
  }
}

// 상품명 기반 카테고리 추천
function recommendCategory(productName, categoryList) {
  const name = productName.toLowerCase();

  // 카테고리 키워드 매핑
  const categoryKeywords = {
    왁싱: ['왁스', '왁싱', 'wax', '제모', '트위지스트랩', '하드왁스', '워머'],
    타투: [
      '타투',
      'tattoo',
      '머신',
      '니들',
      'needle',
      '잉크',
      'ink',
      '펜',
      'mast',
      'airbot',
    ],
    피부미용: [
      '피부',
      '미용',
      '스킨',
      'skin',
      '케어',
      'care',
      '에센스',
      '크림',
      '세럼',
    ],
    속눈썹: [
      '속눈썹',
      '래시',
      'lash',
      '익스텐션',
      'extension',
      '글루',
      'glue',
      '리무버',
    ],
    네일: ['네일', 'nail', '젤', 'gel', '폴리시', 'polish', '팁', 'tip'],
    반영구: ['반영구', '눈썹', '아이라인', 'eyebrow', '피그먼트', 'pigment'],
    메이크업: ['메이크업', 'makeup', '립스틱', '파운데이션', '섀도우'],
    기기: ['기기', '장비', '머신', 'machine', '기계', '디바이스'],
  };

  // 각 카테고리별 매칭 점수 계산
  const scores = {};
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    scores[category] = 0;
    for (const keyword of keywords) {
      if (name.includes(keyword)) {
        scores[category] += keyword.length; // 키워드 길이로 가중치
      }
    }
  }

  // 가장 높은 점수의 카테고리 찾기
  let bestCategory = null;
  let bestScore = 0;
  for (const [category, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  // 해당 카테고리가 실제로 존재하는지 확인
  if (bestCategory) {
    const matchedCategory = categoryList.find((c) => c.name === bestCategory);
    if (matchedCategory) {
      return {
        categoryName: bestCategory,
        categoryId: matchedCategory.id,
        confidence: bestScore > 3 ? 'high' : 'medium',
      };
    }
  }

  return null;
}

// 상품을 카테고리에 연결
async function linkProductToCategory(productId, categoryId) {
  try {
    const response = await fetchWithTimeout(
      `${PIM_BASE_URL}/categories/${categoryId}/products`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          productIds: [productId],
        }),
      },
      10000,
    );

    return response.ok;
  } catch (error) {
    console.error(`  ❌ 연결 실패: ${error.message}`);
    return false;
  }
}

// 메인 함수
async function analyzeAndMatch() {
  console.log('🚀 카테고리 분석 및 매칭 시작\n');
  console.log('='.repeat(60));

  // 1. 카테고리 목록 조회
  const { categoryMap, categoryList } = await getAllCategories();

  // 2. 상품 목록 조회
  const products = await getAllProducts();

  console.log('='.repeat(60));
  console.log('\n🔍 카테고리 매칭 분석 중...\n');

  // 3. 카테고리 없는 상품 찾기 (간단히 체크)
  const unmatchedProducts = [];
  const matchedProducts = [];

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const categories = await getProductCategories(product.id);

    if (categories.length === 0) {
      unmatchedProducts.push(product);
    } else {
      matchedProducts.push(product);
    }

    // 진행상황 표시 (10개마다)
    if ((i + 1) % 10 === 0) {
      console.log(`  진행: ${i + 1}/${products.length} 확인 완료...`);
    }
  }

  console.log(`\n✅ 분석 완료!`);
  console.log(`  - 카테고리 있음: ${matchedProducts.length}개`);
  console.log(`  - 카테고리 없음: ${unmatchedProducts.length}개\n`);

  if (unmatchedProducts.length === 0) {
    console.log('🎉 모든 상품이 이미 카테고리에 매칭되어 있습니다!');
    return;
  }

  console.log('='.repeat(60));
  console.log('\n📝 카테고리 없는 상품 목록:\n');

  const recommendations = [];

  unmatchedProducts.forEach((product, index) => {
    const recommendation = recommendCategory(product.name, categoryList);
    recommendations.push({
      product,
      recommendation,
    });

    console.log(`${index + 1}. ${product.name}`);
    console.log(`   ID: ${product.id}`);
    if (recommendation) {
      console.log(
        `   추천 카테고리: ${recommendation.categoryName} (신뢰도: ${recommendation.confidence})`,
      );
    } else {
      console.log(`   추천 카테고리: 없음 (수동 분류 필요)`);
    }
    console.log('');
  });

  // 4. 자동 매칭 여부 물어보기 (일단 바로 실행)
  console.log('='.repeat(60));
  console.log('\n🔗 자동 매칭 시작...\n');

  let successCount = 0;
  let failCount = 0;

  for (const { product, recommendation } of recommendations) {
    if (recommendation && recommendation.confidence === 'high') {
      console.log(`🔗 ${product.name.substring(0, 50)}...`);
      console.log(`   → ${recommendation.categoryName}`);

      const success = await linkProductToCategory(
        product.id,
        recommendation.categoryId,
      );

      if (success) {
        console.log(`   ✅ 연결 성공\n`);
        successCount++;
      } else {
        console.log(`   ❌ 연결 실패\n`);
        failCount++;
      }

      // 서버 부하 방지
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  console.log('='.repeat(60));
  console.log('\n📊 매칭 결과:');
  console.log(`  ✅ 성공: ${successCount}개`);
  console.log(`  ❌ 실패: ${failCount}개`);
  console.log(
    `  ⏭️  스킵 (낮은 신뢰도): ${unmatchedProducts.length - successCount - failCount}개`,
  );
  console.log('\n🎉 작업 완료!');
}

// 실행
analyzeAndMatch().catch(console.error);
