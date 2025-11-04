// 카테고리별 배너 mock 데이터
export interface CategoryBanner {
  id: string
  categoryId: string
  categoryName: string
  title?: string
  content?: string
  mobileImage: string
  desktopImage: string
  linkUrl?: string
  isActive: boolean
  order: number
}

export const categoryBanners: CategoryBanner[] = [
  // 헤어 카테고리 배너들
  {
    id: 'banner-hair-1',
    categoryId: '01999869-50b5-771c-85cf-19b5c4086510',
    categoryName: '헤어',
    title: '헤어 타임 세일!',
    content: '전문가들이 선택하는 헤어 제품의 모든 것',
    mobileImage: 'https://xsjyvxbnmwwsdvyofjfy.supabase.co/storage/v1/object/public/almondimg/hairbanner.png',
    desktopImage: 'https://xsjyvxbnmwwsdvyofjfy.supabase.co/storage/v1/object/public/almondimg/hairbanner.png',
    linkUrl: '/c/hair',
    isActive: true,
    order: 1
  },
  {
    id: 'banner-hair-perm-1',
    categoryId: 'hair-perm',
    categoryName: '펌',
    title: '펌 전문가의 선택',
    content: '최고의 펌 제품으로 완벽한 스타일링',
    mobileImage: 'https://almondyoung.com/web/product/medium/202508/perm-mobile-banner.jpg',
    desktopImage: 'https://almondyoung.com/web/product/medium/202508/perm-desktop-banner.jpg',
    isActive: true,
    order: 1
  },
  {
    id: 'banner-hair-dye-1',
    categoryId: 'hair-dye',
    categoryName: '염모',
    title: '프리미엄 염모제',
    content: '자연스러운 색상과 건강한 모발을 위한 염모제',
    mobileImage: 'https://almondyoung.com/web/product/medium/202508/dye-mobile-banner.jpg',
    desktopImage: 'https://almondyoung.com/web/product/medium/202508/dye-desktop-banner.jpg',
    isActive: true,
    order: 1
  },
  {
    id: 'banner-hair-shampoo-1',
    categoryId: 'hair-shampoo',
    categoryName: '샴푸',
    title: '전문가 샴푸',
    content: '모발과 두피를 위한 전문 샴푸 컬렉션',
    mobileImage: 'https://almondyoung.com/web/product/medium/202508/shampoo-mobile-banner.jpg',
    desktopImage: 'https://almondyoung.com/web/product/medium/202508/shampoo-desktop-banner.jpg',
    isActive: true,
    order: 1
  },
  {
    id: 'banner-hair-styling-1',
    categoryId: 'hair-styling',
    categoryName: '스타일링',
    title: '완벽한 스타일링',
    content: '다양한 스타일링 제품으로 원하는 룩 완성',
    mobileImage: 'https://almondyoung.com/web/product/medium/202508/styling-mobile-banner.jpg',
    desktopImage: 'https://almondyoung.com/web/product/medium/202508/styling-desktop-banner.jpg',
    isActive: true,
    order: 1
  },
  {
    id: 'banner-hair-appliance-1',
    categoryId: 'hair-appliance',
    categoryName: '헤어기기',
    title: '프로페셔널 헤어기기',
    content: '살롱급 품질의 헤어 드라이어와 스트레이트너',
    mobileImage: 'https://almondyoung.com/web/product/medium/202508/appliance-mobile-banner.jpg',
    desktopImage: 'https://almondyoung.com/web/product/medium/202508/appliance-desktop-banner.jpg',
    isActive: true,
    order: 1
  },

  // 반영구 카테고리 배너들
  {
    id: 'banner-semi-1',
    categoryId: '01999869-68f9-764a-898b-cc5ec1c4176f',
    categoryName: '반영구',
    title: '반영구 전문 브랜드',
    content: '안전하고 아름다운 반영구 제품',
    mobileImage: 'https://xsjyvxbnmwwsdvyofjfy.supabase.co/storage/v1/object/public/almondimg/permbanner.png',
    desktopImage: 'https://xsjyvxbnmwwsdvyofjfy.supabase.co/storage/v1/object/public/almondimg/permbanner.png',
    linkUrl: '/c/semi',
    isActive: true,
    order: 1
  },
  {
    id: 'banner-semi-needle-1',
    categoryId: 'semi-needle',
    categoryName: '바늘',
    title: '정밀한 바늘',
    content: '최고급 스테인리스 바늘로 안전한 시술',
    mobileImage: 'https://almondyoung.com/web/product/medium/202508/needle-mobile-banner.jpg',
    desktopImage: 'https://almondyoung.com/web/product/medium/202508/needle-desktop-banner.jpg',
    isActive: true,
    order: 1
  },
  {
    id: 'banner-semi-ink-1',
    categoryId: 'semi-ink',
    categoryName: '잉크',
    title: '프리미엄 잉크',
    content: '자연스럽고 오래 지속되는 반영구 잉크',
    mobileImage: 'https://almondyoung.com/web/product/medium/202508/ink-mobile-banner.jpg',
    desktopImage: 'https://almondyoung.com/web/product/medium/202508/ink-desktop-banner.jpg',
    isActive: true,
    order: 1
  },
  {
    id: 'banner-semi-machine-1',
    categoryId: 'semi-machine',
    categoryName: '기계',
    title: '전문가용 기계',
    content: '정밀하고 안정적인 반영구 기계',
    mobileImage: 'https://almondyoung.com/web/product/medium/202508/machine-mobile-banner.jpg',
    desktopImage: 'https://almondyoung.com/web/product/medium/202508/machine-desktop-banner.jpg',
    isActive: true,
    order: 1
  },

  // 속눈썹 카테고리 배너들
  {
    id: 'banner-eyelash-1',
    categoryId: '01999869-86f9-750a-9f40-02c58c77659c',
    categoryName: '속눈썹',
    title: '속눈썹재료는 아몬드영',
    content: '전문가들이 선택하는 속눈썹 재료의 모든 것',
    mobileImage: 'https://xsjyvxbnmwwsdvyofjfy.supabase.co/storage/v1/object/public/almondimg/permbanner.png',
    desktopImage: 'https://xsjyvxbnmwwsdvyofjfy.supabase.co/storage/v1/object/public/almondimg/lashctbanner.png',
    linkUrl: '/c/eyelash',
    isActive: true,
    order: 1
  },
  {
    id: 'banner-eyelash-extension-1',
    categoryId: 'eyelash-extension',
    categoryName: '연장재료',
    title: '프리미엄 연장재료',
    content: '자연스럽고 오래 지속되는 속눈썹 연장재료',
    mobileImage: 'https://almondyoung.com/web/product/medium/202508/extension-mobile-banner.jpg',
    desktopImage: 'https://almondyoung.com/web/product/medium/202508/extension-desktop-banner.jpg',
    isActive: true,
    order: 1
  },
  {
    id: 'banner-eyelash-tool-1',
    categoryId: 'eyelash-tool',
    categoryName: '도구',
    title: '전문가 도구',
    content: '정밀하고 편리한 속눈썹 시술 도구',
    mobileImage: 'https://almondyoung.com/web/product/medium/202508/tool-mobile-banner.jpg',
    desktopImage: 'https://almondyoung.com/web/product/medium/202508/tool-desktop-banner.jpg',
    isActive: true,
    order: 1
  },

  // 네일 카테고리 배너들
  {
    id: 'banner-nail-1',
    categoryId: '01999869-788c-70ab-b324-489ee696180d',
    categoryName: '네일',
    title: '아름다운 네일',
    content: '완벽한 네일 아트를 위한 모든 것',
    mobileImage: 'https://xsjyvxbnmwwsdvyofjfy.supabase.co/storage/v1/object/public/almondimg/nailbanner.png',
    desktopImage: 'https://xsjyvxbnmwwsdvyofjfy.supabase.co/storage/v1/object/public/almondimg/nailbanner.png',
    linkUrl: '/c/nail',
    isActive: true,
    order: 1
  },
  {
    id: 'banner-nail-polish-1',
    categoryId: 'nail-polish',
    categoryName: '네일폴리시',
    title: '트렌디한 컬러',
    content: '다양한 색상과 질감의 네일폴리시',
    mobileImage: 'https://almondyoung.com/web/product/medium/202508/polish-mobile-banner.jpg',
    desktopImage: 'https://almondyoung.com/web/product/medium/202508/polish-desktop-banner.jpg',
    isActive: true,
    order: 1
  },
  {
    id: 'banner-nail-tool-1',
    categoryId: 'nail-tool',
    categoryName: '네일도구',
    title: '전문가 도구',
    content: '정밀한 네일 아트를 위한 전문 도구',
    mobileImage: 'https://almondyoung.com/web/product/medium/202508/nail-tool-mobile-banner.jpg',
    desktopImage: 'https://almondyoung.com/web/product/medium/202508/nail-tool-desktop-banner.jpg',
    isActive: true,
    order: 1
  },

  // 피부관리 카테고리 배너들
  {
    id: 'banner-skincare-1',
    categoryId: '01999869-b42a-75bb-969c-6ba0ec54eb5c',
    categoryName: '피부관리',
    title: '건강한 피부',
    content: '전문가가 추천하는 피부관리 제품',
    mobileImage: 'https://xsjyvxbnmwwsdvyofjfy.supabase.co/storage/v1/object/public/almondimg/skinbanner.png',
    desktopImage: 'https://xsjyvxbnmwwsdvyofjfy.supabase.co/storage/v1/object/public/almondimg/skinbanner.png',
    linkUrl: '/c/skincare',
    isActive: true,
    order: 1
  },
  {
    id: 'banner-skincare-cleanser-1',
    categoryId: 'skincare-cleanser',
    categoryName: '클렌징',
    title: '완벽한 클렌징',
    content: '깨끗하고 건강한 피부를 위한 클렌징 제품',
    mobileImage: 'https://almondyoung.com/web/product/medium/202508/cleanser-mobile-banner.jpg',
    desktopImage: 'https://almondyoung.com/web/product/medium/202508/cleanser-desktop-banner.jpg',
    isActive: true,
    order: 1
  },
  {
    id: 'banner-skincare-moisturizer-1',
    categoryId: 'skincare-moisturizer',
    categoryName: '보습',
    title: '깊은 보습',
    content: '수분을 가득 채워주는 보습 제품',
    mobileImage: 'https://almondyoung.com/web/product/medium/202508/moisturizer-mobile-banner.jpg',
    desktopImage: 'https://almondyoung.com/web/product/medium/202508/moisturizer-desktop-banner.jpg',
    isActive: true,
    order: 1
  },

  // 메이크업 카테고리 배너들
  {
    id: 'banner-makeup-1',
    categoryId: 'makeup',
    categoryName: '메이크업',
    title: '완벽한 메이크업',
    content: '전문가가 사용하는 메이크업 제품',
    mobileImage: 'https://almondyoung.com/web/product/medium/202508/makeup-mobile-banner.jpg',
    desktopImage: 'https://almondyoung.com/web/product/medium/202508/makeup-desktop-banner.jpg',
    linkUrl: '/c/makeup',
    isActive: true,
    order: 1
  },
  {
    id: 'banner-makeup-foundation-1',
    categoryId: 'makeup-foundation',
    categoryName: '베이스',
    title: '완벽한 베이스',
    content: '자연스럽고 오래 지속되는 베이스 메이크업',
    mobileImage: 'https://almondyoung.com/web/product/medium/202508/foundation-mobile-banner.jpg',
    desktopImage: 'https://almondyoung.com/web/product/medium/202508/foundation-desktop-banner.jpg',
    isActive: true,
    order: 1
  },
  {
    id: 'banner-makeup-eye-1',
    categoryId: 'makeup-eye',
    categoryName: '아이메이크업',
    title: '매력적인 눈',
    content: '아름다운 눈을 위한 아이메이크업 제품',
    mobileImage: 'https://almondyoung.com/web/product/medium/202508/eye-mobile-banner.jpg',
    desktopImage: 'https://almondyoung.com/web/product/medium/202508/eye-desktop-banner.jpg',
    isActive: true,
    order: 1
  },
  {
    id: 'banner-tattoo-1',
    categoryId: '01999869-c3c8-710c-85a9-6050bf417d6c',
    categoryName: '타투',
    title: '타투 전문가의 선택',
    content: '아름다운 타투를 위한 타투 제품',
    mobileImage: 'https://xsjyvxbnmwwsdvyofjfy.supabase.co/storage/v1/object/public/almondimg/tattobanner.png',
    desktopImage: 'https://xsjyvxbnmwwsdvyofjfy.supabase.co/storage/v1/object/public/almondimg/tattobanner.png',
    isActive: true,
    order: 1
  }
]

// 카테고리 ID로 배너 조회
export function getBannerByCategoryId(categoryId: string): CategoryBanner | null {
  return categoryBanners.find(banner => 
    banner.categoryId === categoryId && banner.isActive
  ) || null
}

// 카테고리 이름으로 배너 조회
export function getBannerByCategoryName(categoryName: string): CategoryBanner | null {
  return categoryBanners.find(banner => 
    banner.categoryName === categoryName && banner.isActive
  ) || null
}

// 모든 활성 배너 조회
export function getAllActiveBanners(): CategoryBanner[] {
  return categoryBanners
    .filter(banner => banner.isActive)
    .sort((a, b) => a.order - b.order)
}
