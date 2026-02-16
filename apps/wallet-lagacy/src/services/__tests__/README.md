# 효성 CMS 실제 테스트 서버 통합 테스트

## 📋 개요

이 디렉토리는 **Mock을 절대 사용하지 않고** 실제 효성 CMS 테스트 서버와 **실제 데이터베이스**를 사용하는 진짜 통합 테스트를 포함합니다.

🔥 **Mock은 쓰레기입니다!** 실제 DB에 저장되지 않으면 의미 없는 테스트입니다.

## 🎯 테스트 철학

### 1. 단일 책임 출처 (Single Source of Truth)

- 서비스 코드에서 사용하는 실제 타입들만 import
- Mock 타입이나 Faker.js 생성 타입 사용 금지
- 실제 인터페이스와 DTO만 사용

### 2. 실제 환경 연동

- 효성 CMS 테스트 서버와 직접 통신
- **실제 PostgreSQL 데이터베이스 사용**
- Mock 완전 금지 🚫
- 실제 비즈니스 플로우 검증

### 3. 핵심 플로우 집중

- 결제 프로필 등록 → 상품 구매 → 환불 전체 플로우
- BNPL 제외, 신용카드 결제만 집중
- 실제 사용자 시나리오 기반

## 🧪 테스트 파일 구조

```
__tests__/
├── payment-hms-card-real.integration.spec.ts    # 실제 HMS API 통합 테스트
├── payment-profile-flow.integration.spec.ts     # 프로필 등록 → 구매 플로우
├── test-module.factory.ts                       # 테스트 모듈 팩토리 (의존성 실수 방지)
└── README.md                                     # 이 문서
```

## 🚀 실행 방법

### 환경변수 설정

```bash
export SW_KEY="your_hms_sw_key"
export CUST_KEY="your_hms_cust_key"
export NODE_ENV="test"
```

### 개별 테스트 실행

```bash
# HMS 카드 통합 테스트
npm test -- payment-hms-card-real

# 결제 프로필 플로우 테스트
npm test -- payment-profile-flow

# 모든 실제 테스트 실행
npm test -- --testPathPattern="real|flow"
```

### 전체 테스트 실행

```bash
SW_KEY=your_key CUST_KEY=your_key npm test
```

## 📊 테스트 시나리오

### 1. HMS 카드 통합 테스트 (`payment-hms-card-real.integration.spec.ts`)

#### 🏗️ 환경 설정 및 초기화

- 필수 환경변수 검증
- HMS Provider 테스트 서버 모드 초기화
- 실제 API 클라이언트 설정 확인

#### 💳 실제 결제 프로필 등록 플로우

- 효성 CMS에 실제 카드 프로필 등록
- 등록된 프로필로 실제 결제 진행
- API 응답 구조 검증

#### 💰 실제 환불 플로우

- 효성 CMS 환불 API 호출
- 환불 결과 검증
- 에러 처리 검증

#### 🛡️ 실제 정책 검증

- ORDER 결제 타입에 HMS_CARD 허용 확인
- BNPL_CAPTURE 타입에 HMS_CARD 정책 위반 확인
- 프로필 없는 결제 시 에러 발생 확인

#### 📊 실제 API 응답 구조 검증

- PaymentResult 인터페이스 준수 확인
- HMS API 응답 메타데이터 구조 확인
- 에러 응답 구조 검증

### 2. 결제 프로필 플로우 테스트 (`payment-profile-flow.integration.spec.ts`)

#### 🏪 상품 구매 시나리오

1. **1단계**: 신용카드 프로필 등록

   - 실제 효성 CMS에 카드 정보 등록
   - 프로필 ID 생성 확인
   - 등록 상태 검증

2. **2단계**: 등록된 카드로 상품 구매

   - 실제 결제 API 호출
   - 결제 성공/실패 처리
   - 트랜잭션 ID 생성 확인

3. **3단계**: 프로필 없는 결제 시도
   - HMS 카드 프로필 필수 정책 검증
   - 적절한 에러 메시지 확인

#### 🛡️ 결제 정책 검증

- ORDER 결제에 HMS_CARD 허용
- BNPL_CAPTURE에 HMS_CARD 정책 위반
- 정책 테이블 일치성 확인

#### 📊 서비스 통합성 검증

- 모든 필수 서비스 의존성 주입 확인
- Provider 목록과 정책 일치성 확인

## 🔧 테스트 데이터

### 효성 CMS 테스트 카드

```typescript
// 성공 테스트 카드
const SUCCESS_CARD = {
  paymentNumber: '1111222233334444',
  validUntil: '1225',
  password: '12',
  payerName: '홍길동',
  payerNumber: '900101',
};

// 실패 테스트 카드
const FAILURE_CARD = {
  paymentNumber: '9999888877776666',
  validUntil: '1225',
  password: '99',
  payerName: '실패테스트',
  payerNumber: '900101',
};
```

### 상품 구매 시나리오

```typescript
const PURCHASE_SCENARIOS = {
  smallPurchase: { amount: 5000, productName: '기본 상품' },
  normalPurchase: { amount: 25000, productName: '프리미엄 상품' },
  largePurchase: { amount: 100000, productName: 'VIP 상품' },
};
```

## ⚠️ 주의사항

### 1. 환경변수 필수

- `SW_KEY`, `CUST_KEY` 없이는 테스트 스킵
- 실제 효성 CMS 테스트 서버 계정 필요

### 2. 테스트 서버 사용

- `NODE_ENV=test`로 테스트 서버 강제 사용
- 운영 서버 호출 방지

### 3. 실제 API 호출

- 네트워크 의존성 있음
- 테스트 서버 상태에 따라 결과 변동 가능
- 타임아웃 설정 (60초)

### 4. 에러 처리

- 실제 API 오류도 테스트 범위에 포함
- 예상되는 실패 시나리오도 검증
- 적절한 에러 메시지 확인

## 🎯 테스트 목표

1. **실제 통합 검증**: Mock 없이 실제 시스템 간 통합 확인
2. **타입 안전성**: 서비스 코드의 실제 타입 사용으로 타입 안전성 보장
3. **비즈니스 플로우**: 실제 사용자 시나리오 기반 전체 플로우 검증
4. **정책 준수**: 결제 정책과 비즈니스 규칙 준수 확인
5. **에러 처리**: 실제 환경에서 발생할 수 있는 오류 상황 대응 확인

## 📈 성공 기준

- ✅ 환경변수 있을 때: 실제 API 호출 및 응답 검증
- ✅ 환경변수 없을 때: 테스트 스킵 및 안내 메시지
- ✅ API 성공 시: 정상 응답 구조 및 데이터 검증
- ✅ API 실패 시: 적절한 에러 처리 및 메시지 검증
- ✅ 정책 위반 시: 예상된 에러 발생 및 메시지 확인

## 🛡️ 의존성 실수 방지 전략

### 문제 상황

```
Nest can't resolve dependencies of the PaymentProviderFactory (HmsCardProvider, ?, TossProvider).
Please make sure that the argument HmsBnplProvider at index [1] is available...
```

### 해결책: 테스트 모듈 팩토리 패턴

#### 1. **단일 출처 원칙 (Single Source of Truth)**

```typescript
// ❌ 잘못된 방법: 각 테스트마다 다른 의존성 설정
beforeEach(async () => {
  module = await Test.createTestingModule({
    providers: [
      PaymentService,
      PaymentProviderFactory,
      HmsCardProvider, // HmsBnplProvider, TossProvider 누락!
    ],
  }).compile();
});

// ✅ 올바른 방법: 팩토리 사용
beforeEach(async () => {
  module = await PaymentTestModuleFactory.createForHmsCard();
});
```

#### 2. **완전성 검증 (Completeness Validation)**

```typescript
// 의존성 자동 검증
beforeEach(async () => {
  module = await PaymentTestModuleFactory.createForHmsCard();

  // 모든 의존성이 올바르게 주입되었는지 자동 검증
  DependencyValidator.validateCompleteModule(module);
});
```

#### 3. **재사용성 (Reusability)**

```typescript
// 다양한 테스트 시나리오별 전용 팩토리
PaymentTestModuleFactory.create(); // 기본 설정
PaymentTestModuleFactory.createForHmsCard(); // HMS 카드 전용
PaymentTestModuleFactory.createForE2E(); // E2E 테스트 전용
```

### NestJS 의존성 주입 원칙

1. **부모 의존성 = 자식 의존성의 합집합**

   - `PaymentProviderFactory`가 `HmsCardProvider`, `HmsBnplProvider`, `TossProvider` 필요
   - 테스트 모듈에서 3개 모두 제공해야 함

2. **의존성 그래프 완전성**

   - 누락된 의존성 하나가 전체 모듈 생성 실패
   - 컴파일 타임이 아닌 런타임에 발견되는 문제

3. **테스트 격리성**
   - 각 테스트는 독립적인 모듈 인스턴스 사용
   - 의존성 설정 일관성 필수

### 테스트 코드 전문가의 3가지 원칙

1. **예측 가능성**: 의존성 실수가 발생할 수 없는 구조
2. **자동 검증**: 런타임에 의존성 완전성 자동 확인
3. **유지보수성**: 실제 앱 모듈과 동일한 의존성 구조

## 🚨 **논리적 일관성 원칙**

### ❌ **잘못된 테스트 패턴**

```typescript
// 이런 테스트는 완전히 잘못됨!
it('프로필 등록 실패', async () => {
  // 프로필 등록 실패
  expect(error.message).toContain('returning is not a function');
});

it('등록된 프로필로 결제 성공', async () => {
  // 프로필이 실패했는데 결제가 성공? 말이 안됨!
  expect(result.success).toBe(true); // ❌ 논리적 모순
});
```

### ✅ **올바른 테스트 패턴**

```typescript
it('프로필 등록 및 결제 플로우', async () => {
  try {
    // 1. 프로필 등록 시도
    const profile = await profileService.createProfile(request);

    // 2. 성공 시에만 결제 진행
    await testPaymentWithProfile(profile.profileId);
  } catch (error) {
    // 3. 실패 시 결제도 실패해야 함을 검증
    await testPaymentShouldFailWithoutProfile();
  }
});
```

### 핵심 원칙

1. **인과관계 준수**: 프로필 등록 실패 → 결제 실패
2. **상태 격리**: 테스트 간 상태 공유 금지
3. **실제 에러 시뮬레이션**: Mock이 실제 상황을 정확히 반영

이 전략을 통해 의존성 관련 테스트 실패를 원천 차단하고, **논리적으로 일관된** 테스트 환경을 보장합니다.
