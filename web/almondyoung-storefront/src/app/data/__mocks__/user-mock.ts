// 사용자 mock 데이터
export interface User {
  id: string
  email: string
  name: string
  phone?: string
  profileImage?: string
  isEmailVerified: boolean
  isPhoneVerified: boolean
  membershipLevel: "basic" | "premium" | "vip"
  joinDate: string
  lastLoginDate: string
  preferences: {
    marketingEmail: boolean
    marketingSms: boolean
    pushNotifications: boolean
  }
  specialty: {
    field: "eyelash" | "nail" | "skincare" | "makeup" | "hair" | "general"
    experience: number // 경력 (년)
    certifications: string[] // 자격증
    interests: string[] // 관심 분야
  }
  addresses: UserAddress[]
  paymentMethods: PaymentMethod[]
  orderHistory: OrderSummary[]
  wishlist: WishlistItem[]
  recentViews: RecentView[]
}

export interface UserAddress {
  id: string
  name: string
  recipient: string
  phone: string
  address: string
  detailAddress: string
  postalCode: string
  isDefault: boolean
  isHome: boolean
  isWork: boolean
}

export interface PaymentMethod {
  id: string
  type: "card" | "bank" | "kakao" | "naver"
  name: string
  lastFour?: string
  expiryDate?: string
  isDefault: boolean
}

export interface OrderSummary {
  id: string
  orderNumber: string
  status:
    | "pending"
    | "paid"
    | "shipped"
    | "delivered"
    | "cancelled"
    | "refunded"
  totalAmount: number
  itemCount: number
  orderDate: string
  deliveryDate?: string
  products: {
    id: string
    name: string
    image: string
    quantity: number
    price: number
  }[]
}

export interface WishlistItem {
  id: string
  productId: string
  productName: string
  productImage: string
  price: number
  addedDate: string
}

export interface RecentView {
  id: string
  productId: string
  productName: string
  productImage: string
  price: number
  viewedDate: string
}

// Mock 사용자 데이터
export const mockUser: User = {
  id: "user-001",
  email: "user@example.com",
  name: "김아몬드",
  phone: "010-1234-5678",
  profileImage: "https://via.placeholder.com/100x100/4F46E5/FFFFFF?text=L",
  isEmailVerified: true,
  isPhoneVerified: true,
  membershipLevel: "premium",
  joinDate: "2024-01-15",
  lastLoginDate: "2024-12-19",
  preferences: {
    marketingEmail: true,
    marketingSms: false,
    pushNotifications: true,
  },
  specialty: {
    field: "eyelash",
    experience: 5,
    certifications: ["속눈썹 전문가 자격증", "네일아트 자격증"],
    interests: ["속눈썹 연장", "속눈썹 펌", "네일아트", "스킨케어"],
  },
  addresses: [
    {
      id: "addr-001",
      name: "집",
      recipient: "김아몬드",
      phone: "010-1234-5678",
      address: "서울특별시 강남구 테헤란로 123",
      detailAddress: "아몬드빌딩 5층",
      postalCode: "06292",
      isDefault: true,
      isHome: true,
      isWork: false,
    },
    {
      id: "addr-002",
      name: "회사",
      recipient: "김아몬드",
      phone: "010-1234-5678",
      address: "서울특별시 서초구 서초대로 456",
      detailAddress: "아몬드타워 10층",
      postalCode: "06620",
      isDefault: false,
      isHome: false,
      isWork: true,
    },
  ],
  paymentMethods: [
    {
      id: "pay-001",
      type: "card",
      name: "신한카드",
      lastFour: "1234",
      expiryDate: "12/26",
      isDefault: true,
    },
    {
      id: "pay-002",
      type: "kakao",
      name: "카카오페이",
      isDefault: false,
    },
  ],
  orderHistory: [
    {
      id: "order-001",
      orderNumber: "ALM202412150001",
      status: "delivered",
      totalAmount: 18000,
      itemCount: 2,
      orderDate: "2024-12-15",
      deliveryDate: "2024-12-17",
      products: [
        {
          id: "01999b22-b084-75a9-baca-828ca45cc860",
          name: "노몬드 속눈썹 영양제 블랙",
          image:
            "https://almondyoung.com/web/product/medium/202411/0cb36a2e9d839361f114a5e4c9070f6d.png",
          quantity: 2,
          price: 18000,
        },
      ],
    },
    {
      id: "order-002",
      orderNumber: "ALM202412100002",
      status: "delivered",
      totalAmount: 15000,
      itemCount: 1,
      orderDate: "2024-12-10",
      deliveryDate: "2024-12-12",
      products: [
        {
          id: "01999b22-e428-7193-b3b4-cc8de967be7e",
          name: "노몬드 색소 (에멀젼)",
          image:
            "https://almondyoung.com/web/product/medium/202409/b84f3d09cc04d83d05d345efc3e29560.png",
          quantity: 1,
          price: 15000,
        },
      ],
    },
  ],
  wishlist: [
    {
      id: "wish-001",
      productId: "01999bef-42b5-76ec-b93e-f12051e1af62",
      productName: "[웰컴 멤버십] 옐로우 색소컵 소형 100개입",
      productImage:
        "https://almondyoung.com/web/product/medium/202311/6a59216bec6d8dc723157aed3d959456.png",
      price: 100,
      addedDate: "2024-12-18",
    },
    {
      id: "wish-002",
      productId: "01999bf0-3119-74f9-9c4c-acecb30fc56a",
      productName: "블랙 투웨이 트위저 꾹꾹이 네일 핀셋",
      productImage:
        "https://almondyoung.com/web/product/medium/202503/739858f499dacfa9125df93ac0dd0737.jpg",
      price: 1000,
      addedDate: "2024-12-17",
    },
  ],
  recentViews: [
    {
      id: "view-001",
      productId: "01999b22-b084-75a9-baca-828ca45cc860",
      productName: "노몬드 속눈썹 영양제 블랙",
      productImage:
        "https://almondyoung.com/web/product/medium/202411/0cb36a2e9d839361f114a5e4c9070f6d.png",
      price: 9000,
      viewedDate: "2024-12-19",
    },
    {
      id: "view-002",
      productId: "01999b22-e428-7193-b3b4-cc8de967be7e",
      productName: "노몬드 색소 (에멀젼)",
      productImage:
        "https://almondyoung.com/web/product/medium/202409/b84f3d09cc04d83d05d345efc3e29560.png",
      price: 15000,
      viewedDate: "2024-12-18",
    },
  ],
}

// 사용자 데이터 조회 함수들
export function getUserById(id: string): User | null {
  return mockUser.id === id ? mockUser : null
}

export function getUserByEmail(email: string): User | null {
  return mockUser.email === email ? mockUser : null
}

export function updateUserProfile(
  userId: string,
  updates: Partial<User>
): User | null {
  if (mockUser.id !== userId) return null

  Object.assign(mockUser, updates)
  return mockUser
}

export function addUserAddress(
  userId: string,
  address: Omit<UserAddress, "id">
): UserAddress | null {
  if (mockUser.id !== userId) return null

  const newAddress: UserAddress = {
    ...address,
    id: `addr-${Date.now()}`,
  }

  mockUser.addresses.push(newAddress)
  return newAddress
}

export function updateUserAddress(
  userId: string,
  addressId: string,
  updates: Partial<UserAddress>
): UserAddress | null {
  if (mockUser.id !== userId) return null

  const addressIndex = mockUser.addresses.findIndex(
    (addr) => addr.id === addressId
  )
  if (addressIndex === -1) return null

  Object.assign(mockUser.addresses[addressIndex], updates)
  return mockUser.addresses[addressIndex]
}

export function deleteUserAddress(userId: string, addressId: string): boolean {
  if (mockUser.id !== userId) return false

  const addressIndex = mockUser.addresses.findIndex(
    (addr) => addr.id === addressId
  )
  if (addressIndex === -1) return false

  mockUser.addresses.splice(addressIndex, 1)
  return true
}

export function addToWishlist(
  userId: string,
  product: Omit<WishlistItem, "id" | "addedDate">
): WishlistItem | null {
  if (mockUser.id !== userId) return null

  const wishlistItem: WishlistItem = {
    ...product,
    id: `wish-${Date.now()}`,
    addedDate: new Date().toISOString().split("T")[0],
  }

  mockUser.wishlist.push(wishlistItem)
  return wishlistItem
}

export function removeFromWishlist(
  userId: string,
  wishlistItemId: string
): boolean {
  if (mockUser.id !== userId) return false

  const itemIndex = mockUser.wishlist.findIndex(
    (item) => item.id === wishlistItemId
  )
  if (itemIndex === -1) return false

  mockUser.wishlist.splice(itemIndex, 1)
  return true
}

export function addRecentView(
  userId: string,
  product: Omit<RecentView, "id" | "viewedDate">
): RecentView | null {
  if (mockUser.id !== userId) return null

  const recentView: RecentView = {
    ...product,
    id: `view-${Date.now()}`,
    viewedDate: new Date().toISOString().split("T")[0],
  }

  // 최근 본 상품은 최대 20개까지만 유지
  mockUser.recentViews.unshift(recentView)
  if (mockUser.recentViews.length > 20) {
    mockUser.recentViews = mockUser.recentViews.slice(0, 20)
  }

  return recentView
}
