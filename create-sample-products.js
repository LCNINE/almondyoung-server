#!/usr/bin/env node

/**
 * PIM API를 통한 샘플 상품 30개 생성 스크립트
 *
 * 사용법:
 * 1. PIM 서버가 실행 중인지 확인
 * 2. node create-sample-products.js
 */

const API_BASE_URL = 'http://localhost:3000'; // PIM 서버 URL

// 미용샵 전용 상품 데이터
const sampleProducts = [
  // 헤어케어 제품 (10개)
  {
    name: '케라스타즈 레지스탕스 샴푸',
    description: '손상모발 전용 강화 샴푸',
    brand: 'Kerastase',
    basePrice: 45000,
    pricingStrategy: 'option_based',
    tags: ['샴푸', '손상모발', '케라스타즈'],
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
    name: 'Galaxy S24 Ultra',
    description: '삼성 갤럭시 S24 울트라',
    brand: 'Samsung',
    basePrice: 1100000,
    pricingStrategy: 'option_based',
    tags: ['스마트폰', '안드로이드'],
    images: ['https://via.placeholder.com/400x400?text=GalaxyS24Ultra'],
    attributes: { category: '스마트폰', warranty: '2년' },
  },
  {
    name: 'MacBook Pro 14',
    description: '애플 맥북 프로 14인치',
    brand: 'Apple',
    basePrice: 2500000,
    pricingStrategy: 'variant_based',
    tags: ['노트북', '프리미엄'],
    images: ['https://via.placeholder.com/400x400?text=MacBookPro14'],
    attributes: { category: '노트북', warranty: '1년' },
  },
  {
    name: 'LG 그램 17',
    description: 'LG 그램 17인치 울트라북',
    brand: 'LG',
    basePrice: 1800000,
    pricingStrategy: 'option_based',
    tags: ['노트북', '경량'],
    images: ['https://via.placeholder.com/400x400?text=LGGram17'],
    attributes: { category: '노트북', weight: '1.35kg' },
  },
  {
    name: 'iPad Pro 12.9',
    description: '아이패드 프로 12.9인치',
    brand: 'Apple',
    basePrice: 1500000,
    pricingStrategy: 'option_based',
    tags: ['태블릿', '프리미엄'],
    images: ['https://via.placeholder.com/400x400?text=iPadPro'],
    attributes: { category: '태블릿', warranty: '1년' },
  },
  {
    name: 'AirPods Pro 2세대',
    description: '애플 에어팟 프로 2세대',
    brand: 'Apple',
    basePrice: 350000,
    pricingStrategy: 'option_based',
    tags: ['이어폰', '무선'],
    images: ['https://via.placeholder.com/400x400?text=AirPodsPro2'],
    attributes: { category: '이어폰', battery: '6시간' },
  },
  {
    name: 'Sony WH-1000XM5',
    description: '소니 노이즈 캔슬링 헤드폰',
    brand: 'Sony',
    basePrice: 450000,
    pricingStrategy: 'option_based',
    tags: ['헤드폰', '노이즈캔슬링'],
    images: ['https://via.placeholder.com/400x400?text=SonyWH1000XM5'],
    attributes: { category: '헤드폰', battery: '30시간' },
  },
  {
    name: 'Nintendo Switch OLED',
    description: '닌텐도 스위치 OLED 모델',
    brand: 'Nintendo',
    basePrice: 400000,
    pricingStrategy: 'option_based',
    tags: ['게임기', '휴대용'],
    images: ['https://via.placeholder.com/400x400?text=SwitchOLED'],
    attributes: { category: '게임기', display: '7인치 OLED' },
  },
  {
    name: 'Apple Watch Series 9',
    description: '애플 워치 시리즈 9',
    brand: 'Apple',
    basePrice: 500000,
    pricingStrategy: 'option_based',
    tags: ['스마트워치', '헬스케어'],
    images: ['https://via.placeholder.com/400x400?text=AppleWatch9'],
    attributes: { category: '스마트워치', warranty: '1년' },
  },
  {
    name: 'Canon EOS R6 Mark II',
    description: '캐논 미러리스 카메라',
    brand: 'Canon',
    basePrice: 3200000,
    pricingStrategy: 'variant_based',
    tags: ['카메라', '미러리스'],
    images: ['https://via.placeholder.com/400x400?text=CanonR6Mark2'],
    attributes: { category: '카메라', resolution: '24.2MP' },
  },

  // 의류 (10개)
  {
    name: '유니클로 히트텍 내복',
    description: '발열 기능성 내복',
    brand: 'Uniqlo',
    basePrice: 25000,
    pricingStrategy: 'option_based',
    tags: ['내복', '기능성'],
    images: ['https://via.placeholder.com/400x400?text=Heattech'],
    attributes: { category: '내복', material: '폴리에스터' },
    optionGroups: [
      {
        name: 'size',
        displayName: '사이즈',
        sortOrder: 1,
        values: [
          { value: 'S', displayName: 'S', sortOrder: 1, price: 0 },
          { value: 'M', displayName: 'M', sortOrder: 2, price: 0 },
          { value: 'L', displayName: 'L', sortOrder: 3, price: 0 },
          { value: 'XL', displayName: 'XL', sortOrder: 4, price: 0 },
        ],
      },
    ],
  },
  {
    name: '나이키 에어맥스 270',
    description: '나이키 운동화',
    brand: 'Nike',
    basePrice: 150000,
    pricingStrategy: 'option_based',
    tags: ['운동화', '스포츠'],
    images: ['https://via.placeholder.com/400x400?text=AirMax270'],
    attributes: { category: '운동화', material: '메�시�' },
  },
  {
    name: '아디다스 울트라부스트 22',
    description: '아디다스 러닝화',
    brand: 'Adidas',
    basePrice: 180000,
    pricingStrategy: 'option_based',
    tags: ['러닝화', '스포츠'],
    images: ['https://via.placeholder.com/400x400?text=Ultraboost22'],
    attributes: { category: '러닝화', technology: '부스트' },
  },
  {
    name: '자라 오버사이즈 코트',
    description: '겨울 오버사이즈 코트',
    brand: 'Zara',
    basePrice: 120000,
    pricingStrategy: 'option_based',
    tags: ['코트', '겨울'],
    images: ['https://via.placeholder.com/400x400?text=OversizeCoat'],
    attributes: { category: '아우터', season: '겨울' },
  },
  {
    name: 'H&M 기본 티셔츠',
    description: '면 100% 기본 티셔츠',
    brand: 'H&M',
    basePrice: 15000,
    pricingStrategy: 'option_based',
    tags: ['티셔츠', '베이직'],
    images: ['https://via.placeholder.com/400x400?text=BasicTshirt'],
    attributes: { category: '상의', material: '면100%' },
  },
  {
    name: '리바이스 501 청바지',
    description: '클래식 스트레이트 청바지',
    brand: 'Levis',
    basePrice: 80000,
    pricingStrategy: 'option_based',
    tags: ['청바지', '클래식'],
    images: ['https://via.placeholder.com/400x400?text=Levis501'],
    attributes: { category: '하의', fit: '스트레이트' },
  },
  {
    name: '구찌 GG 벨트',
    description: '구찌 시그니처 벨트',
    brand: 'Gucci',
    basePrice: 450000,
    pricingStrategy: 'option_based',
    tags: ['벨트', '럭셔리'],
    images: ['https://via.placeholder.com/400x400?text=GucciBelt'],
    attributes: { category: '액세서리', material: '가죽' },
  },
  {
    name: '샤넬 No.5 향수',
    description: '샤넬 대표 향수',
    brand: 'Chanel',
    basePrice: 180000,
    pricingStrategy: 'option_based',
    tags: ['향수', '럭셔리'],
    images: ['https://via.placeholder.com/400x400?text=ChanelNo5'],
    attributes: { category: '향수', volume: '100ml' },
  },
  {
    name: '레이밴 아비에이터 선글라스',
    description: '클래식 아비에이터 선글라스',
    brand: 'Ray-Ban',
    basePrice: 200000,
    pricingStrategy: 'option_based',
    tags: ['선글라스', '클래식'],
    images: ['https://via.placeholder.com/400x400?text=Aviator'],
    attributes: { category: '선글라스', lens: '편광' },
  },
  {
    name: '몽클레어 다운 재킷',
    description: '프리미엄 다운 재킷',
    brand: 'Moncler',
    basePrice: 1200000,
    pricingStrategy: 'option_based',
    tags: ['다운', '프리미엄'],
    images: ['https://via.placeholder.com/400x400?text=MonclerDown'],
    attributes: { category: '아우터', filling: '구스다운' },
  },

  // 생활용품 (10개)
  {
    name: '다이슨 V15 무선청소기',
    description: '다이슨 최신 무선청소기',
    brand: 'Dyson',
    basePrice: 800000,
    pricingStrategy: 'option_based',
    tags: ['청소기', '무선'],
    images: ['https://via.placeholder.com/400x400?text=DysonV15'],
    attributes: { category: '청소기', battery: '60분' },
  },
  {
    name: '쿠쿠 압력밥솥 10인용',
    description: 'IH 압력밥솥',
    brand: 'Cuckoo',
    basePrice: 350000,
    pricingStrategy: 'option_based',
    tags: ['밥솥', '압력'],
    images: ['https://via.placeholder.com/400x400?text=CuckooRiceCooker'],
    attributes: { category: '주방가전', capacity: '10인용' },
  },
  {
    name: '삼성 비스포크 냉장고',
    description: '4도어 비스포크 냉장고',
    brand: 'Samsung',
    basePrice: 2500000,
    pricingStrategy: 'variant_based',
    tags: ['냉장고', '비스포크'],
    images: ['https://via.placeholder.com/400x400?text=BespokeRef'],
    attributes: { category: '대형가전', capacity: '870L' },
  },
  {
    name: 'LG 트롬 드럼세탁기',
    description: 'AI DD 드럼세탁기',
    brand: 'LG',
    basePrice: 1200000,
    pricingStrategy: 'option_based',
    tags: ['세탁기', '드럼'],
    images: ['https://via.placeholder.com/400x400?text=TromWasher'],
    attributes: { category: '대형가전', capacity: '21kg' },
  },
  {
    name: '이케아 말름 침대프레임',
    description: '심플한 디자인 침대프레임',
    brand: 'IKEA',
    basePrice: 150000,
    pricingStrategy: 'option_based',
    tags: ['침대', '가구'],
    images: ['https://via.placeholder.com/400x400?text=MalmBed'],
    attributes: { category: '가구', size: '퀸' },
  },
  {
    name: '한샘 시스템 책상',
    description: '조립식 시스템 책상',
    brand: 'Hanssem',
    basePrice: 200000,
    pricingStrategy: 'option_based',
    tags: ['책상', '가구'],
    images: ['https://via.placeholder.com/400x400?text=SystemDesk'],
    attributes: { category: '가구', material: 'MDF' },
  },
  {
    name: '템퍼 메모리폼 베개',
    description: '목 지지 메모리폼 베개',
    brand: 'Tempur',
    basePrice: 180000,
    pricingStrategy: 'option_based',
    tags: ['베개', '메모리폼'],
    images: ['https://via.placeholder.com/400x400?text=TempurPillow'],
    attributes: { category: '침구', material: '메모리폼' },
  },
  {
    name: '필립스 전기면도기',
    description: '3헤드 로터리 면도기',
    brand: 'Philips',
    basePrice: 120000,
    pricingStrategy: 'option_based',
    tags: ['면도기', '전기'],
    images: ['https://via.placeholder.com/400x400?text=PhilipsShaver'],
    attributes: { category: '미용가전', heads: '3개' },
  },
  {
    name: '브라운 핸드믹서',
    description: '다기능 핸드믹서',
    brand: 'Braun',
    basePrice: 80000,
    pricingStrategy: 'option_based',
    tags: ['믹서', '주방'],
    images: ['https://via.placeholder.com/400x400?text=BraunMixer'],
    attributes: { category: '주방가전', power: '600W' },
  },
  {
    name: '무인양품 수납박스 세트',
    description: '폴리프로필렌 수납박스',
    brand: 'Muji',
    basePrice: 25000,
    pricingStrategy: 'option_based',
    tags: ['수납', '정리'],
    images: ['https://via.placeholder.com/400x400?text=MujiBox'],
    attributes: { category: '수납용품', material: 'PP' },
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
  console.log('🚀 PIM 상품 30개 생성 시작...\n');

  const results = [];

  for (let i = 0; i < sampleProducts.length; i++) {
    const product = sampleProducts[i];
    console.log(`[${i + 1}/30] ${product.name} 생성 중...`);

    const result = await createProduct(product);
    results.push(result);

    // API 부하 방지를 위한 딜레이
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const successCount = results.filter((r) => r !== null).length;
  console.log(`\n🎉 완료! 총 ${successCount}개 상품이 생성되었습니다.`);

  if (successCount < 30) {
    console.log(`⚠️  ${30 - successCount}개 상품 생성에 실패했습니다.`);
  }
}

// 스크립트 실행
if (require.main === module) {
  createAllProducts().catch(console.error);
}

module.exports = { createAllProducts, sampleProducts };
