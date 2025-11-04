export interface CartItem {
  id: number
  name: string
  option?: string
  brand?: string
  badge?: string
  thumbnail: string
  originalPrice?: number
  discountedPrice: number
  discountRate?: number
  isMembership?: boolean
  quantity: number
  isSameDay?: boolean
  tag?: string
}

export const cartItems: CartItem[] = [
  {
    id: 1,
    name: "[동일제약] 헤어론 프로텐 무향료 칼라크림 1제120g+2제120g",
    option: "4 자연갈색",
    brand: "동일제약",
    badge: "4시 이전 주문 시 당일 출고 보장",
    thumbnail: "https://via.placeholder.com/150/FFDDC1",
    originalPrice: 10000,
    discountedPrice: 4900,
    discountRate: 51,
    isMembership: true,
    quantity: 1,
    isSameDay: true,
    tag: "동일제약",
  },
  {
    id: 2,
    name: "노모드 속눈썹 영양제 블랙",
    option: "마스카라 타입",
    brand: "노모드",
    badge: "4시 이전 주문 시 당일 출고 보장",
    thumbnail: "https://via.placeholder.com/150/C1FFDD",
    originalPrice: 60000,
    discountedPrice: 18000,
    discountRate: 70,
    isMembership: true,
    quantity: 2,
    isSameDay: true,
  },
  {
    id: 3,
    name: "[소망] 멘세라드 하이드레이팅 헤어팩 1000ml",
    option: "4 자연갈색",
    brand: "동일제약",
    badge: "4시 이전 주문 시 당일 출고 보장",
    thumbnail: "https://via.placeholder.com/150/D1C1FF",
    originalPrice: 10000,
    discountedPrice: 9000,
    discountRate: 10,
    isMembership: true,
    quantity: 1,
    isSameDay: true,
  },
  {
    id: 4,
    name: "[동일제약] 헤어론 프로텐 무향료 칼라크림 1제120g+2제120g",
    option: "4 자연갈색",
    brand: "동일제약",
    badge: "4시 이전 주문 시 당일 출고 보장",
    thumbnail: "https://via.placeholder.com/150/FFDDC1",
    originalPrice: 10000,
    discountedPrice: 9000,
    discountRate: 10,
    isMembership: true,
    quantity: 1,
    isSameDay: true,
  },
]

export const getCartItems = () => cartItems
export const getCartItemById = (id: number) => cartItems.find(item => item.id === id)
