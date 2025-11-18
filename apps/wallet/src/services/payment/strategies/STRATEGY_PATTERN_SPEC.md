# 결제 전략 패턴 적용 명세서 (최종안)

## 📋 개요

**핵심 인사이트**: 결제 타입(ORDER vs MEMBERSHIP_FEE)이 아니라 **결제 수단 타입**(일회성 토큰 vs 저장된 프로필)으로 분리해야 함.

기존 추상화 구조를 유지하면서, `buildPayload` 메서드의 조건부 로직을 전략 패턴으로 분리합니다.

## 🎯 목표

1. **올바른 분류**: "일반결제 vs 정기결제"가 아닌 "일회성 토큰 vs 저장된 프로필"
2. **API 분리**: 각 결제 수단 타입별로 별도 엔드포인트 제공
3. **타입 안정성**: DTO로 필수 필드 컴파일 타임 보장
4. **조건부 로직 제거**: `if (profileId)`, `if (paymentKey)` 등 제거

## 🔍 문제점 분석

### 기존 설계의 문제

**잘못된 가정**:

- ❌ ORDER = 일회성 토큰만 사용
- ❌ MEMBERSHIP_FEE = 프로필만 사용

**실제 상황**:

- ✅ ORDER도 프로필 사용 가능 (저장된 카드로 일반결제)
- ✅ MEMBERSHIP_FEE도 프로필 사용 (당연히)
- ✅ 차이는 **결제 수단 타입**, 결제 타입이 아님

### 올바른 분류

| 구분               | 일회성 토큰 (Ephemeral)                     | 저장된 프로필 (Stored)          |
| ------------------ | ------------------------------------------- | ------------------------------- |
| **사용 시나리오**  | 토스 결제창 리다이렉트 후 `paymentKey` 받음 | 저장된 카드/계좌로 결제         |
| **필수 필드**      | `paymentKey`                                | `profileId`                     |
| **지원 결제 타입** | ORDER, MEMBERSHIP_FEE 모두 가능             | ORDER, MEMBERSHIP_FEE 모두 가능 |
| **Provider**       | TOSS (향후 확장 가능)                       | HMS_CARD, HMS_BNPL              |

## 🏗️ 아키텍처

### API 분리 설계

```
POST /payments/intents/:intentId/authorize/ephemeral
  - Body: { paymentKey: string, provider: 'TOSS', usePoints?: number }
  - 용도: 토스 결제창 리다이렉트 후 paymentKey로 승인

POST /payments/intents/:intentId/authorize/stored
  - Body: { profileId: string, provider: 'HMS_CARD' | 'HMS_BNPL', usePoints?: number }
  - 용도: 저장된 프로필로 결제 (일반결제/정기결제 모두)
```

### 내부 구조

```
PaymentService (Business Layer) - 변경 없음
    ↓
PaymentProviderManager (Implementation Layer) - buildPayload만 변경
    ↓
PaymentStrategyFactory.getStrategy() ← 결제 수단 타입 기반 선택
    ↓
PaymentStrategy.buildPayload() ← 전략별 구현
    ├── EphemeralPaymentStrategy (일회성 토큰)
    └── StoredProfilePaymentStrategy (저장된 프로필)
    ↓
Provider 호출
```

## 📁 파일 구조

```
services/payment/
├── payment.service.ts                    # 변경 없음
├── payment-provider.manager.ts           # buildPayload만 전략 사용
└── strategies/
    ├── payment-strategy.interface.ts     # 전략 인터페이스
    ├── payment-strategy.factory.ts       # 전략 팩토리
    ├── ephemeral-payment.strategy.ts     # 일회성 토큰 전략
    └── stored-profile-payment.strategy.ts # 저장된 프로필 전략

controllers/
└── payment.controller.ts                 # API 분리
    ├── authorizeEphemeralPayment()       # 새 엔드포인트
    └── authorizeStoredPayment()         # 새 엔드포인트
```

## 🔧 상세 설계

### 1. API 엔드포인트

#### 1.1 Ephemeral Payment (일회성 토큰)

```typescript
@Post('intents/:intentId/authorize/ephemeral')
async authorizeEphemeralPayment(
  @Param('intentId') intentId: string,
  @Body() dto: AuthorizeEphemeralPaymentDto,
) {
  // paymentKey 필수 (토스 리다이렉트에서 받음)
  // provider는 TOSS만 지원 (향후 확장 가능)
}
```

**DTO**:

```typescript
interface AuthorizeEphemeralPaymentDto {
  paymentKey: string; // 필수 - 토스 리다이렉트에서 받음
  provider: 'TOSS'; // 필수 - 현재는 TOSS만
  usePoints?: number; // 선택
}
```

#### 1.2 Stored Profile Payment (저장된 프로필)

```typescript
@Post('intents/:intentId/authorize/stored')
async authorizeStoredPayment(
  @Param('intentId') intentId: string,
  @Body() dto: AuthorizeStoredPaymentDto,
) {
  // profileId 필수
  // provider는 HMS_CARD, HMS_BNPL 지원
}
```

**DTO**:

```typescript
interface AuthorizeStoredPaymentDto {
  profileId: string; // 필수 - 저장된 프로필 ID
  provider: 'HMS_CARD' | 'HMS_BNPL'; // 필수
  usePoints?: number; // 선택
}
```

### 2. PaymentStrategy 인터페이스

```typescript
interface PaymentStrategy {
  /**
   * Payload 조립
   *
   * @param intent 결제 의도
   * @param providerType 결제 제공자
   * @param amount 결제 금액
   * @param options 전략별 옵션
   * @param tx 트랜잭션
   * @returns Provider별 Payload
   */
  buildPayload(
    intent: PaymentIntent,
    providerType: ProviderType,
    amount: number,
    options: PaymentStrategyOptions,
    tx: any,
  ): Promise<any>;
}
```

**옵션 타입**:

```typescript
// 일회성 토큰 옵션
interface EphemeralPaymentOptions {
  paymentKey: string; // 필수
}

// 저장된 프로필 옵션
interface StoredProfilePaymentOptions {
  profileId: string; // 필수
}

// Union 타입
type PaymentStrategyOptions =
  | EphemeralPaymentOptions
  | StoredProfilePaymentOptions;
```

### 3. EphemeralPaymentStrategy (일회성 토큰)

**책임**: 일회성 토큰(`paymentKey`) 기반 Payload 조립

**특징**:

- `paymentKey`를 Provider별 토큰 필드로 매핑
- 저장된 프로필 불필요
- TOSS Provider 지원 (향후 확장 가능)

**처리 로직**:

```typescript
buildPayload(intent, providerType, amount, options: EphemeralPaymentOptions) {
  if (providerType === 'TOSS') {
    return {
      amount,
      oneTimeToken: options.paymentKey, // paymentKey → oneTimeToken 매핑
      metadata: { intentId: intent.id }
    };
  }
  throw new Error(`Ephemeral payment not supported for provider: ${providerType}`);
}
```

**SOLID 준수**:

- ✅ Single Responsibility: 일회성 토큰 Payload 조립만 담당
- ✅ Open/Closed: 새로운 Provider 추가 시 확장 가능

### 4. StoredProfilePaymentStrategy (저장된 프로필)

**책임**: 저장된 프로필(`profileId`) 기반 Payload 조립

**특징**:

- `profileId` 필수 (타입 시스템 보장)
- `PaymentProfileService.resolvePayload()` 사용
- HMS_CARD, HMS_BNPL 지원

**처리 로직**:

```typescript
buildPayload(intent, providerType, amount, options: StoredProfilePaymentOptions) {
  // 타입 시스템이 profileId 필수를 보장
  return await this.profiles.resolvePayload(
    options.profileId, // 필수 필드
    providerType,
    amount,
    { tx }
  );
}
```

**SOLID 준수**:

- ✅ Single Responsibility: 프로필 기반 Payload 조립만 담당
- ✅ Dependency Inversion: PaymentProfileService에 의존

### 5. PaymentStrategyFactory

**책임**: 결제 수단 타입에 따라 적절한 전략 선택

**매핑 규칙**:

- `paymentKey` 존재 → `EphemeralPaymentStrategy`
- `profileId` 존재 → `StoredProfilePaymentStrategy`

**구현**:

```typescript
getStrategy(options: PaymentStrategyOptions): PaymentStrategy {
  if ('paymentKey' in options) {
    return this.ephemeralStrategy;
  }
  if ('profileId' in options) {
    return this.storedProfileStrategy;
  }
  throw new Error('Either paymentKey or profileId must be provided');
}
```

**SOLID 준수**:

- ✅ Open/Closed: 새로운 결제 수단 타입 추가 시 확장 가능
- ✅ Single Responsibility: 전략 선택만 담당

### 6. PaymentProviderManager 변경사항

**변경 전**:

```typescript
private async buildPayload(...) {
  // 조건부 로직 많음
  if (options.profileId) { ... }
  if (options.instrumentType === 'ONE_TIME') { ... }
  if (providerType === 'TOSS') { ... }
}
```

**변경 후**:

```typescript
private async buildPayload(...) {
  // 옵션 타입으로 전략 자동 선택
  const strategy = this.strategyFactory.getStrategy(options);
  return await strategy.buildPayload(intent, providerType, amount, options, tx);
}
```

## 🔄 통합 흐름

### 시나리오 1: 일반결제 - 일회성 토큰 (토스)

```
1. 사용자가 토스 결제창에서 결제
2. 토스 리다이렉트 → paymentKey 전달
3. POST /payments/intents/:intentId/authorize/ephemeral
   - Body: { paymentKey: "tgen_...", provider: "TOSS" }
4. PaymentService.authorizePaymentByIntent()
5. PaymentProviderManager.authorizeWithProvider()
6. PaymentStrategyFactory.getStrategy() → EphemeralPaymentStrategy
7. EphemeralPaymentStrategy.buildPayload()
   - paymentKey → oneTimeToken 매핑
8. TossChargeProvider.process()
```

### 시나리오 2: 일반결제 - 저장된 프로필 (저장된 카드)

```
1. 사용자가 저장된 카드 선택
2. POST /payments/intents/:intentId/authorize/stored
   - Body: { profileId: "profile_123", provider: "HMS_CARD" }
3. PaymentService.authorizePaymentByIntent()
4. PaymentProviderManager.authorizeWithProvider()
5. PaymentStrategyFactory.getStrategy() → StoredProfilePaymentStrategy
6. StoredProfilePaymentStrategy.buildPayload()
   - profileId로 프로필 조회
   - PaymentProfileService.resolvePayload() 사용
7. HmsCardChargeProvider.process()
```

### 시나리오 3: 정기결제 - 저장된 프로필

```
1. 스케줄러가 정기결제 실행
2. POST /payments/intents/:intentId/authorize/stored
   - Body: { profileId: "profile_456", provider: "HMS_CARD" }
3. (시나리오 2와 동일한 플로우)
```

## 📝 변경사항 요약

### 변경되는 파일

1. **PaymentController**
   - `authorizePayment()` → 제거 또는 레거시 호환용으로 유지
   - `authorizeEphemeralPayment()` → 새 엔드포인트 추가
   - `authorizeStoredPayment()` → 새 엔드포인트 추가

2. **PaymentController Zod Schema**
   - `AuthorizeEphemeralPaymentSchema` → 새 스키마
   - `AuthorizeStoredPaymentSchema` → 새 스키마

3. **PaymentProviderManager**
   - `buildPayload()` 메서드만 수정
   - 전략 팩토리 주입
   - 조건부 로직 제거

4. **새로 생성되는 파일**
   - `strategies/payment-strategy.interface.ts`
   - `strategies/payment-strategy.factory.ts`
   - `strategies/ephemeral-payment.strategy.ts`
   - `strategies/stored-profile-payment.strategy.ts`

### 변경되지 않는 파일

- `PaymentService` - 완전히 동일
- `PaymentReader`, `PaymentManager`, `PaymentPointManager` - 모두 동일
- Provider 클래스들 - 모두 동일

## ✅ 장점

1. **명확한 API**: 각 결제 수단 타입별로 별도 엔드포인트
2. **타입 안정성**: DTO로 필수 필드 컴파일 타임 보장
3. **조건부 로직 제거**: `buildPayload`의 복잡한 if문 제거
4. **확장성**: 새로운 결제 수단 타입 추가 시 전략만 추가
5. **테스트 용이성**: 각 전략을 독립적으로 테스트 가능
6. **올바른 분류**: 결제 타입이 아닌 결제 수단 타입으로 분리

## ⚠️ 주의사항

1. **의존성 주입**: PaymentProviderManager에 PaymentStrategyFactory 주입 필요
2. **레거시 호환성**: 기존 `authorizePayment()` 엔드포인트는 유지하되 deprecated 처리
3. **에러 처리**: 전략별 에러 메시지 일관성 유지
4. **마이그레이션**: 기존 클라이언트는 점진적으로 새 API로 전환

## 🔍 SOLID 원칙 검토

### ✅ Single Responsibility Principle (SRP)

**각 전략 클래스**:

- `EphemeralPaymentStrategy`: 일회성 토큰 Payload 조립만 담당 ✅
- `StoredProfilePaymentStrategy`: 저장된 프로필 Payload 조립만 담당 ✅
- `PaymentStrategyFactory`: 전략 선택만 담당 ✅

### ✅ Open/Closed Principle (OCP)

**확장성**:

- 새로운 결제 수단 타입 추가: 전략만 추가 (기존 코드 수정 불필요) ✅
- 새로운 Provider 추가: 각 전략 내부에서 처리 ✅

### ✅ Liskov Substitution Principle (LSP)

**전략 교체 가능성**:

- 모든 전략이 `PaymentStrategy` 인터페이스를 동일하게 구현 ✅
- `PaymentProviderManager`는 구체 전략을 모름 ✅

### ✅ Interface Segregation Principle (ISP)

**현재 인터페이스**:

- 단일 메서드만 정의하므로 적절함 ✅
- 향후 확장 시 분리 고려

### ✅ Dependency Inversion Principle (DIP)

**의존성 방향**:

- `PaymentProviderManager` → `PaymentStrategy` (인터페이스) ✅
- `StoredProfilePaymentStrategy` → `PaymentProfileService` (서비스) ✅

## 📋 최종 검토 포인트

1. ✅ **API 분리**: 결제 수단 타입별로 별도 엔드포인트 제공
2. ✅ **올바른 분류**: 결제 타입이 아닌 결제 수단 타입으로 분리
3. ✅ **타입 안정성**: DTO로 필수 필드 컴파일 타임 보장
4. ✅ **확장성**: 새로운 결제 수단 타입/Provider 추가 시 확장 용이
5. ✅ **SOLID 준수**: 모든 원칙 준수
6. ✅ **용어 통일**: `paymentKey`로 통합 (토스 표준 용어)

## 🔄 마이그레이션 전략

### 단계 1: 새 API 추가 (기존 API 유지)

- `authorizeEphemeralPayment()` 추가
- `authorizeStoredPayment()` 추가
- 기존 `authorizePayment()`는 레거시로 유지

### 단계 2: 클라이언트 전환

- 프론트엔드: 새 API로 전환
- 다른 서비스: 새 API로 전환

### 단계 3: 레거시 API 제거

- 기존 `authorizePayment()` 제거
- 문서 업데이트
