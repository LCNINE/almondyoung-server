// 타임세일 상품 인터페이스
export interface TimeSaleProduct {
  id: string;
  name: string;
  image: string;
  originalPrice: number;
  salePrice: number;
  discountRate: number;
  timer: {
    hours: number;
    minutes: number;
    seconds: number;
  };
  rating: number;
  reviewCount: number;
  stock: number;
  isSoldOut: boolean;
  categories: string[];
  brand: string;
  brandSubtitle: string;
  hasOptions: boolean;
  isSingleOption: boolean;
  shipmentInfo: string;
  hideMembershipPrice: boolean;
  purchaseCount: number;
  // PIM API 기반 추가 필드
  masterId: string;
  variantId: string;
  channelId: string;
  skuId: string;
  // WMS API 기반 재고 정보
  skuStock?: {[skuId: string]: number};
}

// 타임세일 상품 mock 데이터
export const timeSaleProducts: TimeSaleProduct[] = [
  {
    id: 'timesale-1',
    name: '노몬드 속눈썹 영양제 투명',
    image: 'https://almondyoung.com/web/product/medium/202508/022cad97afedaf4594776ef6bbc71760.jpg',
    originalPrice: 30000,
    salePrice: 9000,
    discountRate: 84,
    timer: {
      hours: 16,
      minutes: 1,
      seconds: 10
    },
    rating: 4.8,
    reviewCount: 401,
    stock: 15,
    isSoldOut: false,
    categories: ['속눈썹', '속눈썹 영양제'],
    brand: '노몬드',
    brandSubtitle: '속눈썹 영양제',
    hasOptions: false,
    isSingleOption: true,
    shipmentInfo: '4시 이전 주문 시 묶음배송',
    hideMembershipPrice: false,
    purchaseCount: 0,
    masterId: 'master-001',
    variantId: 'variant-001',
    channelId: 'channel-web',
    skuId: 'SKU-NOMOND-001',
    skuStock: {
      '투명': 15
    }
  },
  {
    id: 'timesale-2',
    name: '래쉬몬스터 Organic 오가닉 색소 10ml',
    image: 'https://almondyoung.com/web/product/medium/202503/d21d85aa58f14bb4cc2a69342d24c4fa.jpg',
    originalPrice: 30000,
    salePrice: 9000,
    discountRate: 70,
    timer: {
      hours: 12,
      minutes: 45,
      seconds: 30
    },
    rating: 4.5,
    reviewCount: 401,
    stock: 8,
    isSoldOut: false,
    categories: ['속눈썹', '속눈썹 영양제'],
    brand: '래쉬몬스터',
    brandSubtitle: 'Organic 오가닉',
    hasOptions: true,
    isSingleOption: true,
    shipmentInfo: '4시 이전 주문 시 묶음배송',
    hideMembershipPrice: false,
    purchaseCount: 0,
    masterId: 'master-002',
    variantId: 'variant-002',
    channelId: 'channel-web',
    skuId: 'SKU-LASH-002',
    skuStock: {
      '블랙': 25,
      '브라운': 18,
      '네이비': 12
    }
  },
  {
    id: 'timesale-3',
    name: '미라클 플랫모 다크브라운',
    image: 'https://almondyoung.com/web/product/medium/202402/9b57c6aa76f40052f31f2ea85c6876a7.jpg',
    originalPrice: 15000,
    salePrice: 9000,
    discountRate: 40,
    timer: {
      hours: 8,
      minutes: 22,
      seconds: 15
    },
    rating: 4.5,
    reviewCount: 401,
    stock: 5,
    isSoldOut: false,
    categories: ['속눈썹', '속눈썹 영양제'],
    brand: '미라클',
    brandSubtitle: '플랫모',
    hasOptions: true,
    isSingleOption: false,
    shipmentInfo: '4시 이전 주문 시 묶음배송',
    hideMembershipPrice: false,
    purchaseCount: 0,
    masterId: 'master-003',
    variantId: 'variant-003',
    channelId: 'channel-web',
    skuId: 'SKU-MIRACLE-003',
    skuStock: {
      'C-0.10-7mm': 15,
      'C-0.10-8mm': 8,
      'C-0.10-9mm': 3,
      'D-0.10-7mm': 12,
      'D-0.10-8mm': 6,
      'D-0.10-9mm': 2,
      'C-0.15-7mm': 10,
      'C-0.15-8mm': 5,
      'C-0.15-9mm': 1,
      'D-0.15-7mm': 8,
      'D-0.15-8mm': 4,
      'D-0.15-9mm': 0,
    }
  },
  {
    id: 'timesale-4',
    name: 'BL Lashes 비엘래쉬 블랙 다이아몬드',
    image: 'https://almondyoung.com/web/product/medium/202508/f78ca31bb7f7c9cb0461ba7bc24145dc.png',
    originalPrice: 25000,
    salePrice: 9000,
    discountRate: 64,
    timer: {
      hours: 6,
      minutes: 33,
      seconds: 45
    },
    rating: 3.0,
    reviewCount: 25,
    stock: 12,
    isSoldOut: false,
    categories: ['속눈썹', '속눈썹 영양제'],
    brand: 'BL Lashes',
    brandSubtitle: '비엘래쉬',
    hasOptions: true,
    isSingleOption: true,
    shipmentInfo: '4시 이전 주문 시 묶음배송',
    hideMembershipPrice: true,
    purchaseCount: 0,
    masterId: 'master-004',
    variantId: 'variant-004',
    channelId: 'channel-web',
    skuId: 'SKU-BL-004',
    skuStock: {
      '블랙 다이아몬드': 20,
      '크리스탈 드롭': 15
    }
  },
  {
    id: 'timesale-5',
    name: '라부부 B 캐릭터 땅콩 브러쉬 (랜덤)',
    image: 'https://almondyoung.com/web/product/medium/202508/c3a909e285d10ac83233c8dcc4e361f8.jpg',
    originalPrice: 30000,
    salePrice: 9000,
    discountRate: 70,
    timer: {
      hours: 4,
      minutes: 15,
      seconds: 20
    },
    rating: 4.5,
    reviewCount: 401,
    stock: 20,
    isSoldOut: false,
    categories: ['속눈썹', '속눈썹 영양제'],
    brand: '라부부',
    brandSubtitle: 'B 캐릭터',
    hasOptions: false,
    isSingleOption: true,
    shipmentInfo: '4시 이전 주문 시 묶음배송',
    hideMembershipPrice: false,
    purchaseCount: 5,
    masterId: 'master-005',
    variantId: 'variant-005',
    channelId: 'channel-web',
    skuId: 'SKU-LABUBU-005',
    skuStock: {
      '랜덤': 30
    }
  },
  // 화장품 카테고리 타임세일 상품
  {
    id: 'timesale-6',
    name: '프리미엄 아이섀도 팔레트',
    image: 'https://almondyoung.com/web/product/medium/202508/eyeshadow-palette.jpg',
    originalPrice: 45000,
    salePrice: 18000,
    discountRate: 60,
    timer: {
      hours: 14,
      minutes: 30,
      seconds: 25
    },
    rating: 4.7,
    reviewCount: 156,
    stock: 7,
    isSoldOut: false,
    categories: ['화장품', '아이메이크업'],
    brand: 'BeautyPro',
    brandSubtitle: '프리미엄',
    hasOptions: true,
    isSingleOption: true,
    shipmentInfo: '4시 이전 주문 시 묶음배송',
    hideMembershipPrice: false,
    purchaseCount: 0,
    masterId: 'master-006',
    variantId: 'variant-006',
    channelId: 'channel-web',
    skuId: 'SKU-EYESHADOW-006',
    skuStock: {
      '클래식': 7,
      '모던': 5,
      '내추럴': 9
    }
  },
  {
    id: 'timesale-7',
    name: '하이드레이팅 세럼 30ml',
    image: 'https://almondyoung.com/web/product/medium/202508/hydrating-serum.jpg',
    originalPrice: 35000,
    salePrice: 14000,
    discountRate: 60,
    timer: {
      hours: 11,
      minutes: 45,
      seconds: 12
    },
    rating: 4.9,
    reviewCount: 289,
    stock: 12,
    isSoldOut: false,
    categories: ['스킨케어', '세럼'],
    brand: 'SkinCare+',
    brandSubtitle: '하이드레이팅',
    hasOptions: false,
    isSingleOption: true,
    shipmentInfo: '4시 이전 주문 시 묶음배송',
    hideMembershipPrice: false,
    purchaseCount: 0,
    masterId: 'master-007',
    variantId: 'variant-007',
    channelId: 'channel-web',
    skuId: 'SKU-SERUM-007',
    skuStock: {
      '30ml': 12
    }
  },
  {
    id: 'timesale-8',
    name: '프로페셔널 메이크업 브러시 세트',
    image: 'https://almondyoung.com/web/product/medium/202508/brush-set.jpg',
    originalPrice: 60000,
    salePrice: 24000,
    discountRate: 60,
    timer: {
      hours: 9,
      minutes: 15,
      seconds: 33
    },
    rating: 4.6,
    reviewCount: 78,
    stock: 4,
    isSoldOut: false,
    categories: ['메이크업툴', '브러시'],
    brand: 'ProTools',
    brandSubtitle: '프로페셔널',
    hasOptions: true,
    isSingleOption: false,
    shipmentInfo: '4시 이전 주문 시 묶음배송',
    hideMembershipPrice: false,
    purchaseCount: 0,
    masterId: 'master-008',
    variantId: 'variant-008',
    channelId: 'channel-web',
    skuId: 'SKU-BRUSH-008',
    skuStock: {
      '기본세트': 4,
      '프리미엄세트': 2,
      '전문가세트': 1
    }
  },
  {
    id: 'timesale-9',
    name: '내추럴 립밤 3종 세트',
    image: 'https://almondyoung.com/web/product/medium/202508/lipbalm-set.jpg',
    originalPrice: 25000,
    salePrice: 10000,
    discountRate: 60,
    timer: {
      hours: 7,
      minutes: 22,
      seconds: 18
    },
    rating: 4.4,
    reviewCount: 203,
    stock: 18,
    isSoldOut: false,
    categories: ['립케어', '립밤'],
    brand: 'NaturalCare',
    brandSubtitle: '내추럴',
    hasOptions: true,
    isSingleOption: true,
    shipmentInfo: '4시 이전 주문 시 묶음배송',
    hideMembershipPrice: false,
    purchaseCount: 0,
    masterId: 'master-009',
    variantId: 'variant-009',
    channelId: 'channel-web',
    skuId: 'SKU-LIPBALM-009',
    skuStock: {
      '베이직': 18,
      '프리미엄': 12,
      '오가닉': 8
    }
  },
  {
    id: 'timesale-10',
    name: '안티에이징 크림 50ml',
    image: 'https://almondyoung.com/web/product/medium/202508/antiaging-cream.jpg',
    originalPrice: 80000,
    salePrice: 32000,
    discountRate: 60,
    timer: {
      hours: 5,
      minutes: 8,
      seconds: 45
    },
    rating: 4.8,
    reviewCount: 445,
    stock: 6,
    isSoldOut: false,
    categories: ['스킨케어', '안티에이징'],
    brand: 'AgeDefy',
    brandSubtitle: '프리미엄',
    hasOptions: false,
    isSingleOption: true,
    shipmentInfo: '4시 이전 주문 시 묶음배송',
    hideMembershipPrice: true,
    purchaseCount: 0,
    masterId: 'master-010',
    variantId: 'variant-010',
    channelId: 'channel-web',
    skuId: 'SKU-CREAM-010',
    skuStock: {
      '50ml': 6
    }
  },
  {
    id: 'timesale-11',
    name: '프로페셔널 헤어 드라이어',
    image: 'https://almondyoung.com/web/product/medium/202508/hair-dryer.jpg',
    originalPrice: 120000,
    salePrice: 48000,
    discountRate: 60,
    timer: {
      hours: 3,
      minutes: 45,
      seconds: 20
    },
    rating: 4.5,
    reviewCount: 67,
    stock: 3,
    isSoldOut: false,
    categories: ['헤어케어', '헤어툴'],
    brand: 'HairPro',
    brandSubtitle: '프로페셔널',
    hasOptions: true,
    isSingleOption: true,
    shipmentInfo: '4시 이전 주문 시 묶음배송',
    hideMembershipPrice: false,
    purchaseCount: 0,
    masterId: 'master-011',
    variantId: 'variant-011',
    channelId: 'channel-web',
    skuId: 'SKU-DRYER-011',
    skuStock: {
      '기본형': 3,
      '프리미엄형': 1
    }
  },
  {
    id: 'timesale-12',
    name: '내추럴 샴푸 500ml',
    image: 'https://almondyoung.com/web/product/medium/202508/natural-shampoo.jpg',
    originalPrice: 18000,
    salePrice: 7200,
    discountRate: 60,
    timer: {
      hours: 2,
      minutes: 30,
      seconds: 15
    },
    rating: 4.3,
    reviewCount: 312,
    stock: 25,
    isSoldOut: false,
    categories: ['헤어케어', '샴푸'],
    brand: 'NatureHair',
    brandSubtitle: '내추럴',
    hasOptions: true,
    isSingleOption: true,
    shipmentInfo: '4시 이전 주문 시 묶음배송',
    hideMembershipPrice: false,
    purchaseCount: 0,
    masterId: 'master-012',
    variantId: 'variant-012',
    channelId: 'channel-web',
    skuId: 'SKU-SHAMPOO-012',
    skuStock: {
      '일반용': 25,
      '민감성용': 18,
      '지성용': 22
    }
  },
  // 헤어 제품 타임세일
  {
    id: 'timesale-13',
    name: '프로페셔널 헤어 드라이어 2000W',
    image: 'https://almondyoung.com/web/product/medium/202508/hair-dryer-pro.jpg',
    originalPrice: 120000,
    salePrice: 48000,
    discountRate: 60,
    timer: {
      hours: 8,
      minutes: 45,
      seconds: 30
    },
    rating: 4.7,
    reviewCount: 89,
    stock: 15,
    isSoldOut: false,
    categories: ['헤어', '헤어가전'],
    brand: 'HairPro',
    brandSubtitle: '프로페셔널',
    hasOptions: true,
    isSingleOption: true,
    shipmentInfo: '4시 이전 주문 시 묶음배송',
    hideMembershipPrice: false,
    purchaseCount: 0,
    masterId: 'master-013',
    variantId: 'variant-013',
    channelId: 'channel-web',
    skuId: 'SKU-HAIR-DRYER-013',
    skuStock: {
      '블랙': 15,
      '화이트': 12,
      '핑크': 8
    }
  },
  {
    id: 'timesale-14',
    name: '내추럴 샴푸 500ml',
    image: 'https://almondyoung.com/web/product/medium/202508/natural-shampoo.jpg',
    originalPrice: 18000,
    salePrice: 7200,
    discountRate: 60,
    timer: {
      hours: 12,
      minutes: 20,
      seconds: 15
    },
    rating: 4.3,
    reviewCount: 312,
    stock: 25,
    isSoldOut: false,
    categories: ['헤어', '샴푸/린스'],
    brand: 'NatureHair',
    brandSubtitle: '내추럴',
    hasOptions: true,
    isSingleOption: true,
    shipmentInfo: '4시 이전 주문 시 묶음배송',
    hideMembershipPrice: false,
    purchaseCount: 0,
    masterId: 'master-014',
    variantId: 'variant-014',
    channelId: 'channel-web',
    skuId: 'SKU-SHAMPOO-014',
    skuStock: {
      '일반용': 25,
      '민감성용': 18,
      '지성용': 22
    }
  },
  {
    id: 'timesale-15',
    name: '헤어 컬러 염모제 100ml',
    image: 'https://almondyoung.com/web/product/medium/202508/hair-color.jpg',
    originalPrice: 25000,
    salePrice: 10000,
    discountRate: 60,
    timer: {
      hours: 6,
      minutes: 15,
      seconds: 45
    },
    rating: 4.4,
    reviewCount: 203,
    stock: 20,
    isSoldOut: false,
    categories: ['헤어', '칼라/염모제'],
    brand: 'ColorPro',
    brandSubtitle: '프로페셔널',
    hasOptions: true,
    isSingleOption: true,
    shipmentInfo: '4시 이전 주문 시 묶음배송',
    hideMembershipPrice: false,
    purchaseCount: 0,
    masterId: 'master-015',
    variantId: 'variant-015',
    channelId: 'channel-web',
    skuId: 'SKU-COLOR-015',
    skuStock: {
      '브라운': 20,
      '블랙': 18,
      '블론드': 15,
      '레드': 12
    }
  }
];

// 타임세일 상품 조회 함수
export const getTimeSaleProducts = (): TimeSaleProduct[] => {
  return timeSaleProducts;
};

// 특정 카테고리의 타임세일 상품 조회
export const getTimeSaleProductsByCategory = (category: string): TimeSaleProduct[] => {
  console.log('Filtering by category:', category);
  const filtered = timeSaleProducts.filter(product => {
    const hasMatch = product.categories.some(cat => 
      cat.includes(category) || category.includes(cat)
    );
    console.log(`Product ${product.name} categories:`, product.categories, 'Match:', hasMatch);
    return hasMatch;
  });
  console.log('Filtered products:', filtered.length);
  return filtered;
};

// 재고가 있는 타임세일 상품만 조회
export const getAvailableTimeSaleProducts = (): TimeSaleProduct[] => {
  return timeSaleProducts.filter(product => !product.isSoldOut && product.stock > 0);
};
