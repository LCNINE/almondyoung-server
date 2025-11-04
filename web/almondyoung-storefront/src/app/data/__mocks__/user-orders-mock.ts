import { ProductDetail } from '../../../lib/types/ui/product'

// 주문 상태 타입
export type OrderStatus = 
  | 'pending' // 결제 대기
  | 'paid' // 결제 완료
  | 'preparing' // 상품 준비 중
  | 'shipped' // 배송 중
  | 'delivered' // 배송 완료
  | 'cancelled' // 주문 취소
  | 'refunded' // 환불 완료

// 결제 방법 타입
export type PaymentMethod = 
  | 'card' // 카드 결제
  | 'bank_transfer' // 계좌이체
  | 'kakao_pay' // 카카오페이
  | 'naver_pay' // 네이버페이
  | 'toss_pay' // 토스페이

// 배송 상태 타입
export type ShippingStatus = 
  | 'preparing' // 배송 준비 중
  | 'shipped' // 배송 중
  | 'delivered' // 배송 완료
  | 'returned' // 반품
  | 'exchanged' // 교환

// 주문 아이템 인터페이스
export interface OrderItem {
  id: string
  productId: string
  product: ProductDetail
  selectedOptions: {
    [key: string]: string
  }
  quantity: number
  unitPrice: number
  totalPrice: number
  discountAmount: number
  finalPrice: number
}

// 배송 정보 인터페이스
export interface ShippingInfo {
  id: string
  recipient: string
  phone: string
  zipCode: string
  address: string
  detailAddress: string
  memo?: string
  trackingNumber?: string
  courier?: string
  status: ShippingStatus
  shippedAt?: string
  deliveredAt?: string
}

// 주문 정보 인터페이스
export interface Order {
  id: string
  orderNumber: string
  userId: string
  items: OrderItem[]
  shippingInfo: ShippingInfo
  paymentInfo: {
    method: PaymentMethod
    amount: number
    discountAmount: number
    finalAmount: number
    paidAt: string
    transactionId: string
  }
  status: OrderStatus
  createdAt: string
  updatedAt: string
  cancelledAt?: string
  refundedAt?: string
  notes?: string
}

// 구매내역 mock 데이터
export const mockOrders: Order[] = [
  {
    id: 'order_001',
    orderNumber: 'ALM202412150001',
    userId: 'user_001',
    items: [
      {
        id: 'order_item_001',
        productId: '01999bf0-3f40-751b-a684-c8d68dc1757e',
        product: {
          id: '01999bf0-3f40-751b-a684-c8d68dc1757e',
          name: '노몬드 속눈썹 영양제 블랙',
          description: '노몬드 속눈썹 영양제 블랙 제품입니다.',
          thumbnail: 'https://almondyoung.com/web/product/medium/202409/b84f3d09cc04d83d05d345efc3e29560.png',
          price: {
            original: 9000,
            member: 9000,
            isMembership: true
          },
          brand: '노몬드',
          thumbnails: [],
          options: [],
        },
        selectedOptions: {},
        quantity: 2,
        unitPrice: 9000,
        totalPrice: 18000,
        discountAmount: 0,
        finalPrice: 18000
      }
    ],
    shippingInfo: {
      id: 'shipping_001',
      recipient: '김아몬드',
      phone: '010-1234-5678',
      zipCode: '06292',
      address: '서울특별시 강남구 테헤란로 123',
      detailAddress: '아몬드빌딩 5층',
      memo: '문 앞에 놓아주세요',
      trackingNumber: '1234567890',
      courier: 'CJ대한통운',
      status: 'delivered',
      shippedAt: '2024-12-16T09:00:00Z',
      deliveredAt: '2024-12-17T14:30:00Z'
    },
    paymentInfo: {
      method: 'card',
      amount: 18000,
      discountAmount: 0,
      finalAmount: 18000,
      paidAt: '2024-12-15T10:35:00Z',
      transactionId: 'TXN_20241215_001'
    },
    status: 'delivered',
    createdAt: '2024-12-15T10:30:00Z',
    updatedAt: '2024-12-17T14:30:00Z'
  },
  {
    id: 'order_002',
    orderNumber: 'ALM202412100002',
    userId: 'user_001',
    items: [
      {
        id: 'order_item_002',
        productId: '01999b22-f80f-720d-ade3-5735cb32027f',
        product: {
          id: '01999b22-f80f-720d-ade3-5735cb32027f',
          name: '노몬드 색소 (에멀젼)',
          thumbnail: 'https://almondyoung.com/web/product/medium/202409/b84f3d09cc04d83d05d345efc3e29560.png',
          options: [],
          price: {
            original: 15000,
            member: 15000,
            isMembership: true
          },
          brand: '노몬드',
          thumbnails: [],
          shipping: {
            type: 'domestic',
            method: '택배',
            cost: '무료',
            averageRestockDays: 1
          }
        },
        selectedOptions: {},
        quantity: 1,
        unitPrice: 15000,
        totalPrice: 15000,
        discountAmount: 0,
        finalPrice: 15000
      },
      {
        id: 'order_item_005',
        productId: '01999b22-c808-71df-9fe0-474d3b7b5d0e',
        product: {
          id: '01999b22-c808-71df-9fe0-474d3b7b5d0e',
          name: '네일아트 브러시 세트',
          thumbnail: 'https://almondyoung.com/web/product/medium/202411/nail-brush-set.png',
          options: [],
          price: {
            original: 18000,
            member: 15000,
            isMembership: true
          },
          brand: '네일아트',
          thumbnails: [],
          shipping: {
            type: 'domestic',
            method: '택배',
            cost: '무료',
            averageRestockDays: 1
          }
        },
        selectedOptions: {},
        quantity: 1,
        unitPrice: 15000,
        totalPrice: 15000,
        discountAmount: 3000,
        finalPrice: 15000
      }
    ],
    shippingInfo: {
      id: 'shipping_002',
      recipient: '김아몬드',
      phone: '010-1234-5678',
      zipCode: '06292',
      address: '서울특별시 강남구 테헤란로 123',
      detailAddress: '아몬드빌딩 5층',
      trackingNumber: '0987654321',
      courier: '한진택배',
      status: 'delivered',
      shippedAt: '2024-12-11T14:00:00Z',
      deliveredAt: '2024-12-12T11:20:00Z'
    },
    paymentInfo: {
      method: 'kakao_pay',
      amount: 15000,
      discountAmount: 0,
      finalAmount: 15000,
      paidAt: '2024-12-10T16:45:00Z',
      transactionId: 'TXN_20241210_002'
    },
    status: 'delivered',
    createdAt: '2024-12-10T16:40:00Z',
    updatedAt: '2024-12-12T11:20:00Z'
  },
  {
    id: 'order_003',
    orderNumber: 'ALM202401080003',
    userId: 'user_001',
    items: [
      {
        id: 'order_item_003',
        productId: '01999b22-a25c-722e-8918-a6e4fc2e063e',
        product: {
          id: '01999b22-a25c-722e-8918-a6e4fc2e063e',
          name: '[소망] 멘세라드 하이드레이팅 헤어팩',
          thumbnail: 'https://via.placeholder.com/150/D1C1FF',
          price: {
            original: 10000,
            member: 9000,
            isMembership: true
          },
          brand: '소망',
          thumbnails: [],
          options: [],
          shipping: {
            type: 'domestic',
            method: '택배',
            cost: '무료',
            averageRestockDays: 1
          }
        },
        selectedOptions: {},
        quantity: 1,
        unitPrice: 9000,
        totalPrice: 9000,
        discountAmount: 1000,
        finalPrice: 9000
      },
      {
        id: 'order_item_004',
        productId: '01999b22-b084-75a9-baca-828ca45cc860',
        product: {
          id: '01999b22-b084-75a9-baca-828ca45cc860',
          name: '속눈썹 영양제',
          thumbnail: 'https://almondyoung.com/web/product/medium/202411/lash-nutrition.png',
          price: {
            original: 12000,
            member: 10000,
            isMembership: true
          },
          brand: '노몬드',
          thumbnails: [],
          options: [],
          shipping: {
            type: 'domestic',
            method: '택배',
            cost: '무료',
            averageRestockDays: 1
          }
        },
        selectedOptions: {},
        quantity: 1,
        unitPrice: 10000,
        totalPrice: 10000,
        discountAmount: 2000,
        finalPrice: 10000
      }
    ],
    shippingInfo: {
      id: 'shipping_003',
      recipient: '김알몬드',
      phone: '010-1234-5678',
      zipCode: '12345',
      address: '서울특별시 강남구 테헤란로 123',
      detailAddress: '알몬드빌딩 5층',
      trackingNumber: '1122334455',
      courier: 'CJ대한통운',
      status: 'shipped',
      shippedAt: '2024-01-09T10:00:00Z'
    },
    paymentInfo: {
      method: 'naver_pay',
      amount: 10000,
      discountAmount: 1000,
      finalAmount: 9000,
      paidAt: '2024-01-08T20:15:00Z',
      transactionId: 'TXN_20240108_003'
    },
    status: 'shipped',
    createdAt: '2024-01-08T20:10:00Z',
    updatedAt: '2024-01-09T10:00:00Z'
  },
  {
    id: 'order_004',
    orderNumber: 'ALM202401050004',
    userId: 'user_001',
    items: [
      {
        id: 'order_item_004',
        productId: 'product_004',
        product: {
          id: 'product_004',
          name: '[취향] 립밤 세트',
          thumbnail: 'https://via.placeholder.com/150/FFC1DD',
          options: [],
          price: {
            original: 25000,
            member: 15000,
            isMembership: true
          },
          brand: '취향',
          thumbnails: [],
          shipping: {
            type: 'domestic',
            method: '택배',
            cost: '무료',
            averageRestockDays: 1
          }
        },
        selectedOptions: {
          color: 'pink'
        },
        quantity: 1,
        unitPrice: 15000,
        totalPrice: 15000,
        discountAmount: 10000,
        finalPrice: 15000
      }
    ],
    shippingInfo: {
      id: 'shipping_004',
      recipient: '김알몬드',
      phone: '010-1234-5678',
      zipCode: '12345',
      address: '서울특별시 강남구 테헤란로 123',
      detailAddress: '알몬드빌딩 5층',
      status: 'preparing'
    },
    paymentInfo: {
      method: 'toss_pay',
      amount: 25000,
      discountAmount: 10000,
      finalAmount: 15000,
      paidAt: '2024-01-05T14:30:00Z',
      transactionId: 'TXN_20240105_004'
    },
    status: 'preparing',
    createdAt: '2024-01-05T14:25:00Z',
    updatedAt: '2024-01-05T14:30:00Z'
  }
]

// 구매내역 관련 함수들
export const getOrders = (): Order[] => mockOrders

export const getOrdersByUserId = (userId: string): Order[] => {
  return mockOrders.filter(order => order.userId === userId)
}

export const getOrderById = (orderId: string): Order | null => {
  return mockOrders.find(order => order.id === orderId) || null
}

export const getOrderByOrderNumber = (orderNumber: string): Order | null => {
  return mockOrders.find(order => order.orderNumber === orderNumber) || null
}

export const getOrdersByStatus = (status: OrderStatus): Order[] => {
  return mockOrders.filter(order => order.status === status)
}

export const getRecentOrders = (limit: number = 5): Order[] => {
  return mockOrders
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
}

export const updateOrderStatus = (orderId: string, status: OrderStatus): Order | null => {
  const order = mockOrders.find(order => order.id === orderId)
  if (order) {
    order.status = status
    order.updatedAt = new Date().toISOString()
    
    if (status === 'cancelled') {
      order.cancelledAt = new Date().toISOString()
    } else if (status === 'refunded') {
      order.refundedAt = new Date().toISOString()
    }
    
    return order
  }
  return null
}

export const getOrderStatistics = (userId: string) => {
  const userOrders = getOrdersByUserId(userId)
  
  return {
    totalOrders: userOrders.length,
    totalAmount: userOrders.reduce((sum, order) => sum + order.paymentInfo.finalAmount, 0),
    totalDiscount: userOrders.reduce((sum, order) => sum + order.paymentInfo.discountAmount, 0),
    statusCounts: {
      pending: userOrders.filter(order => order.status === 'pending').length,
      paid: userOrders.filter(order => order.status === 'paid').length,
      preparing: userOrders.filter(order => order.status === 'preparing').length,
      shipped: userOrders.filter(order => order.status === 'shipped').length,
      delivered: userOrders.filter(order => order.status === 'delivered').length,
      cancelled: userOrders.filter(order => order.status === 'cancelled').length,
      refunded: userOrders.filter(order => order.status === 'refunded').length
    }
  }
}
