# 사용자 Mock 데이터 사용 가이드

이 디렉토리에는 서버 연결이 어려울 때 사용할 수 있는 사용자 관련 mock 데이터들이 포함되어 있습니다.

## 📁 파일 구조

```
__mocks__/
├── user-mock.ts              # 사용자 기본정보
├── user-cart-mock.ts         # 장바구니 데이터
├── user-orders-mock.ts       # 구매내역 데이터
├── user-preferences-mock.ts  # 맞춤정보 및 추천 데이터
├── user-recent-views-mock.ts # 최근 본 상품 내역
├── user-mock-index.ts        # 통합 인덱스 파일
└── README.md                 # 이 파일
```

## 🚀 사용 방법

### 1. 개별 모듈 사용

```typescript
// 사용자 기본정보
import { getUser, getUserById, updateUser } from './user-mock'

const user = getUser()
const userById = getUserById('user_001')

// 장바구니
import { getCart, getCartItems, addToCart } from './user-cart-mock'

const cart = getCart()
const items = getCartItems()
const newItem = addToCart('product_001', { color: 'black' }, 2)

// 구매내역
import { getOrders, getOrdersByUserId, getOrderById } from './user-orders-mock'

const orders = getOrders()
const userOrders = getOrdersByUserId('user_001')
const order = getOrderById('order_001')

// 맞춤정보
import { getUserPreferences, getRecommendedProducts } from './user-preferences-mock'

const preferences = getUserPreferences()
const recommendations = getRecommendedProducts()

// 최근 본 상품
import { getRecentViews, addRecentView } from './user-recent-views-mock'

const recentViews = getRecentViews()
const newView = addRecentView('user_001', 'product_001', product, 'search', 'mobile', 'session_001')
```

### 2. 통합 사용 (권장)

```typescript
// 통합 사용 (권장)
import { getUserData, getUserDashboard } from './user-mock-index'

const userData = getUserData('user_001')
const dashboard = getUserDashboard('user_001')

// 개별 사용
import { getUser } from './user-mock'
import { getCart } from './user-cart-mock'
import { getOrders } from './user-orders-mock'
```

## 📊 데이터 구조

### 사용자 기본정보 (User)
- 개인정보: 이름, 이메일, 전화번호, 생년월일 등
- 멤버십: 레벨, 포인트, 가입일
- 주소: 기본 주소, 추가 주소들
- 설정: 마케팅 동의, 알림 설정 등

### 장바구니 (Cart)
- 상품 정보와 선택된 옵션
- 수량, 가격, 할인 정보
- 선택 상태, 메모 등

### 구매내역 (Order)
- 주문 정보: 주문번호, 상태, 결제 정보
- 배송 정보: 수령인, 주소, 추적번호
- 주문 아이템: 상품, 옵션, 가격 등

### 맞춤정보 (UserPreferences)
- 피부 타입, 관심 카테고리
- 브랜드 선호도, 가격대 선호도
- 구매 패턴, 알레르기 정보
- 추천 설정

### 최근 본 상품 (RecentView)
- 조회한 상품 정보
- 조회 시간, 지속 시간
- 조회 경로, 디바이스 정보

## 🔧 커스터마이징

### 데이터 수정
각 mock 파일에서 데이터를 직접 수정할 수 있습니다:

```typescript
// user-mock.ts에서 사용자 정보 수정
export const mockUser: User = {
  id: 'user_001',
  name: '새로운 이름',
  // ... 기타 필드
}
```

### 함수 확장
새로운 함수를 추가하여 기능을 확장할 수 있습니다:

```typescript
// user-mock.ts에 새 함수 추가
export const getUserByEmail = (email: string): User | null => {
  return mockUser.email === email ? mockUser : null
}
```

## ⚠️ 주의사항

1. **데이터 일관성**: 여러 파일에서 같은 사용자 ID를 사용하고 있으므로, ID를 변경할 때는 모든 파일을 함께 수정해야 합니다.

2. **Product 인터페이스**: Product 타입을 사용하는 모든 mock 데이터는 `product-mock.ts`의 Product 인터페이스와 일치해야 합니다.

3. **타입 안전성**: TypeScript를 사용하여 타입 안전성을 보장합니다. 새로운 필드를 추가할 때는 해당 인터페이스도 함께 업데이트하세요.

4. **성능**: mock 데이터는 개발/테스트 목적으로만 사용하고, 프로덕션에서는 실제 API를 사용해야 합니다.

## 🎯 사용 사례

- **개발 중**: 서버 API가 준비되지 않았을 때 프론트엔드 개발 진행
- **테스트**: 컴포넌트 테스트 시 일관된 데이터 제공
- **데모**: 클라이언트 데모 시 실제와 유사한 데이터 표시
- **오프라인 개발**: 네트워크 연결 없이도 개발 가능

이 mock 데이터를 활용하여 효율적으로 개발을 진행하세요! 🚀
