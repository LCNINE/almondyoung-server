# 아몬드영 백엔드 시드 데이터 분석

## 개요

이 문서는 아몬드영 백엔드의 각 마이크로서비스에서 필요한 초기 시드 데이터를 정리합니다.
시드 데이터의 PK(UUID)는 상수 값으로 고정하여 멱등성을 보장합니다.

## 시드 스크립트 설계 원칙

1. **멱등성(Idempotency)**: 여러 번 실행해도 동일한 결과
2. **고정 UUID**: 시드 데이터의 PK는 미리 정의된 상수 사용
3. **존재 확인**: INSERT 전에 해당 UUID가 이미 존재하는지 확인
4. **독립 실행**: 각 서비스별로 독립적으로 실행 가능
5. **환경 독립성**: 자체 .env 파일 사용

---

## 1. WMS (Warehouse Management System)

**Schema Path**: `apps/wms/database/schemas/wms-schema.ts`

### 1.1 필수 시드 데이터

#### warehouses (창고)
```typescript
{
  id: 'wms-warehouse-main-00001', // 고정 UUID
  code: 'MAIN',
  name: '메인 창고',
  address: '서울시 강남구',
  is_active: true,
  warehouse_type: 'regular'
}
```

**이유**: 모든 재고 관리의 기준이 되는 기본 창고가 필요

#### locations (로케이션)
```typescript
// 1. 시스템 로케이션: RECEIVING (입고 대기)
{
  id: 'wms-location-receiving-001',
  warehouse_id: 'wms-warehouse-main-00001',
  code: 'RECEIVING',
  name: '입고 대기',
  location_type: 'RECEIVING',
  is_system: true,
  x: 0, y: 0, priority_rank: 0
}

// 2. 시스템 로케이션: DAMAGE (손상품)
{
  id: 'wms-location-damage-001',
  warehouse_id: 'wms-warehouse-main-00001',
  code: 'DAMAGE',
  name: '손상품',
  location_type: 'DAMAGE',
  is_system: true,
  x: 0, y: 0, priority_rank: 0
}

// 3. 시스템 로케이션: RETURN (반품)
{
  id: 'wms-location-return-001',
  warehouse_id: 'wms-warehouse-main-00001',
  code: 'RETURN',
  name: '반품',
  location_type: 'RETURN',
  is_system: true,
  x: 0, y: 0, priority_rank: 0
}

// 4. 시스템 로케이션: SHIPPING (출고 대기)
{
  id: 'wms-location-shipping-001',
  warehouse_id: 'wms-warehouse-main-00001',
  code: 'SHIPPING',
  name: '출고 대기',
  location_type: 'SHIPPING',
  is_system: true,
  x: 0, y: 0, priority_rank: 0
}

// 5. 기본 보관 로케이션 (예시)
{
  id: 'wms-location-storage-a01',
  warehouse_id: 'wms-warehouse-main-00001',
  code: 'A-01-01',
  name: 'A동 1열 1단',
  location_type: 'STORAGE',
  is_system: false,
  x: 1, y: 1, priority_rank: 1
}
```

**이유**: WMS는 입고/출고/손상/반품 등의 시스템 로케이션 없이 작동 불가

#### settings (시스템 설정)
```typescript
{
  key: 'wms.default_warehouse_id',
  value: 'wms-warehouse-main-00001',
  description: '기본 창고 ID'
}
```

**이유**: 시스템 기본값 설정 필요

### 1.2 선택적 시드 데이터

- **suppliers**: 공급업체 (운영 중 등록 가능)
- **categories**: 상품 카테고리 (운영 중 등록 가능)
- **delivery_profiles**: 배송 프로필 (운영 중 설정 가능)

---

## 2. PIM (Product Information Management)

**Schema Path**: `apps/pim/src/schema.ts`

### 2.1 필수 시드 데이터

#### sales_channels (판매 채널)
```typescript
// 1. 자사몰 (Medusa)
{
  id: 'pim-channel-medusa-00001',
  type: 'ONLINE',
  site: 'MEDUSA',
  name: '아몬드영 자사몰',
  is_active: true
}

// 2. 쿠팡
{
  id: 'pim-channel-coupang-00001',
  type: 'ONLINE',
  site: 'COUPANG',
  name: '쿠팡',
  is_active: true
}

// 3. 네이버
{
  id: 'pim-channel-naver-00001',
  type: 'ONLINE',
  site: 'NAVER',
  name: '네이버 스마트스토어',
  is_active: true
}
```

**이유**: 채널별 상품 등록의 기준이 되는 판매 채널 필요

#### channel_categories (채널 카테고리)
```typescript
{
  id: 'pim-channel-cat-ecommerce',
  name: '온라인 쇼핑몰',
  description: '일반 온라인 이커머스 플랫폼',
  display_order: 1
}
```

**이유**: 채널을 그룹화하여 관리

#### product_categories (상품 카테고리)
```typescript
// 루트 카테고리
{
  id: 'pim-category-root-00001',
  name: '전체',
  slug: 'all',
  parent_id: null,
  level: 0,
  path: '',
  sort_order: 0,
  is_active: true
}
```

**이유**: 카테고리 트리 구조의 루트 필요

### 2.2 선택적 시드 데이터

- **tag_groups**: 태그 그룹 (운영 중 생성 가능)
- **banner_groups**: 배너 그룹 (운영 중 생성 가능)

---

## 3. User Service

**Schema Path**: `apps/user-service/database/drizzle/schema.ts`

### 3.1 필수 시드 데이터

#### roles (역할)
```typescript
// 1. 최고 관리자
{
  role_id: 'user-role-superadmin-001',
  name: 'superadmin',
  description: '시스템 최고 관리자'
}

// 2. 관리자
{
  role_id: 'user-role-admin-00001',
  name: 'admin',
  description: '일반 관리자'
}

// 3. 일반 회원
{
  role_id: 'user-role-customer-001',
  name: 'customer',
  description: '일반 회원'
}

// 4. 도매 회원
{
  role_id: 'user-role-wholesale-001',
  name: 'wholesale',
  description: '도매 회원'
}

// 5. 멤버십 회원
{
  role_id: 'user-role-membership-001',
  name: 'membership',
  description: '멤버십 회원'
}
```

**이유**: 회원가입 시 기본 역할 할당 필요

#### scopes (권한)
```typescript
// 관리자 권한
{
  scope_id: 'user-scope-admin-read',
  scope_name: 'admin:read',
  description: '관리 페이지 읽기'
}
{
  scope_id: 'user-scope-admin-write',
  scope_name: 'admin:write',
  description: '관리 페이지 쓰기'
}

// 상품 권한
{
  scope_id: 'user-scope-product-read',
  scope_name: 'product:read',
  description: '상품 읽기'
}

// 주문 권한
{
  scope_id: 'user-scope-order-write',
  scope_name: 'order:write',
  description: '주문 생성'
}
```

**이유**: 역할 기반 접근 제어(RBAC)의 기본 권한 필요

#### role_scopes (역할-권한 매핑)
```typescript
// superadmin = 모든 권한
{
  id: 'user-rolescope-sa-admin-r',
  role_id: 'user-role-superadmin-001',
  scope_id: 'user-scope-admin-read'
}
// ... (모든 scope 매핑)

// customer = 기본 권한만
{
  id: 'user-rolescope-cust-prod-r',
  role_id: 'user-role-customer-001',
  scope_id: 'user-scope-product-read'
}
```

**이유**: 역할별 기본 권한 설정

### 3.2 선택적 시드 데이터

- **users**: 초기 관리자 계정 (보안상 스크립트보다는 수동 생성 권장)

---

## 4. Membership Service

**Schema Path**: `apps/membership/drizzle/schema.ts`

### 4.1 필수 시드 데이터

#### tiers (멤버십 등급)
```typescript
// 1. 무료 등급
{
  id: 'membership-tier-free-001',
  code: 'FREE',
  priority_level: 0
}

// 2. 베이직 등급
{
  id: 'membership-tier-basic-001',
  code: 'BASIC',
  priority_level: 1
}

// 3. 프리미엄 등급
{
  id: 'membership-tier-premium-001',
  code: 'PREMIUM',
  priority_level: 2
}
```

**이유**: 멤버십 혜택 적용의 기준이 되는 등급 필요

#### plan (멤버십 요금제)
```typescript
{
  id: 'membership-plan-basic-001',
  tier_id: 'membership-tier-basic-001',
  price: 9900,
  duration_days: 30,
  currency: 'KRW',
  trial_days: 7,
  is_active: true
}
```

**이유**: 구독 계약의 기준이 되는 요금제 필요

#### cancellation_reasons (취소 사유)
```typescript
{
  code: 'NOT_USING',
  display_text: '사용하지 않음',
  category: 'USER_CHOICE',
  sort_order: 1,
  is_active: true
}
// ... 기타 사유
```

**이유**: 멤버십 취소 시 사유 선택을 위한 기본 옵션 필요

### 4.2 선택적 시드 데이터

- **subscription_policies**: 정책 규칙 (운영 중 설정 가능)

---

## 5. Wallet Service

**Schema Path**: `apps/wallet/src/shared/database/schema.ts`

### 5.1 필수 시드 데이터

**특이사항**: Wallet 서비스는 대부분 거래 기록이므로 필수 시드 없음

### 5.2 선택적 시드 데이터

- **payment_profiles**: 결제 수단 (사용자별 등록)
- **bnpl_accounts**: BNPL 계정 (사용자별 생성)

---

## 6. File Service

**Schema Path**: `apps/file-service/src/database/schema.ts`

### 6.1 필수 시드 데이터

#### file_contexts (파일 컨텍스트)
```typescript
// 1. 상품 이미지
{
  id: 'file-ctx-product-image',
  name: '상품 이미지',
  description: '상품 상세 이미지',
  allow_public: true,
  allow_private: false,
  allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'],
  max_file_size: 10485760, // 10MB
  path_prefix: 'products',
  is_active: true
}

// 2. 프로필 이미지
{
  id: 'file-ctx-profile-image',
  name: '프로필 이미지',
  description: '사용자 프로필 이미지',
  allow_public: true,
  allow_private: false,
  allowed_mime_types: ['image/jpeg', 'image/png'],
  max_file_size: 5242880, // 5MB
  path_prefix: 'profiles',
  is_active: true
}

// 3. 사업자등록증
{
  id: 'file-ctx-business-license',
  name: '사업자등록증',
  description: '사업자 등록 증빙 서류',
  allow_public: false,
  allow_private: true,
  allowed_mime_types: ['image/jpeg', 'image/png', 'application/pdf'],
  max_file_size: 10485760, // 10MB
  path_prefix: 'business',
  is_active: true
}

// 4. 배너 이미지
{
  id: 'file-ctx-banner-image',
  name: '배너 이미지',
  description: '홈페이지 배너 이미지',
  allow_public: true,
  allow_private: false,
  allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'],
  max_file_size: 10485760, // 10MB
  path_prefix: 'banners',
  is_active: true
}

// 5. 리뷰 이미지
{
  id: 'file-ctx-review-image',
  name: '리뷰 이미지',
  description: '상품 리뷰 첨부 이미지',
  allow_public: true,
  allow_private: false,
  allowed_mime_types: ['image/jpeg', 'image/png'],
  max_file_size: 5242880, // 5MB
  path_prefix: 'reviews',
  is_active: true
}
```

**이유**: 파일 업로드 시 컨텍스트별 검증 규칙 필요

---

## 7. Notification Service

**Schema Path**: `apps/notification/database/schemas/notification-schema.ts`

### 7.1 필수 시드 데이터

#### notification_providers (알림 제공자)
```typescript
// 1. NHN 카카오톡
{
  provider_id: 'notif-provider-nhn-kakao',
  channel: 'KAKAO',
  provider_name: 'NHN',
  config: { /* API 설정 */ },
  status: 'ACTIVE',
  is_active: true,
  priority: 1
}

// 2. NHN SMS
{
  provider_id: 'notif-provider-nhn-sms',
  channel: 'SMS',
  provider_name: 'NHN',
  config: { /* API 설정 */ },
  status: 'ACTIVE',
  is_active: true,
  priority: 1
}

// 3. SMTP Email
{
  provider_id: 'notif-provider-smtp-email',
  channel: 'EMAIL',
  provider_name: 'SMTP',
  config: { /* SMTP 설정 */ },
  status: 'ACTIVE',
  is_active: true,
  priority: 1
}

// 4. FCM Push
{
  provider_id: 'notif-provider-fcm-push',
  channel: 'PUSH',
  provider_name: 'FCM',
  config: { /* FCM 설정 */ },
  status: 'ACTIVE',
  is_active: true,
  priority: 1
}
```

**이유**: 알림 발송을 위한 제공자 설정 필요

#### templates (알림 템플릿)
```typescript
// 주문 확인 템플릿 (예시)
{
  template_id: 'notif-tmpl-order-confirmed',
  template_key: 'order.confirmed',
  name: '주문 확인',
  category: 'TRANSACTIONAL',
  contents: {
    EMAIL: {
      ko: {
        subject: '주문이 확인되었습니다',
        body: '주문번호: {{orderId}}'
      }
    },
    KAKAO: {
      ko: {
        body: '주문번호 {{orderId}}가 확인되었습니다.'
      }
    }
  },
  variables_schema: {
    orderId: { type: 'string', required: true }
  },
  version: 1,
  is_active: true
}
```

**이유**: 시스템 알림 발송을 위한 기본 템플릿 필요

#### notification_events (알림 이벤트)
```typescript
{
  event_id: 'notif-event-order-confirmed',
  event_key: 'order.confirmed',
  name: '주문 확인',
  description: '주문이 확인되었을 때 발송',
  template_key: 'order.confirmed',
  category: 'TRANSACTIONAL',
  default_channels: ['EMAIL', 'KAKAO'],
  priority: 'HIGH',
  is_active: true
}
```

**이유**: 이벤트 발생 시 어떤 템플릿을 사용할지 매핑 필요

### 7.2 선택적 시드 데이터

- **notification_campaigns**: 캠페인 (운영 중 생성)

---

## 8. Analytics Service

**Schema Path**: `apps/analytics/src/schema.ts`

### 8.1 필수 시드 데이터

**특이사항**: Analytics는 이벤트 수집 서비스이므로 필수 시드 없음

---

## 9. Channel Adapter Service

**Schema Path**: `apps/channel-adapter/src/schema.ts`

### 9.1 필수 시드 데이터

**특이사항**: Channel Adapter는 이벤트 처리 서비스이므로 필수 시드 없음

---

## 10. UGC Service

**Schema Path**: `apps/ugc-service/src/db/schema.ts`

### 10.1 필수 시드 데이터

**특이사항**: UGC는 사용자 생성 콘텐츠 서비스이므로 필수 시드 없음

---

## 시드 스크립트 구현 체크리스트

### Phase 1: 기본 구조
- [ ] 통합 시드 스크립트 프로젝트 생성 (`scripts/seed-data/`)
- [ ] 독립 `.env` 파일 설정 (각 서비스별 DB 연결 정보)
- [ ] Drizzle 클라이언트 설정

### Phase 2: 핵심 시드 구현
- [ ] WMS: warehouses, locations (시스템 로케이션), settings
- [ ] PIM: sales_channels, channel_categories, product_categories (루트)
- [ ] User Service: roles, scopes, role_scopes
- [ ] Membership: tiers, plan, cancellation_reasons
- [ ] File Service: file_contexts
- [ ] Notification: notification_providers, templates, notification_events

### Phase 3: 멱등성 검증
- [ ] UUID 존재 확인 로직
- [ ] 여러 번 실행 테스트
- [ ] 에러 핸들링 (부분 실패 시 롤백 전략)

### Phase 4: 운영 배포
- [ ] 개발 환경 테스트
- [ ] 스테이징 환경 테스트
- [ ] 프로덕션 배포 전 백업
- [ ] 프로덕션 시드 실행

---

## 다음 단계

이 분석 문서를 바탕으로:

1. **구체화**: 각 시드 데이터의 실제 값을 결정
2. **우선순위**: 필수 시드 vs 선택적 시드 분류
3. **구현**: TypeScript 시드 스크립트 작성
4. **테스트**: 로컬 환경에서 멱등성 검증

시드 스크립트를 구현할 준비가 되었다면, 어떤 서비스부터 시작할지 알려주세요!
