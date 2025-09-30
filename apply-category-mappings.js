// GPT 매핑 결과를 적용하는 스크립트
const PIM_BASE_URL = 'http://localhost:3000';

// GPT-5의 매핑 결과
const mappingData = `1,01999bf0-546b-75c0-a22e-1d42af8bdcfa,메이크업
2,01999bf0-4d6c-700d-bce7-4b9757c0b15d,메이크업
3,01999bf0-4673-715f-98f0-319ae165e0fd,메이크업
4,01999bf0-3f40-751b-a684-c8d68dc1757e,속눈썹 > 세트
5,01999bf0-3808-74ff-acb1-53361d611dbe,메이크업
6,01999bf0-3119-74f9-9c4c-acecb30fc56a,네일 > 네일재료
7,01999bf0-2a1a-71fc-9256-a53a882a0b6d,네일 > 네일재료
8,01999bf0-2317-71db-b3b0-53be752ba42d,속눈썹 > 핀셋
9,01999bf0-1c3e-7283-a6f7-61de76162025,속눈썹 > 핀셋
10,01999bf0-155a-7149-a3b1-ac968e83f24a,네일 > 네일재료
11,01999bf0-0e65-75d3-ad28-48d2475b12d9,네일 > 네일재료
12,01999bf0-078d-720b-ac03-321e1eed844a,네일 > 네일재료
13,01999bf0-008e-73ff-bf5c-7b4ce231d861,네일 > 네일재료
14,01999bef-f90a-74a2-bae3-ce67319f60c7,네일 > 네일재료
15,01999bef-f1b3-7248-95ab-c489d0440163,피부미용 > 기타소품
16,01999bef-eac8-735c-b448-ba406a5a0638,네일 > 네일재료
17,01999bef-e3a4-71ab-bc76-8c549e0d8338,메이크업
18,01999bef-dcaf-739d-ad1f-b61a54ef59b0,메이크업
19,01999bef-d5c0-743f-b9eb-cff7e6da05cd,헤어 > 스타일링
20,01999bef-ced7-746f-b5c3-55968ddbd2a6,헤어 > 소도구
21,01999bef-c7dc-77c6-9cbc-2698231e8e8f,헤어 > 브러시/핀셋
22,01999bef-c0e4-72b4-9f6c-2280f8c2da6e,헤어 > 소도구
23,01999bef-b9d6-7133-849b-77b6243c0c8a,헤어 > 브러시/핀셋
24,01999bef-b2d7-76c3-8018-20392affc8f2,헤어 > 소도구
25,01999bef-abe0-7166-bf9e-3ce46d6ad36c,헤어 > 소도구
26,01999bef-a500-733c-a6c0-cdc0334aa883,헤어 > 가발
27,01999bef-9df9-75aa-bae3-1376b7848324,헤어 > 클리닉
28,01999bef-971b-777c-86d0-fa5300560dee,헤어 > 소도구
29,01999bef-9021-73d8-bc21-3576227a3a83,헤어 > 소도구
30,01999bef-891e-729a-9693-519f98b00ba8,헤어 > 가발
31,01999bef-8229-779a-80b3-b9a095715b26,헤어 > 샴푸/린스
32,01999bef-7ac9-7465-888a-176300b75385,헤어 > 가발
33,01999bef-73f9-7634-9a0c-c059127fb1b9,헤어 > 가발
34,01999bef-6cf5-77fa-8853-b1540e984be5,헤어 > 가발
35,01999bef-65f4-72d1-8d28-d0022171a68f,헤어 > 가발
36,01999bef-5eeb-71df-b415-99b7972e50c7,헤어 > 가발
37,01999bef-57a8-738b-9a83-639d87120605,헤어 > 가발
38,01999bef-50c2-7407-b781-636648c43428,피부미용 > 기타소품
39,01999bef-49b7-760f-9067-468de2e3c964,반영구 > 고무판
40,01999bef-42b5-76ec-b93e-f12051e1af62,반영구 > 부자재
41,01999bef-3ade-7283-9852-122c6a99534a,왁싱 > 부자재
42,01999bef-33e4-774d-a7fe-13ad66279f3f,반영구 > 엠보&수지펜
43,01999bef-2d14-71d8-8b03-ea081bedca43,왁싱 > 부자재
44,01999bef-2621-76ed-ab9f-2680e2b9f22c,반영구 > 부자재
45,01999bef-1f5b-71bb-813f-a3e9c2df16fd,피부미용 > 기타소품
46,01999bef-1866-706d-8d3e-8283c7e8d52f,반영구 > 부자재
47,01999bef-1191-7038-b2bb-d5b2b4552a8c,속눈썹 > 펌글루&왁스
48,01999bef-09bc-736f-ad34-9161755b4e97,속눈썹 > 펌글루&왁스
49,01999bef-02fc-70a2-aa25-1463864545c0,네일 > 네일재료
50,01999bee-fc05-71a0-be40-605b3e7afb1e,네일 > 네일재료
51,01999bee-f517-775e-928e-ccd1744b73a3,네일 > 네일재료
52,01999bee-ee2e-73b9-b63a-4ddd736e11d0,네일 > 네일재료
53,01999bee-e74c-710f-8bb4-7b3bbeb01415,네일 > 네일기계
54,01999bee-e054-7379-942e-970dcd45e038,네일 > 네일 파츠
55,01999bee-d974-77dd-8c1b-edc9590acf02,네일 > 네일 파츠
56,01999bee-d262-7633-997d-a410ecc6ff8c,네일 > 네일 파츠
57,01999bee-cb87-760c-965d-1623dcd51174,네일 > 네일재료
58,01999bee-c488-7458-825f-b4351d3763b6,네일 > 네일기계
59,01999bd7-e2f3-762f-b882-ba468de31bcf,왁싱 > 전후처리제
60,01999bd7-dbe8-70fa-a89e-9a020164ace4,왁싱 > 전후처리제
61,01999bd7-d4f0-7046-a89e-028a2823bcc4,왁싱 > 왁스
62,01999bd7-ccf2-775c-b214-497f279dd495,왁싱 > 전후처리제
63,01999bd7-c5cb-7179-83e9-c200e29e7520,왁싱 > 부자재
64,01999bd7-be93-74a1-acfa-6ef9673fddd4,왁싱 > 부자재
65,01999b23-2cab-700d-92e4-08ac5f6c1236,헤어 > 가운/타월
66,01999b23-28d1-7109-8061-f264bc7fe57b,네일 > 네일재료
67,01999b23-24fb-720f-b793-c5c541ed99d0,클래스
68,01999b23-2120-7149-8089-d5b613e975d2,클래스
69,01999b23-1d4b-76bc-b2f8-55cdcc6ddc64,네일 > 젤네일
70,01999b23-197a-72de-ae38-2acd37df98f3,반영구 > 색소
71,01999b23-15a0-77f5-aec2-8c1dba5b5d8c,반영구 > 색소
72,01999b23-11ac-76d8-abef-a1c2096dca92,반영구 > 색소
73,01999b23-0dd3-734d-b8a1-e9124229c2cf,반영구 > 색소
74,01999b23-09fb-75c9-9f18-e365a6da7093,반영구 > 색소
75,01999b23-0623-7789-937f-14c56f945d11,속눈썹 > 리무버&전처리제
76,01999b22-ffa8-7500-858a-244238808070,속눈썹 > 리무버&전처리제
77,01999b22-fbdc-770e-a9fc-7fea1540af46,속눈썹 > 리무버&전처리제
78,01999b22-f80f-720d-ade3-5735cb32027f,속눈썹 > 롯드
79,01999b22-f437-71aa-ba23-5195e382a752,속눈썹 > 롯드
80,01999b22-f066-743d-913f-dfb9e0b7340f,속눈썹 > 펌글루&왁스
81,01999b22-ebe8-714a-bbfd-c0865da8c30d,속눈썹 > 롯드
82,01999b22-e80e-71ac-b2dd-c1cad99e45f5,반영구 > 니들
83,01999b22-e428-7193-b3b4-cc8de967be7e,반영구 > 색소
84,01999b22-e044-7540-be5d-a33e099faf47,디지털 템플릿
85,01999b22-dc59-70ca-95c9-f45eae084723,디지털 템플릿
86,01999b22-d87d-72d9-8beb-817c31a3d93c,디지털 템플릿
87,01999b22-d3f4-7558-9624-0dafd06356a4,디지털 템플릿
88,01999b22-d015-7318-830a-cf74c2d2fd21,디지털 템플릿
89,01999b22-cbe8-748e-bce2-7b753c3a9ca4,디지털 템플릿
90,01999b22-c808-71df-9fe0-474d3b7b5d0e,속눈썹 > 롯드
91,01999b22-c41c-7388-85b4-46a0a5e90d68,혜택 / 서비스
92,01999b22-c02b-751b-830d-878e8a228398,혜택 / 서비스
93,01999b22-bc2d-73ca-820c-c2eb4ba761b7,피부미용 > 미용기기
94,01999b22-b847-716e-8062-c5ea5da36983,반영구 > 색소
95,01999b22-b461-74f7-a0d3-844baaa5a4bc,속눈썹 > 영양제
96,01999b22-b084-75a9-baca-828ca45cc860,속눈썹 > 영양제
97,01999b22-aca2-7131-abb0-0190d8fddd39,타투 > 머신
98,01999b22-a8b1-7770-9c2a-efdf6e6ccd16,혜택 / 서비스
99,01999b22-a25c-722e-8918-a6e4fc2e063e,속눈썹 > 롯드`;

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

// 카테고리 목록 가져오기
async function getAllCategories() {
  const response = await fetchWithTimeout(`${PIM_BASE_URL}/categories`);
  const categoryTree = await response.json();

  const categoryMap = new Map(); // name -> id
  const categoryIdMap = new Map(); // id -> name

  function flattenCategories(categories) {
    for (const cat of categories) {
      categoryMap.set(cat.name, cat.id);
      categoryIdMap.set(cat.id, cat.name);
      if (cat.children && cat.children.length > 0) {
        flattenCategories(cat.children);
      }
    }
  }

  if (categoryTree.categories) {
    flattenCategories(categoryTree.categories);
  }

  return { categoryMap, categoryIdMap };
}

// 상품의 기존 카테고리 조회
async function getProductCategories(productId) {
  try {
    const response = await fetchWithTimeout(
      `${PIM_BASE_URL}/masters/${productId}`,
      {},
      5000,
    );
    if (!response.ok) return [];
    const product = await response.json();
    return product.categories || [];
  } catch (error) {
    return [];
  }
}

// 상품을 카테고리에 추가 (기존 유지) - 고지훈 수정: POST /add 사용
async function addProductToCategory(
  productId,
  categoryId,
  existingCategoryIds,
) {
  try {
    // 이미 연결되어 있으면 스킵
    if (existingCategoryIds.includes(categoryId)) {
      return true; // 이미 연결됨
    }

    const response = await fetchWithTimeout(
      `${PIM_BASE_URL}/categories/${categoryId}/products/add`,
      {
        method: 'POST',
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

// 매핑 데이터 파싱
function parseMappingData(data) {
  const lines = data.trim().split('\n');
  const mappings = [];

  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length >= 3) {
      const no = parts[0].trim();
      const productId = parts[1].trim();
      const categoryPath = parts.slice(2).join(',').trim(); // 카테고리명에 쉼표가 있을 수 있음

      mappings.push({
        no: parseInt(no),
        productId,
        categoryPath,
      });
    }
  }

  return mappings;
}

// 카테고리 경로에서 실제 카테고리명 추출 (마지막 부분)
function getCategoryName(categoryPath) {
  const parts = categoryPath.split('>').map((p) => p.trim());
  return parts[parts.length - 1]; // 마지막 부분이 실제 카테고리
}

// 메인 함수
async function applyMappings() {
  console.log('🚀 카테고리 매핑 적용 시작\n');
  console.log('='.repeat(60));

  // 1. 카테고리 목록 조회
  console.log('📁 카테고리 목록 조회 중...');
  const { categoryMap, categoryIdMap } = await getAllCategories();
  console.log(`✅ ${categoryMap.size}개 카테고리 로드 완료\n`);

  // 2. 매핑 데이터 파싱
  console.log('📋 매핑 데이터 파싱 중...');
  const mappings = parseMappingData(mappingData);
  console.log(`✅ ${mappings.length}개 매핑 데이터 파싱 완료\n`);

  console.log('='.repeat(60));
  console.log('\n🔗 카테고리 매핑 적용 중...\n');

  let successCount = 0;
  let failCount = 0;
  let notFoundCount = 0;
  const errors = [];

  for (let i = 0; i < mappings.length; i++) {
    const mapping = mappings[i];
    const categoryName = getCategoryName(mapping.categoryPath);

    console.log(
      `[${i + 1}/${mappings.length}] 상품 #${mapping.no}: ${mapping.categoryPath}`,
    );

    // 카테고리 ID 찾기
    const categoryId = categoryMap.get(categoryName);
    if (!categoryId) {
      console.log(`  ❌ 카테고리를 찾을 수 없음: ${categoryName}\n`);
      notFoundCount++;
      errors.push({
        no: mapping.no,
        productId: mapping.productId,
        categoryPath: mapping.categoryPath,
        error: `카테고리를 찾을 수 없음: ${categoryName}`,
      });
      continue;
    }

    // 기존 카테고리 조회
    const existingCategories = await getProductCategories(mapping.productId);
    const existingCategoryIds = existingCategories.map((c) => c.id);
    const existingNames = existingCategories
      .map((c) => categoryIdMap.get(c.id))
      .filter(Boolean);

    console.log(`  현재 카테고리: ${existingNames.join(', ') || '없음'}`);

    // 이미 있는지 확인
    if (existingCategoryIds.includes(categoryId)) {
      console.log(`  ✓ 이미 ${categoryName}에 있음, 유지\n`);
      successCount++;
      continue;
    }

    // 카테고리 추가
    const success = await addProductToCategory(
      mapping.productId,
      categoryId,
      existingCategoryIds,
    );

    if (success) {
      console.log(`  ✅ ${categoryName}에 추가 성공`);
      console.log(`  → 최종: ${[...existingNames, categoryName].join(', ')}\n`);
      successCount++;
    } else {
      console.log(`  ❌ ${categoryName}에 추가 실패\n`);
      failCount++;
      errors.push({
        no: mapping.no,
        productId: mapping.productId,
        categoryPath: mapping.categoryPath,
        error: '카테고리 추가 실패',
      });
    }

    // 서버 부하 방지
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.log('='.repeat(60));
  console.log('\n📊 매핑 적용 결과:');
  console.log(`  ✅ 성공: ${successCount}개`);
  console.log(`  ❌ 실패: ${failCount}개`);
  console.log(`  ⚠️  카테고리 없음: ${notFoundCount}개`);
  console.log(`  📦 전체: ${mappings.length}개`);

  if (errors.length > 0) {
    console.log(`\n❌ 오류 목록:`);
    errors.forEach((err) => {
      console.log(`  - 상품 #${err.no}: ${err.categoryPath}`);
      console.log(`    ID: ${err.productId}`);
      console.log(`    오류: ${err.error}\n`);
    });
  } else {
    console.log('\n🎉 모든 매핑이 성공적으로 적용되었습니다!');
  }
}

applyMappings().catch(console.error);
