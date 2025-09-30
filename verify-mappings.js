// 매핑 결과 검증 스크립트
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

async function verifyMappings() {
  console.log('🔍 카테고리 매핑 검증 시작\n');
  console.log('='.repeat(60));

  // 1. 전체 카테고리 조회
  const catResponse = await fetchWithTimeout(`${PIM_BASE_URL}/categories`);
  const categoryTree = await catResponse.json();

  const categories = [];
  function flattenCategories(cats, parent = '') {
    for (const cat of cats) {
      const fullPath = parent ? `${parent} > ${cat.name}` : cat.name;
      categories.push({
        id: cat.id,
        name: cat.name,
        fullPath,
      });
      if (cat.children && cat.children.length > 0) {
        flattenCategories(cat.children, fullPath);
      }
    }
  }

  flattenCategories(categoryTree.categories);
  console.log(`📁 전체 카테고리: ${categories.length}개\n`);

  // 2. 각 카테고리별 상품 수 조회
  console.log('📊 카테고리별 상품 수:\n');

  const categoriesWithProducts = [];
  let totalProducts = 0;

  for (const cat of categories) {
    const prodResponse = await fetchWithTimeout(
      `${PIM_BASE_URL}/masters?categoryId=${cat.id}&limit=1`,
    );
    const prodData = await prodResponse.json();
    const count = prodData.pagination?.total || 0;

    if (count > 0) {
      categoriesWithProducts.push({
        ...cat,
        count,
      });
      totalProducts += count;
    }
  }

  // 상품이 있는 카테고리만 표시 (상품 수 많은 순)
  categoriesWithProducts.sort((a, b) => b.count - a.count);

  categoriesWithProducts.forEach((cat, index) => {
    const indent = '  '.repeat((cat.fullPath.match(/>/g) || []).length);
    console.log(`${indent}${cat.name}: ${cat.count}개`);
  });

  console.log('\n' + '='.repeat(60));
  console.log(
    `\n✅ 총 ${categoriesWithProducts.length}개 카테고리에 상품 배치됨`,
  );
  console.log(`📦 총 상품 수: ${totalProducts}개`);

  // 3. 카테고리 없는 상품 확인
  console.log('\n🔍 카테고리 없는 상품 확인 중...');

  const allProdsResponse = await fetchWithTimeout(
    `${PIM_BASE_URL}/masters?limit=100`,
  );
  const allProdsData = await allProdsResponse.json();
  const allProducts = allProdsData.data || [];

  let uncategorizedCount = 0;
  const uncategorizedProducts = [];

  for (const prod of allProducts) {
    // 각 카테고리에서 확인
    let hasCategory = false;
    for (const cat of categories) {
      const checkResponse = await fetchWithTimeout(
        `${PIM_BASE_URL}/masters?categoryId=${cat.id}&limit=100`,
      );
      const checkData = await checkResponse.json();
      if (checkData.data.some((p) => p.id === prod.id)) {
        hasCategory = true;
        break;
      }
    }

    if (!hasCategory) {
      uncategorizedCount++;
      uncategorizedProducts.push(prod);
    }
  }

  console.log(`\n📝 카테고리 없는 상품: ${uncategorizedCount}개`);

  if (uncategorizedCount > 0) {
    console.log('\n목록:');
    uncategorizedProducts.slice(0, 10).forEach((prod, index) => {
      console.log(`  ${index + 1}. ${prod.name}`);
    });

    if (uncategorizedCount > 10) {
      console.log(`  ... 외 ${uncategorizedCount - 10}개 더`);
    }
  }

  console.log('\n🎉 검증 완료!');
}

verifyMappings().catch(console.error);
