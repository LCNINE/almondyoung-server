// 특정 상품이 여러 카테고리에 속해 있는지 확인
const PIM_BASE_URL = 'http://localhost:3000';

async function verifyMultiCategory() {
  console.log('🔍 다대다 관계 검증 시작\n');

  // 테스트 상품: [웰컴 멤버십] 네일 드릴
  const testProductId = '01999bee-c488-7458-825f-b4351d3763b6';
  const testProductName = '[웰컴 멤버십] 네일 드릴 비트 샌딩 밴드 풀세트';

  console.log(`📦 테스트 상품: ${testProductName}`);
  console.log(`   ID: ${testProductId}\n`);

  // 1. 네일 > 네일기계 카테고리에서 검색
  const nailMachineCategoryId = '0199986b-6329-70cf-8acc-c4875d5c4d6a'; // 네일기계 (올바른 ID)
  console.log('1️⃣  네일기계 카테고리에서 검색...');
  const nailResponse = await fetch(
    `${PIM_BASE_URL}/masters?categoryId=${nailMachineCategoryId}`,
  );
  const nailData = await nailResponse.json();
  const inNailCategory = nailData.data.some((p) => p.id === testProductId);
  console.log(
    `   ${inNailCategory ? '✅ 발견됨' : '❌ 없음'} (총 ${nailData.total}개 상품)\n`,
  );

  // 2. 100원 웰컴딜 카테고리에서 검색
  const welcomeDealCategoryId = '01999bee-bf43-704d-a367-2b49c14c38f2';
  console.log('2️⃣  100원 웰컴딜 카테고리에서 검색...');
  const welcomeResponse = await fetch(
    `${PIM_BASE_URL}/masters?categoryId=${welcomeDealCategoryId}`,
  );
  const welcomeData = await welcomeResponse.json();
  const inWelcomeCategory = welcomeData.data.some(
    (p) => p.id === testProductId,
  );
  console.log(
    `   ${inWelcomeCategory ? '✅ 발견됨' : '❌ 없음'} (총 ${welcomeData.total}개 상품)\n`,
  );

  // 결과
  console.log('============================================================');
  if (inNailCategory && inWelcomeCategory) {
    console.log('🎉 성공! 상품이 두 카테고리에 모두 속해 있습니다.');
    console.log('   → 다대다 관계가 제대로 작동하고 있습니다.');
  } else if (!inNailCategory && inWelcomeCategory) {
    console.log('⚠️  주의! 상품이 100원 웰컴딜에만 속해 있습니다.');
    console.log('   → 기존 네일 카테고리가 삭제되었습니다.');
  } else if (inNailCategory && !inWelcomeCategory) {
    console.log('⚠️  주의! 상품이 네일 카테고리에만 속해 있습니다.');
    console.log('   → 100원 웰컴딜 연결이 실패했습니다.');
  } else {
    console.log('❌ 오류! 상품이 어느 카테고리에도 없습니다.');
  }
  console.log('============================================================');
}

verifyMultiCategory().catch(console.error);
