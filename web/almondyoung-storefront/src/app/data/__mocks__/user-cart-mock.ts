import { PimProductDetail } from '../../../lib/types/dto/pim'

// 장바구니 아이템 인터페이스
export interface CartItem {
  id: string
  productId: string
  product: PimProductDetail
  selectedOptions: {
    [key: string]: string // 옵션 타입: 선택된 값
  }
  quantity: number
  addedAt: string
  updatedAt: string
  isSelected: boolean
  notes?: string
}

// 장바구니 정보 인터페이스
export interface Cart {
  id: string
  userId: string
  items: CartItem[]
  totalItems: number
  totalPrice: number
  totalDiscount: number
  finalPrice: number
  lastUpdated: string
}

// 장바구니 아이템 mock 데이터 - 실제 PIM 제품 ID 사용
export const mockCartItems: CartItem[] = [
  {
    id: 'cart_item_001',
    productId: '01999bef-e3a4-71ab-bc76-8c549e0d8338',
    product: {
      id: '01999bef-e3a4-71ab-bc76-8c549e0d8338',
      name: '프리미엄 퀵핏 브로우 자',
      thumbnail: 'https://almondyoung.com/web/product/medium/202508/5e79f3b14c6fd554a863922814b1c4b2.jpg',
      basePrice: 35000,
      membershipPrice: 30000,
      brand: '아몬드영영',
      status: 'active',
      createdAt: '2024-01-15T00:00:00Z',
      updatedAt: '2024-12-15T00:00:00Z',
      isMembershipOnly: true,
      isWholesaleOnly: false,
      wholesalePrice: 28000,
      description: '속눈썹 연장에 필요한 모든 도구가 포함된 세트',
      descriptionHtml: '<p>속눈썹 연장에 필요한 모든 도구가 포함된 세트</p>'
    },
    selectedOptions: {},
    quantity: 1,
    addedAt: '2024-12-15T10:30:00Z',
    updatedAt: '2024-12-15T10:30:00Z',
    isSelected: true,
    notes: '전문가용 도구 세트'
  },
  {
    id: 'cart_item_002',
    productId: '01999bef-dcaf-739d-ad1f-b61a54ef59b0',
    product: {
      id: '01999bef-dcaf-739d-ad1f-b61a54ef59b0',
      name: '몽당연필 연장 홀더',
      thumbnail: 'https://almondyoung.com/web/product/medium/202509/7502d761310116776522a7518837cd32.jpg',
      basePrice: 12000,
      membershipPrice: 10000,
      brand: '아몬드영',
      status: 'active',
      createdAt: '2024-02-10T00:00:00Z',
      updatedAt: '2024-12-10T00:00:00Z',
      isMembershipOnly: true,
      isWholesaleOnly: false,
      wholesalePrice: 9000,
      description: '고품질 네일아트 젤 폴리시',
      descriptionHtml: '<p>고품질 네일아트 젤 폴리시</p>'
    },
    selectedOptions: {},
    quantity: 2,
    addedAt: '2024-12-14T15:20:00Z',
    updatedAt: '2024-12-14T15:20:00Z',
    isSelected: true,
    notes: '다양한 색상으로 주문'
  },
  {
    id: 'cart_item_003',
    productId: '01999bef-d5c0-743f-b9eb-cff7e6da05cd',
    product: {
      id: '01999bef-d5c0-743f-b9eb-cff7e6da05cd',
      name: '제이시스 티나스타일링 에센스',
      thumbnail: 'https://almondyoung.com/web/product/medium/202501/38ddc4ccd1e0005e4ffa5275e1d5d033.jpg',
      basePrice: 25000,
      membershipPrice: 20000,
      brand: '티나스타일',
      status: 'active',
      createdAt: '2024-03-05T00:00:00Z',
      updatedAt: '2024-12-05T00:00:00Z',
      isMembershipOnly: true,
      isWholesaleOnly: false,
      wholesalePrice: 18000,
      description: '프리미엄 속눈썹 영양제',
      descriptionHtml: '<p>프리미엄 속눈썹 영양제</p>'
    },
    selectedOptions: {},
    quantity: 1,
    addedAt: '2024-12-13T09:15:00Z',
    updatedAt: '2024-12-13T09:15:00Z',
    isSelected: true,
    notes: '멤버십 전용 상품'
  },
  {
    id: 'cart_item_004',
    productId: '01999bef-ced7-746f-b5c3-55968ddbd2a6',
    product: {
      id: '01999bef-ced7-746f-b5c3-55968ddbd2a6',
      name: '다용도 염색 짜개 치약 튜브 짜개 물감 짜개 미용재료',
      thumbnail: 'https://almondyoung.com/web/product/medium/202502/db90e9f1a6ccdf71d4aa82ed1d405981.png',
      basePrice: 45000,
      membershipPrice: 40000,
      brand: '아몬드영',
      status: 'active',
      createdAt: '2024-04-20T00:00:00Z',
      updatedAt: '2024-12-20T00:00:00Z',
      isMembershipOnly: true,
      isWholesaleOnly: false,
      wholesalePrice: 35000,
      description: '전문가용 네일아트 브러시 세트',
      descriptionHtml: '<p>전문가용 네일아트 브러시 세트</p>'
    },
    selectedOptions: {},
    quantity: 1,
    addedAt: '2024-12-12T14:45:00Z',
    updatedAt: '2024-12-12T14:45:00Z',
    isSelected: true,
    notes: '고급 브러시 세트'
  },
  {
    id: 'cart_item_005',
    productId: '01999bef-c7dc-77c6-9cbc-2698231e8e8f',
    product: {
      id: '01999bef-c7dc-77c6-9cbc-2698231e8e8f',
      name: '남자 댄맨 브러쉬 덴맨브러쉬 이발소 바버샵 브러쉬',
      thumbnail: 'https://almondyoung.com/web/product/medium/202502/6671007ddb31f229f08225e6c05db96b.png',
      basePrice: 50000,
      membershipPrice: 50000,
      brand: '아몬드영',
      status: 'active',
      createdAt: '2024-05-15T00:00:00Z',
      updatedAt: '2024-12-15T00:00:00Z',
      isMembershipOnly: false,
      isWholesaleOnly: false,
      wholesalePrice: 45000,
      description: '속눈썹 펌 전용 키트',
      descriptionHtml: '<p>속눈썹 펌 전용 키트</p>'
    },
    selectedOptions: {},
    quantity: 1,
    addedAt: '2024-12-11T11:30:00Z',
    updatedAt: '2024-12-11T11:30:00Z',
    isSelected: true,
    notes: '펌 전용 키트'
  }
]

// 장바구니 mock 데이터
export const mockCart: Cart = {
  id: 'cart_001',
  userId: 'user_001',
  items: mockCartItems,
  totalItems: mockCartItems.reduce((sum, item) => sum + item.quantity, 0),
  totalPrice: mockCartItems.reduce((sum, item) => sum + ((item.product.basePrice || 0) * item.quantity), 0),
  totalDiscount: mockCartItems.reduce((sum, item) => sum + (((item.product.basePrice || 0) - (item.product.membershipPrice || 0)) * item.quantity), 0),
  finalPrice: mockCartItems.reduce((sum, item) => sum + ((item.product.membershipPrice || 0) * item.quantity), 0),
  lastUpdated: '2024-12-15T10:30:00Z'
}

// 장바구니 관련 유틸리티 함수들
export const addToCart = async (item: {
  productId: string
  quantity: number
  selectedOptions?: { [key: string]: string }
  notes?: string
}): Promise<void> => {
  // 실제 구현에서는 API 호출
  console.log('장바구니에 추가:', item)
}

export const removeFromCart = async (itemId: string): Promise<void> => {
  // 실제 구현에서는 API 호출
  console.log('장바구니에서 제거:', itemId)
}

export const updateCartItemQuantity = async (itemId: string, quantity: number): Promise<void> => {
  // 실제 구현에서는 API 호출
  console.log('장바구니 수량 업데이트:', itemId, quantity)
}

export const clearCart = async (): Promise<void> => {
  // 실제 구현에서는 API 호출
  console.log('장바구니 비우기')
}

export const getCartByUserId = (userId: string): Cart | null => {
  return mockCart.userId === userId ? mockCart : null
}

export const getCartItemsByUserId = (userId: string): CartItem[] => {
  return mockCart.userId === userId ? mockCart.items : []
}