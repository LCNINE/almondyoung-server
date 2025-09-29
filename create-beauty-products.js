#!/usr/bin/env node

/**
 * 미용샵 PIM API를 통한 샘플 상품 30개 생성 스크립트
 *
 * 사용법:
 * 1. PIM 서버가 실행 중인지 확인
 * 2. node create-beauty-products.js
 */

const API_BASE_URL = 'http://localhost:3000'; // PIM 서버 URL

// 미용샵 전용 상품 데이터 (헤어케어, 왁싱, 타투 제품)
const beautyProducts = [
  // 헤어케어 제품 (10개)
  {
    name: '케라스타즈 레지스탕스 샴푸',
    description: '손상모발 전용 강화 샴푸',
    brand: 'Kerastase',
    basePrice: 45000,
    pricingStrategy: 'option_based',
    tags: ['샴푸', '손상모발', '프리미엄'],
    images: ['https://via.placeholder.com/400x400?text=Kerastase+Shampoo'],
    attributes: { category: '헤어케어', volume: '250ml', hairType: '손상모발' },
    optionGroups: [
      {
        name: 'size',
        displayName: '용량',
        sortOrder: 1,
        values: [
          { value: '250ml', displayName: '250ml', sortOrder: 1, price: 0 },
          { value: '500ml', displayName: '500ml', sortOrder: 2, price: 25000 },
        ],
      },
    ],
  },
  {
    name: '로레알 프로페셔널 컬러 트리트먼트',
    description: '염색모발 전용 컬러 보호 트리트먼트',
    brand: "L'Oreal Professional",
    basePrice: 38000,
    pricingStrategy: 'option_based',
    tags: ['트리트먼트', '염색모발', '컬러보호'],
    images: ['https://via.placeholder.com/400x400?text=LOreal+Treatment'],
    attributes: { category: '헤어케어', volume: '200ml', hairType: '염색모발' },
  },
  {
    name: '웰라 프로페셔널 퓨전 샴푸',
    description: '집중 영양 공급 샴푸',
    brand: 'Wella Professional',
    basePrice: 42000,
    pricingStrategy: 'option_based',
    tags: ['샴푸', '영양공급', '프로페셔널'],
    images: ['https://via.placeholder.com/400x400?text=Wella+Fusion'],
    attributes: { category: '헤어케어', volume: '250ml', hairType: '건조모발' },
  },
  {
    name: '슈바르츠코프 오일 울티메이트',
    description: '아르간 오일 헤어 에센스',
    brand: 'Schwarzkopf',
    basePrice: 35000,
    pricingStrategy: 'option_based',
    tags: ['헤어오일', '아르간오일', '에센스'],
    images: ['https://via.placeholder.com/400x400?text=Schwarzkopf+Oil'],
    attributes: { category: '헤어케어', volume: '100ml', type: '헤어오일' },
  },
  {
    name: '모로칸오일 트리트먼트',
    description: '아르간 오일 헤어 트리트먼트',
    brand: 'Moroccanoil',
    basePrice: 48000,
    pricingStrategy: 'option_based',
    tags: ['헤어오일', '모로칸오일', '프리미엄'],
    images: ['https://via.placeholder.com/400x400?text=Moroccanoil'],
    attributes: { category: '헤어케어', volume: '100ml', origin: '모로코' },
  },
  {
    name: '오라플렉스 본드 빌더',
    description: '모발 결합 강화 트리트먼트',
    brand: 'Olaplex',
    basePrice: 65000,
    pricingStrategy: 'option_based',
    tags: ['본드빌더', '모발복구', '프리미엄'],
    images: ['https://via.placeholder.com/400x400?text=Olaplex+Bond'],
    attributes: { category: '헤어케어', volume: '100ml', type: '본드빌더' },
  },
  {
    name: '케네스 헤어 스프레이',
    description: '강력 고정 헤어 스프레이',
    brand: 'Kenra',
    basePrice: 28000,
    pricingStrategy: 'option_based',
    tags: ['헤어스프레이', '스타일링', '고정력'],
    images: ['https://via.placeholder.com/400x400?text=Kenra+Spray'],
    attributes: { category: '스타일링', volume: '300ml', hold: '강력고정' },
  },
  {
    name: '세바스찬 드라이 샴푸',
    description: '볼륨업 드라이 샴푸',
    brand: 'Sebastian',
    basePrice: 32000,
    pricingStrategy: 'option_based',
    tags: ['드라이샴푸', '볼륨', '스타일링'],
    images: ['https://via.placeholder.com/400x400?text=Sebastian+Dry'],
    attributes: { category: '스타일링', volume: '200ml', effect: '볼륨업' },
  },
  {
    name: '티지 베드헤드 왁스',
    description: '매트 피니쉬 헤어 왁스',
    brand: 'TIGI Bed Head',
    basePrice: 25000,
    pricingStrategy: 'option_based',
    tags: ['헤어왁스', '매트', '스타일링'],
    images: ['https://via.placeholder.com/400x400?text=TIGI+Wax'],
    attributes: { category: '스타일링', volume: '85g', finish: '매트' },
  },
  {
    name: '폴 미첼 티트리 샴푸',
    description: '티트리 오일 클렌징 샴푸',
    brand: 'Paul Mitchell',
    basePrice: 39000,
    pricingStrategy: 'option_based',
    tags: ['티트리', '클렌징', '자연성분'],
    images: ['https://via.placeholder.com/400x400?text=Paul+Mitchell'],
    attributes: {
      category: '헤어케어',
      volume: '300ml',
      ingredient: '티트리오일',
    },
  },

  // 왁싱 제품 (10개)
  {
    name: '지지 브라질리언 하드 왁스',
    description: '민감성 피부용 하드 왁스',
    brand: 'GiGi',
    basePrice: 35000,
    pricingStrategy: 'option_based',
    tags: ['하드왁스', '브라질리언', '민감성피부'],
    images: ['https://via.placeholder.com/400x400?text=GiGi+Brazilian'],
    attributes: { category: '왁싱', weight: '396g', type: '하드왁스' },
    optionGroups: [
      {
        name: 'type',
        displayName: '왁스타입',
        sortOrder: 1,
        values: [
          { value: 'hard', displayName: '하드왁스', sortOrder: 1, price: 0 },
          {
            value: 'soft',
            displayName: '소프트왁스',
            sortOrder: 2,
            price: -5000,
          },
        ],
      },
    ],
  },
  {
    name: '시론 아주렌 왁스',
    description: '아주렌 성분 진정 왁스',
    brand: 'Cirepil',
    basePrice: 42000,
    pricingStrategy: 'option_based',
    tags: ['아주렌왁스', '진정효과', '프리미엄'],
    images: ['https://via.placeholder.com/400x400?text=Cirepil+Azulene'],
    attributes: { category: '왁싱', weight: '400g', ingredient: '아주렌' },
  },
  {
    name: '페론 로진 왁스',
    description: '천연 로진 성분 왁스',
    brand: 'Perron Rigot',
    basePrice: 38000,
    pricingStrategy: 'option_based',
    tags: ['로진왁스', '천연성분', '프랑스'],
    images: ['https://via.placeholder.com/400x400?text=Perron+Rosin'],
    attributes: { category: '왁싱', weight: '800g', origin: '프랑스' },
  },
  {
    name: '나드 바디 왁스',
    description: '바디 전용 스트립 왁스',
    brand: "Nad's",
    basePrice: 28000,
    pricingStrategy: 'option_based',
    tags: ['바디왁스', '스트립왁스', '간편사용'],
    images: ['https://via.placeholder.com/400x400?text=Nads+Body'],
    attributes: { category: '왁싱', type: '스트립왁스', area: '바디' },
  },
  {
    name: '베레 프로페셔널 왁스',
    description: '살롱 전용 프로페셔널 왁스',
    brand: 'Berins',
    basePrice: 45000,
    pricingStrategy: 'option_based',
    tags: ['프로페셔널', '살롱전용', '고품질'],
    images: ['https://via.placeholder.com/400x400?text=Berins+Pro'],
    attributes: { category: '왁싱', weight: '500g', grade: '프로페셔널' },
  },
  {
    name: '왁스웰 하니 왁스',
    description: '천연 꿀 성분 왁스',
    brand: 'Waxwell',
    basePrice: 32000,
    pricingStrategy: 'option_based',
    tags: ['하니왁스', '천연꿀', '보습효과'],
    images: ['https://via.placeholder.com/400x400?text=Waxwell+Honey'],
    attributes: { category: '왁싱', weight: '400g', ingredient: '천연꿀' },
  },
  {
    name: '스킨 액트 프리 왁스 스트립',
    description: '페이셜 전용 왁스 스트립',
    brand: 'Skin Act',
    basePrice: 18000,
    pricingStrategy: 'option_based',
    tags: ['페이셜왁스', '스트립', '간편'],
    images: ['https://via.placeholder.com/400x400?text=SkinAct+Strip'],
    attributes: { category: '왁싱', count: '20매', area: '페이셜' },
  },
  {
    name: '리코 왁스 히터',
    description: '프로페셔널 왁스 히터',
    brand: 'Rico',
    basePrice: 85000,
    pricingStrategy: 'option_based',
    tags: ['왁스히터', '프로페셔널', '장비'],
    images: ['https://via.placeholder.com/400x400?text=Rico+Heater'],
    attributes: { category: '왁싱장비', power: '100W', capacity: '500ml' },
  },
  {
    name: '왁싱 애프터케어 로션',
    description: '왁싱 후 진정 로션',
    brand: 'Beauty Care',
    basePrice: 22000,
    pricingStrategy: 'option_based',
    tags: ['애프터케어', '진정로션', '왁싱후'],
    images: ['https://via.placeholder.com/400x400?text=Aftercare+Lotion'],
    attributes: { category: '왁싱케어', volume: '250ml', effect: '진정' },
  },
  {
    name: '왁싱 프리 오일',
    description: '왁싱 전 보호 오일',
    brand: 'Pre Care',
    basePrice: 25000,
    pricingStrategy: 'option_based',
    tags: ['프리오일', '보호', '왁싱전'],
    images: ['https://via.placeholder.com/400x400?text=Pre+Oil'],
    attributes: { category: '왁싱케어', volume: '200ml', use: '왁싱전' },
  },

  // 타투 제품 (10개)
  {
    name: '인트렌즈 타투 잉크 세트',
    description: '프로페셔널 타투 잉크 12색 세트',
    brand: 'Intenze',
    basePrice: 180000,
    pricingStrategy: 'option_based',
    tags: ['타투잉크', '프로페셔널', '12색세트'],
    images: ['https://via.placeholder.com/400x400?text=Intenze+Ink+Set'],
    attributes: { category: '타투잉크', colors: '12색', volume: '30ml각' },
    optionGroups: [
      {
        name: 'colorSet',
        displayName: '색상세트',
        sortOrder: 1,
        values: [
          {
            value: 'basic12',
            displayName: '기본 12색',
            sortOrder: 1,
            price: 0,
          },
          {
            value: 'premium24',
            displayName: '프리미엄 24색',
            sortOrder: 2,
            price: 120000,
          },
        ],
      },
    ],
  },
  {
    name: '월드 페이머스 블랙 잉크',
    description: '최고급 블랙 타투 잉크',
    brand: 'World Famous',
    basePrice: 25000,
    pricingStrategy: 'option_based',
    tags: ['블랙잉크', '최고급', '타투'],
    images: ['https://via.placeholder.com/400x400?text=World+Famous+Black'],
    attributes: { category: '타투잉크', color: '블랙', volume: '30ml' },
  },
  {
    name: '이터널 잉크 컬러 세트',
    description: '비건 타투 잉크 컬러 세트',
    brand: 'Eternal Ink',
    basePrice: 150000,
    pricingStrategy: 'option_based',
    tags: ['비건잉크', '컬러세트', '친환경'],
    images: ['https://via.placeholder.com/400x400?text=Eternal+Color'],
    attributes: { category: '타투잉크', colors: '10색', type: '비건' },
  },
  {
    name: '타투 머신 로터리',
    description: '프로페셔널 로터리 타투 머신',
    brand: 'Bishop',
    basePrice: 450000,
    pricingStrategy: 'variant_based',
    tags: ['타투머신', '로터리', '프로페셔널'],
    images: ['https://via.placeholder.com/400x400?text=Bishop+Rotary'],
    attributes: { category: '타투장비', type: '로터리', weight: '120g' },
  },
  {
    name: '타투 니들 카트리지 세트',
    description: '일회용 타투 니들 카트리지',
    brand: 'Kwadron',
    basePrice: 85000,
    pricingStrategy: 'option_based',
    tags: ['타투니들', '카트리지', '일회용'],
    images: ['https://via.placeholder.com/400x400?text=Kwadron+Needles'],
    attributes: { category: '타투니들', count: '50개', type: '카트리지' },
  },
  {
    name: '타투 파워 서플라이',
    description: '디지털 타투 파워 서플라이',
    brand: 'Critical',
    basePrice: 320000,
    pricingStrategy: 'option_based',
    tags: ['파워서플라이', '디지털', '타투장비'],
    images: ['https://via.placeholder.com/400x400?text=Critical+Power'],
    attributes: {
      category: '타투장비',
      type: '파워서플라이',
      voltage: '0-18V',
    },
  },
  {
    name: '타투 애프터케어 밤',
    description: '타투 힐링 애프터케어 밤',
    brand: 'Hustle Butter',
    basePrice: 35000,
    pricingStrategy: 'option_based',
    tags: ['애프터케어', '힐링밤', '타투케어'],
    images: ['https://via.placeholder.com/400x400?text=Hustle+Butter'],
    attributes: { category: '타투케어', volume: '150ml', type: '힐링밤' },
  },
  {
    name: '타투 스텐실 페이퍼',
    description: '타투 도안 전사 스텐실 페이퍼',
    brand: 'Spirit',
    basePrice: 28000,
    pricingStrategy: 'option_based',
    tags: ['스텐실페이퍼', '도안전사', '타투'],
    images: ['https://via.placeholder.com/400x400?text=Spirit+Stencil'],
    attributes: { category: '타투용품', count: '100매', size: 'A4' },
  },
  {
    name: '타투 글러브 니트릴',
    description: '타투 전용 니트릴 글러브',
    brand: 'Medline',
    basePrice: 15000,
    pricingStrategy: 'option_based',
    tags: ['니트릴글러브', '타투전용', '위생용품'],
    images: ['https://via.placeholder.com/400x400?text=Nitrile+Gloves'],
    attributes: { category: '타투용품', count: '100개', material: '니트릴' },
  },
  {
    name: '타투 클리닝 솔루션',
    description: '타투 과정 중 클리닝 솔루션',
    brand: 'Green Soap',
    basePrice: 18000,
    pricingStrategy: 'option_based',
    tags: ['클리닝솔루션', '그린솝', '타투'],
    images: ['https://via.placeholder.com/400x400?text=Green+Soap'],
    attributes: { category: '타투용품', volume: '500ml', type: '클리닝' },
  },
];

async function createProduct(productData) {
  try {
    const response = await fetch(`${API_BASE_URL}/masters`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(productData),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }

    const result = await response.json();
    console.log(`✅ 상품 생성 성공: ${productData.name} (ID: ${result.id})`);
    return result;
  } catch (error) {
    console.error(`❌ 상품 생성 실패: ${productData.name}`, error.message);
    return null;
  }
}

async function createAllProducts() {
  console.log('🚀 미용샵 상품 30개 생성 시작...\n');

  const results = [];

  for (let i = 0; i < beautyProducts.length; i++) {
    const product = beautyProducts[i];
    console.log(`[${i + 1}/30] ${product.name} 생성 중...`);

    const result = await createProduct(product);
    results.push(result);

    // API 부하 방지를 위한 딜레이
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const successCount = results.filter((r) => r !== null).length;
  console.log(`\n🎉 완료! 총 ${successCount}개 미용샵 상품이 생성되었습니다.`);

  if (successCount < 30) {
    console.log(`⚠️  ${30 - successCount}개 상품 생성에 실패했습니다.`);
  }

  // 생성된 상품 요약
  console.log('\n📊 생성된 상품 카테고리:');
  console.log('- 헤어케어 제품: 10개');
  console.log('- 왁싱 제품: 10개');
  console.log('- 타투 제품: 10개');
}

// 스크립트 실행
if (require.main === module) {
  createAllProducts().catch(console.error);
}

module.exports = { createAllProducts, beautyProducts };
