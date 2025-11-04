// 사용자 관련 모든 mock 데이터를 통합하는 인덱스 파일

// 사용자 기본정보
export * from './user-mock'

// 장바구니
export * from './user-cart-mock'

// 구매내역 - PaymentMethod 충돌 해결을 위해 명시적 re-export
export type { 
  Order, 
  OrderItem, 
  OrderStatus, 
  ShippingInfo
} from './user-orders-mock'

export { 
  getOrders,
  getOrdersByUserId,
  getOrderById,
  getRecentOrders,
  getOrderStatistics
} from './user-orders-mock'

// 맞춤정보
export * from './user-preferences-mock'

// 최근 본 상품 - RecentView 충돌 해결을 위해 명시적 re-export
export type { 
  RecentView,
  ViewStatistics
} from './user-recent-views-mock'

export { 
  getRecentViews,
  getRecentViewsByUserId,
  addRecentView,
  getFrequentlyViewedProducts,
  getViewStatistics
} from './user-recent-views-mock'

// 사용자 통합 데이터 타입
export interface UserData {
  user: import('./user-mock').User
  cart: import('./user-cart-mock').Cart
  orders: import('./user-orders-mock').Order[]
  preferences: import('./user-preferences-mock').UserPreferences
  recentViews: import('./user-recent-views-mock').RecentView[]
}

// 사용자 ID로 모든 데이터를 가져오는 함수
export const getUserData = (userId: string): UserData | null => {
  const { getUser } = require('./user-mock')
  const { getCartByUserId, getCart } = require('./user-cart-mock')
  const { getOrdersByUserId } = require('./user-orders-mock')
  const { getUserPreferencesByUserId, getUserPreferences } = require('./user-preferences-mock')
  const { getRecentViewsByUserId } = require('./user-recent-views-mock')

  const user = getUser()
  if (user.id !== userId) return null

  return {
    user,
    cart: getCartByUserId(userId) || getCart(),
    orders: getOrdersByUserId(userId),
    preferences: getUserPreferencesByUserId(userId) || getUserPreferences(),
    recentViews: getRecentViewsByUserId(userId)
  }
}

// 사용자 대시보드 데이터
export interface UserDashboard {
  user: import('./user-mock').User
  cartSummary: {
    totalItems: number
    totalPrice: number
    totalDiscount: number
    finalPrice: number
  }
  orderSummary: {
    totalOrders: number
    recentOrders: import('./user-orders-mock').Order[]
    orderStatistics: any
  }
  preferences: import('./user-preferences-mock').UserPreferences
  recentViews: import('./user-recent-views-mock').RecentView[]
  recommendations: import('./user-preferences-mock').RecommendedProduct[]
  viewStatistics: import('./user-recent-views-mock').ViewStatistics
}

// 사용자 대시보드 데이터 생성 함수
export const getUserDashboard = (userId: string): UserDashboard | null => {
  const userData = getUserData(userId)
  if (!userData) return null

  const { getCart } = require('./user-cart-mock')
  const { getRecentOrders, getOrderStatistics } = require('./user-orders-mock')
  const { getRecommendedProductsByUserId } = require('./user-preferences-mock')
  const { getViewStatistics } = require('./user-recent-views-mock')

  const cart = getCart()
  const recentOrders = getRecentOrders(5)
  const orderStatistics = getOrderStatistics(userId)
  const recommendations = getRecommendedProductsByUserId(userId)
  const viewStatistics = getViewStatistics(userId)

  return {
    user: userData.user,
    cartSummary: {
      totalItems: cart.totalItems,
      totalPrice: cart.totalPrice,
      totalDiscount: cart.totalDiscount,
      finalPrice: cart.finalPrice
    },
    orderSummary: {
      totalOrders: orderStatistics.totalOrders,
      recentOrders,
      orderStatistics
    },
    preferences: userData.preferences,
    recentViews: userData.recentViews.slice(0, 10), // 최근 10개만
    recommendations: recommendations.slice(0, 5), // 추천 5개만
    viewStatistics
  }
}

// 사용자 활동 요약
export interface UserActivitySummary {
  lastLoginDate: string
  totalOrders: number
  totalSpent: number
  favoriteCategories: string[]
  favoriteBrands: string[]
  membershipLevel: string
  recentActivity: {
    type: 'order' | 'view' | 'cart' | 'review'
    description: string
    date: string
  }[]
}

// 사용자 활동 요약 생성 함수
export const getUserActivitySummary = (userId: string): UserActivitySummary | null => {
  const userData = getUserData(userId)
  if (!userData) return null

  const { getOrderStatistics } = require('./user-orders-mock')
  const { getFrequentlyViewedProducts } = require('./user-recent-views-mock')

  const orderStats = getOrderStatistics(userId)
  const frequentProducts = getFrequentlyViewedProducts(userId, 5)

  // 선호 카테고리 추출
  const categoryCount: { [key: string]: number } = {}
  userData.recentViews.forEach(view => {
    // RecentView에는 category 속성이 있으므로 이를 사용
    if (view.category) {
      categoryCount[view.category] = (categoryCount[view.category] || 0) + 1
    }
  })
  const favoriteCategories = Object.entries(categoryCount)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 3)
    .map(([category]) => category)

  // 선호 브랜드 추출 (RecentView에는 브랜드 정보가 없으므로 빈 객체로 처리)
  const brandCount: { [key: string]: number } = {}
  // userData.recentViews.forEach(view => {
  //   if (view.product.brand) {
  //     brandCount[view.product.brand] = (brandCount[view.product.brand] || 0) + 1
  //   }
  // })
  const favoriteBrands = Object.entries(brandCount)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 3)
    .map(([brand]) => brand)

  // 최근 활동 생성
  const recentActivity = [
    {
      type: 'order' as const,
      description: `주문 ${userData.orders[0]?.orderNumber} 완료`,
      date: userData.orders[0]?.createdAt || ''
    },
    {
      type: 'view' as const,
      description: `${userData.recentViews[0]?.productName} 조회`,
      date: userData.recentViews[0]?.viewedAt || ''
    },
    {
      type: 'cart' as const,
      description: `장바구니에 ${userData.cart.totalItems}개 상품`,
      date: userData.cart.lastUpdated
    }
  ].filter(activity => activity.date)

  return {
    lastLoginDate: userData.user.lastLoginDate,
    totalOrders: orderStats.totalOrders,
    totalSpent: orderStats.totalAmount,
    favoriteCategories,
    favoriteBrands,
    membershipLevel: userData.user.membershipLevel,
    recentActivity
  }
}
