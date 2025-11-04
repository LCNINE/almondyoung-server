// lib/category-mock.ts
export type CategoryNode = {
    id: string
    name: string
    thumb?: string
    children?: CategoryNode[]
  }

export type Category = {
    id: string
    name: string
    parentId: string | null
    seoDescription?: string
    heroImage?: string
    thumb?: string
  }
  
export type Product = {
    id: string
    name: string
    brand?: string
    image: string
    price: number
    categoryId: string
    tags?: string[] // 추가
    stock?: number // 추가
  }
  
  const ph = (seed: string) => {
    const categoryImages: { [key: string]: string } = {
      // 헤어 카테고리 이미지들
      'hair-perm': 'https://mentor-hug-20737921.figma.site/_assets/v11/b6338940e8a307ed6f496447659e8cadd1315b68.png',
      'hair-dye': 'https://mentor-hug-20737921.figma.site/_assets/v11/476938419051640d2b80dc32b231401fcde63fb1.png',
      'hair-clinic': 'https://mentor-hug-20737921.figma.site/_assets/v11/349d3804b36fa61e634f89a981f1ae0fd2d97ab6.png',
      'hair-shampoo': 'https://mentor-hug-20737921.figma.site/_assets/v11/0dc2989d83f1f7b239a0b8aef572ecfcd2a8fbf4.png',
      'hair-styling': 'https://mentor-hug-20737921.figma.site/_assets/v11/7187d02470debd013b6a8c10eeb18cb45c083d0d.png',
      'hair-appliance': 'https://mentor-hug-20737921.figma.site/_assets/v11/2e14ac932603cdae26cc1fd5906470ed06100872.png',
      'hair-scissor': 'https://mentor-hug-20737921.figma.site/_assets/v11/7177a522c44d9bfe4543aee2de6c7d9838616314.png',
      'hair-brush': 'https://mentor-hug-20737921.figma.site/_assets/v11/7fd658fcd372e5f57584a296849eabf129b7de66.png',
      'hair-gown': 'https://mentor-hug-20737921.figma.site/_assets/v11/ea01a3fe426d763ac538eeafd71a02342ddd15a4.png',
      'hair-tools': 'https://mentor-hug-20737921.figma.site/_assets/v11/e19bf053226739a591121301ee12c67d0be5a6bb.png',
      'hair-wig': 'https://mentor-hug-20737921.figma.site/_assets/v11/ba0396aaed5c316debe32f7d11c8daf8b894cfec.png',
      
      // 반영구 카테고리 이미지들
      'semi-needle': 'https://mentor-hug-20737921.figma.site/_assets/v11/50db937d26f9f7cd7cf6a793c6d01954a0de98f2.png',
      'semi-ink': 'https://mentor-hug-20737921.figma.site/_assets/v11/c7d8dd53b19be0992059473c2127242abd5b4d49.png',
      'semi-pen': 'https://mentor-hug-20737921.figma.site/_assets/v11/1c8a6c37206e4eede903dd79f590c2112a9bd1d6.png',
      'semi-machine': 'https://mentor-hug-20737921.figma.site/_assets/v11/7baa587c0359014d2735a21b0573fe6954b2f9dc.png',
      'semi-supplies': 'https://mentor-hug-20737921.figma.site/_assets/v11/8d33b596af2440ddc738fcee76dc71b77d602bc6.png',
      'semi-rubber': 'https://mentor-hug-20737921.figma.site/_assets/v11/8556f0dca0d480ffe6da01378d66bda21f8d5e4b.png',
      
      
      // 네일 카테고리 이미지들 (실제 구조에 맞춤)
      'nail-sticker': 'https://mentor-hug-20737921.figma.site/_assets/v11/53bbb03cdd6bdc5c4b0426b8ff4a6dbf3cc05672.png',
      'nail-parts': 'https://mentor-hug-20737921.figma.site/_assets/v11/1140c15ded033a120b47a81ae0366ed488cd6995.png',
      'nail-glitter': 'https://mentor-hug-20737921.figma.site/_assets/v11/5e5907ce68f28bf8b7c9aa755286249e7a59bb5e.png',
      'nail-gel': 'https://mentor-hug-20737921.figma.site/_assets/v11/8e90d7fdca52868b48350d42bb05d05f775a9562.png',
      'nail-material': 'https://mentor-hug-20737921.figma.site/_assets/v11/150ab3378d7105eaddb8e67611457828f4152570.png',
      'nail-device': 'https://mentor-hug-20737921.figma.site/_assets/v11/5aa7d9154890fa062cb190b72f2bd44fb1fd9520.png',
      'nail-swarovski': 'https://mentor-hug-20737921.figma.site/_assets/v11/8b9db1873ea86e340a30953d03fda4366237bc5f.png',
      
      // 속눈썹 카테고리 이미지들 (실제 구조에 맞춤)
      'lash-lash': 'https://mentor-hug-20737921.figma.site/_assets/v11/f3301b5756ddc24facf75fcc2f1847a0a1ea9d5e.png',
      'lash-essence': 'https://mentor-hug-20737921.figma.site/_assets/v11/221ed48ea451b841e85c4bc75d3841761bc0b0f0.png',
      'lash-glue': 'https://mentor-hug-20737921.figma.site/_assets/v11/84f171ecd1db41fbe2e3dadd3ea5bb344d8f636c.png',
      'lash-wax': 'https://mentor-hug-20737921.figma.site/_assets/v11/914c7535a12375c22a1514770b26d3be8b528815.png',
      'lash-lot': 'https://mentor-hug-20737921.figma.site/_assets/v11/c0e7c4fe726f14568786c3e736eb31f3af792ce8.png',
      'lash-tape': 'https://mentor-hug-20737921.figma.site/_assets/v11/a9d4eff792f1862718ad0882340653a858409969.png',
      'lash-remover': 'https://mentor-hug-20737921.figma.site/_assets/v11/375b225434786fc413690786b4b3be12fef7d4f5.png',
      'lash-supplies': 'https://mentor-hug-20737921.figma.site/_assets/v11/376fc3677569ec0dfedd700d6e3c6c71cdd3d07a.png',
      'lash-set': 'https://mentor-hug-20737921.figma.site/_assets/v11/3f20421083b950cfe079cca9884d638768611173.png',
      'lash-tweezer': 'https://mentor-hug-20737921.figma.site/_assets/v11/2c99e3d1b2cab1339bb7e5c2debc495ac6033c72.png',
      
      // 피부미용 카테고리 이미지들
      'skin': 'https://almondyoung.com/web/product/medium/202508/skin-category.jpg',
      'tattoo': 'https://almondyoung.com/web/product/medium/202508/tattoo-category.jpg',
      'digital': 'https://almondyoung.com/web/product/medium/202508/digital-category.jpg',
      'class': 'https://almondyoung.com/web/product/medium/202508/class-category.jpg',
      'machine': 'https://almondyoung.com/web/product/medium/202508/machine-category.jpg',
      'benefit': 'https://almondyoung.com/web/product/medium/202508/benefit-category.jpg',
    }
    
    return categoryImages[seed] || `https://picsum.photos/seed/${seed}/300`
  }
  
  /** 홈 탭에서 쓰는 대분류 목록 */
  export const TOP_CATEGORIES: { id: string; name: string }[] = [
    { id: "hair", name: "헤어" },
    { id: "semi", name: "반영구" },
    { id: "nail", name: "네일" },
    { id: "lash", name: "속눈썹" },
    { id: "skin", name: "피부미용" },
    { id: "tattoo", name: "타투" },
    { id: "waxing", name: "왁싱" },
  ]
  
  /** 좌측 사이드 메뉴/대카테고리 진입 화면에서 쓰는 전체 트리 */
  export const CATEGORY_TREE: CategoryNode[] = [
    {
      id: "hair",
      name: "헤어",
      children: [
        { id: "hair-perm", name: "펌제", thumb: ph("hair-perm") },
        { id: "hair-dye", name: "칼라/염모제", thumb: ph("hair-dye") },
        { id: "hair-clinic", name: "클리닉", thumb: ph("hair-clinic") },
        { id: "hair-shampoo", name: "샴푸/린스", thumb: ph("hair-shampoo") },
        { id: "hair-styling", name: "스타일링", thumb: ph("hair-styling") },
        { id: "hair-appliance", name: "헤어가전", thumb: ph("hair-appliance") },
        { id: "hair-scissor", name: "가위/레자", thumb: ph("hair-scissor") },
        { id: "hair-brush", name: "브러시/핀셋", thumb: ph("hair-brush") },
        { id: "hair-gown", name: "가운/타월", thumb: ph("hair-gown") },
        { id: "hair-tools", name: "소도구", thumb: ph("hair-tools") },
        { id: "hair-wig", name: "가발", thumb: ph("hair-wig") },
      ],
    },
    {
      id: "semi",
      name: "반영구",
      children: [
        { id: "semi-needle", name: "니들", thumb: ph("semi-needle") },
        { id: "semi-ink", name: "색소", thumb: ph("semi-ink") },
        { id: "semi-pen", name: "엠보&수지펜", thumb: ph("semi-pen") },
        { id: "semi-machine", name: "머신", thumb: ph("semi-machine") },
        { id: "semi-supplies", name: "부자재", thumb: ph("semi-supplies") },
        { id: "semi-rubber", name: "고무판", thumb: ph("semi-rubber") },
      ],
    },
    {
      id: "nail",
      name: "네일",
      children: [
        { id: "nail-sticker", name: "네일 스티커", thumb: ph("nail-sticker") },
        { id: "nail-parts", name: "네일 파츠", thumb: ph("nail-parts") },
        { id: "nail-glitter", name: "네일 글리터", thumb: ph("nail-glitter") },
        { id: "nail-gel", name: "젤네일", thumb: ph("nail-gel") },
        { id: "nail-material", name: "네일재료", thumb: ph("nail-material") },
        { id: "nail-device", name: "네일기계", thumb: ph("nail-device") },
        { id: "nail-swarovski", name: "정품 오스트리아 스톤", thumb: ph("nail-swarovski") },
      ],
    },
    {
      id: "lash",
      name: "속눈썹",
      children: [
        { id: "lash-lash", name: "래쉬", thumb: ph("lash-lash") },
        { id: "lash-essence", name: "영양제", thumb: ph("lash-essence") },
        { id: "lash-glue", name: "글루", thumb: ph("lash-glue") },
        { id: "lash-wax", name: "펌글루&왁스", thumb: ph("lash-wax") },
        { id: "lash-lot", name: "롯드", thumb: ph("lash-lot") },
        { id: "lash-remover", name: "리무버&전처리제", thumb: ph("lash-remover") },
        { id: "lash-tweezer", name: "핀셋", thumb: ph("lash-tweezer") },
        { id: "lash-tape", name: "테이프", thumb: ph("lash-tape") },
        { id: "lash-supplies", name: "부자재", thumb: ph("lash-supplies") },
        { id: "lash-set", name: "세트", thumb: ph("lash-set") },
      ],
    },
    { id: "waxing", name: "왁싱", children: [
      { id: "waxing-wax", name: "왁스", thumb: ph("waxing-wax") },
      { id: "waxing-care", name: "전후처리제", thumb: ph("waxing-care") },
      { id: "waxing-supplies", name: "부자재", thumb: ph("waxing-supplies") },
    ] },
    
    { id: "skin", name: "피부미용",
      children: [
        { id: "skin-certificate", name: "국가자격증", thumb: ph("skin-certificate") },
        { id: "skin-skin", name: "스킨플래닝", thumb: ph("skin-skin") },
        { id: "skin-pedi", name: "패디플래닝", thumb: ph("skin-pedi") },
        { id: "skin-cosmetic", name: "화장품", thumb: ph("skin-cosmetic") },
        { id: "skin-machine", name: "미용기기", thumb: ph("skin-machine") },
        { id: "skin-supplies", name: "기타소품", thumb: ph("skin-supplies") },
        { id: "skin-pack", name: "팩&모델링팩", thumb: ph("skin-pack") },
      ]
    },
    { id: "tattoo", name: "타투", children: [
      { id: "tattoo-niddles", name: "니들", thumb: ph("tattoo-niddles") },
      { id: "tattoo-ink", name: "잉크", thumb: ph("tattoo-ink") },
      { id: "tattoo-tip", name: "팁/그립", thumb: ph("tattoo-tip") },
      { id: "tattoo-machine", name: "머신", thumb: ph("tattoo-machine") },
      { id: "tattoo-supplies", name: "부자재", thumb: ph("tattoo-supplies") },
    ] },
    { id: "digital", name: "디지털 템플릿" },
    { id: "class", name: "클래스" },
    { id: "machine", name: "머신" },
    { id: "benefit", name: "혜택 / 서비스" },
  ]
  
  export const SPECIAL_CATEGORIES = [
    { id: "new", name: "신상품", thumb: "https://picsum.photos/seed/new/60" },
    { id: "best", name: "베스트", thumb: "https://picsum.photos/seed/best/60" },
    { id: "time", name: "타임특가", thumb: "https://picsum.photos/seed/time/60" },
    { id: "custom", name: "자체제작", thumb: "https://picsum.photos/seed/custom/60" },
    { id: "welcome", name: "웰컴딜", thumb: "https://picsum.photos/seed/welcome/60" },
  ];

  /* ===== 카테고리 트리를 평면 배열로 변환 ===== */
  function flattenCategoryTree(nodes: CategoryNode[], parentId: string | null = null): Category[] {
    const result: Category[] = []
    
    for (const node of nodes) {
      const category: Category = {
        id: node.id,
        name: node.name,
        parentId,
        thumb: node.thumb,
        seoDescription: node.id === "hair" ? "헤어 전용 프로 장비/소모품 모음" : undefined,
        heroImage: node.id === "hair" ? "https://picsum.photos/seed/aly-hero/1200/300" : undefined,
      }
      result.push(category)
      
      if (node.children) {
        result.push(...flattenCategoryTree(node.children, node.id))
      }
    }
    
    return result
  }
  
  const mockCategories: Category[] = flattenCategoryTree(CATEGORY_TREE)
  
  /* ===== 목업 상품 ===== */
  const mockProducts: Product[] = [
    { id: "p1", name: "프로 이온 드라이어 2000W", brand: "ALY", image: "https://picsum.photos/seed/p1/800", price: 69000, categoryId: "hair-appliance" },
    { id: "p2", name: "경량 이온 드라이어 1600W", brand: "ALY", image: "https://picsum.photos/seed/p2/800", price: 49000, categoryId: "hair-appliance" },
    { id: "p3", name: "살롱용 초경량 드라이어", brand: "ProSalon", image: "https://picsum.photos/seed/p3/800", price: 119000, categoryId: "hair-appliance" },
    { id: "p4", name: "세라믹 봉고데기 28mm", brand: "CurlX", image: "https://picsum.photos/seed/p4/800", price: 39000, categoryId: "hair-appliance" },
    { id: "p5", name: "이온 집중 드라이어", brand: "ProSalon", image: "https://picsum.photos/seed/p5/800", price: 99000, categoryId: "hair-appliance" },
    { id: "p6", name: "브러시 드라이 스타일러", brand: "ALY", image: "https://picsum.photos/seed/p6/800", price: 79000, categoryId: "hair-appliance" },
    { id: "p7", name: "콤팩트 트래블 드라이어", brand: "ALY", image: "https://picsum.photos/seed/p7/800", price: 39000, categoryId: "hair-appliance" },
    { id: "p8", name: "살롱 마스터 드라이어 2200W", brand: "ProSalon", image: "https://picsum.photos/seed/p8/800", price: 149000, categoryId: "hair-appliance" },
  ]
  
  /* ===== 카테고리 유틸 ===== */
  export async function getCategoryById(id: string) {
    console.log('getCategoryById called with id:', id)
    console.log('Available categories:', mockCategories.map(c => c.id))
    const result = mockCategories.find((c) => c.id === id) ?? null
    console.log('Found category:', result)
    return result
  }
  
  export async function getBreadcrumbs(id: string) {
    const trail: Category[] = []
    let curr = mockCategories.find((c) => c.id === id) ?? null
    while (curr) {
      trail.unshift(curr)
      curr = curr.parentId ? mockCategories.find((c) => c.id === curr!.parentId) ?? null : null
    }
    return trail
  }
  
  export async function getChildrenCategories(parentId: string) {
    return mockCategories.filter((c) => c.parentId === parentId)
  }
  
  /* ===== 필터 스펙 ===== */
  export async function getFacetSpec(categoryId: string) {
    const brandsMap = new Map<string, number>()
    const tagsMap = new Map<string, number>()
    const stockMap = new Map<string, number>()
    
    const categoryProducts = mockProducts.filter((p) => isDescendant(categoryId, p.categoryId))
    console.log(`카테고리 ${categoryId}의 상품 수:`, categoryProducts.length)
    
    categoryProducts.forEach((p) => {
      // 브랜드 필터
      const brandKey = p.brand ?? "기타"
      brandsMap.set(brandKey, (brandsMap.get(brandKey) ?? 0) + 1)
      
      // 태그 필터 - tags 필드가 없으면 기본 태그 추가
      if (p.tags && p.tags.length > 0) {
        p.tags.forEach(tag => {
          tagsMap.set(tag, (tagsMap.get(tag) ?? 0) + 1)
        })
      } else {
        // 기본 태그 추가
        tagsMap.set("인기상품", (tagsMap.get("인기상품") ?? 0) + 1)
        tagsMap.set("신상품", (tagsMap.get("신상품") ?? 0) + 1)
      }
      
      // 재고수량 필터 - stock 필드가 없으면 기본값 사용
      const stockValue = p.stock !== undefined ? p.stock : Math.floor(Math.random() * 50) + 1
      if (stockValue === 0) {
        stockMap.set("품절", (stockMap.get("품절") ?? 0) + 1)
      } else if (stockValue <= 10) {
        stockMap.set("재고부족", (stockMap.get("재고부족") ?? 0) + 1)
      } else {
        stockMap.set("재고있음", (stockMap.get("재고있음") ?? 0) + 1)
      }
    })
    
    // 상품이 없으면 기본 필터 옵션 제공
    if (categoryProducts.length === 0) {
      brandsMap.set("아몬드영", 1)
      tagsMap.set("인기상품", 1)
      tagsMap.set("신상품", 1)
      stockMap.set("재고있음", 1)
    }
  
    return {
      brands: Array.from(brandsMap.entries()).map(([value, count]) => ({
        value,
        label: value,
        count,
      })),
      tags: Array.from(tagsMap.entries()).map(([value, count]) => ({
        value,
        label: value,
        count,
      })),
      stock: Array.from(stockMap.entries()).map(([value, count]) => ({
        value,
        label: value,
        count,
      })),
    }
  }
  
  /* ===== 상품 검색 ===== */
  export async function searchProductsInCategory(args: {
    categoryId: string
    q?: string
    brand?: string
    min?: number
    max?: number
    tags?: string[]
    stock?: string[]
    sort?: "popular" | "new" | "priceAsc" | "priceDesc"
    page?: number
  }) {
    const { categoryId, q, brand, min, max, tags, stock, sort = "popular", page = 1 } = args
    const pageSize = 12
  
    let list = mockProducts.filter((p) => isDescendant(categoryId, p.categoryId))
  
    if (q) list = list.filter((p) => p.name.includes(q))
    if (brand) list = list.filter((p) => (p.brand ?? "") === brand)
    if (typeof min === "number") list = list.filter((p) => p.price >= min)
    if (typeof max === "number") list = list.filter((p) => p.price <= max)
    
    // 태그 필터
    if (tags && tags.length > 0) {
      list = list.filter((p) => 
        p.tags && p.tags.some(tag => tags.includes(tag))
      )
    }
    
    // 재고수량 필터
    if (stock && stock.length > 0) {
      list = list.filter((p) => {
        if (stock.includes("품절") && p.stock === 0) return true
        if (stock.includes("재고부족") && p.stock && p.stock > 0 && p.stock <= 10) return true
        if (stock.includes("재고있음") && p.stock && p.stock > 10) return true
        return false
      })
    }
  
    if (sort === "priceAsc") list.sort((a, b) => a.price - b.price)
    if (sort === "priceDesc") list.sort((a, b) => b.price - a.price)
    // popular/new는 목업이라 스킵(실서버에서 점수/정렬키 사용)
  
    const total = list.length
    const start = (page - 1) * pageSize
    const items = list.slice(start, start + pageSize)
  
    return { items, total, page, pageSize }
  }
  
  /* ===== 트리 포함 여부 ===== */
  function isDescendant(rootId: string, targetCategoryId: string) {
    if (rootId === targetCategoryId) return true
    let cur = mockCategories.find((c) => c.id === targetCategoryId) ?? null
    while (cur && cur.parentId) {
      if (cur.parentId === rootId) return true
      cur = mockCategories.find((c) => c.id === cur!.parentId) ?? null
    }
    return false
  }
  