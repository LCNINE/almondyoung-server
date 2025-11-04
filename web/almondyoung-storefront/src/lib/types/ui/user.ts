
//사용자 정보
export interface UserBasicInfo {
  id: string
  email: string
  name: string
  phone?: string
  profileImage?: string
  birthDate: Date
  isEmailVerified: boolean
  lastActivityAt: Date
  shop: UserShopInfo
  basicAddress: UserAddress
  preferences: {
    marketingEmail: boolean
    marketingSms: boolean
    pushNotifications: boolean
  }
  membershipLevel: 'basic' | 'premium' | 'vip' //membership 서비스에서 받음
  isMembership: boolean



}


export interface UserDetailInfo extends UserBasicInfo {

  addressGroup: UserAddress[]
  paymentMethods: UserPaymentMethod[]
  joinDate: Date
  // orderHistory: OrderSummary[]
  // wishlist: UserWishlistItem[]
  // recentViews: UserRecentViewItem[]
}

// 카테고리 정보 UI 타입
export interface UserCategoryInfo {
  id: string; //카테고리 ID
  name: string; //카테고리 이름
}

export interface UserShopInfo {
  isOperating: boolean; //운영 여부
  yearsOperating: number | null; //운영 연수
  shopType?: 'solo' | 'small' | 'large' | null; //상점 유형
  categories: UserCategoryInfo[]; //카테고리 정보 (ID와 이름 포함)
  targetCustomers: unknown; //타겟 고객 정보
  openDays: unknown; //영업일 정보
  createdAt: Date; //상점 생성일
  updatedAt: Date;
}

export interface UserAddress {
  id: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  createdAt: Date;
  updatedAt: Date;
}

//등록한 결제수단
export interface UserPaymentMethod {
  id: string
  type: 'card' | 'kakao' | 'naver' | 'bank'
  name: string
  lastFour?: string
  expiryDate?: string
  isDefault: boolean
}




//주문한 상품정보 요약 wms type 으로 추후 이동
// export interface OrderSummary {
//   id: string
//   orderNumber: string
//   status: 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'
//   totalAmount: number
//   itemCount: number
//   orderDate: string
//   deliveryDate?: string
//   products: {
//     id: string
//     name: string
//     image: string
//     quantity: number
//     price: number
//   }[]
// }

//찜한 상품 어디서 알수...?
// export interface UserWishlistItem {
//   id: string
//   productId: string
//   productName: string
//   productImage: string
//   price: number
//   addedDate: string
// }

//최근 본 상품 어디서 알수...?
// export interface UserRecentViewItem {
//   id: string
//   productId: string
//   productName: string
//   productImage: string
//   price: number
//   viewedDate: string
// }

//동의사항
export interface UserConsents {

}