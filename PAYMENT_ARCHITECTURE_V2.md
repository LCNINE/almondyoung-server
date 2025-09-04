# 🏗️ 결제 서비스 아키텍처 V2.0

## 📋 개요

기존 `PaymentUnifiedService`에 혼재되어 있던 **결제 실행**과 **결제수단 라이프사이클 관리** 로직을 완전히 분리하여 SOLID 원칙을 준수하는 확장 가능한 아키텍처로 리팩토링했습니다.

## 🎯 해결한 문제점

### Before (문제점)

```
PaymentUnifiedService (단일 서비스에 모든 책임)
├── processPayment()           # 결제 실행
├── refundPayment()            # 환불 실행
├── registerPaymentMethod()    # 회원 등록
├── submitBnplConsent()        # BNPL 출금동의서
├── getBnplMemberStatus()      # BNPL 상태 조회
└── captureBnplPayments()      # BNPL 배치 처리
```

### After (개선 후)

```
PaymentOrchestrationService    # 순수 결제 오케스트레이션
├── processPayment()           # 결제 실행만
└── refundPayment()            # 환불 실행만

BnplMethodService             # BNPL 전용 라이프사이클
├── registerMember()          # BNPL 회원 등록
├── submitConsent()           # 출금동의서 제출
├── getMemberStatus()         # 상태 조회
└── batchCapture()            # 배치 확정

CardMethodService             # 카드 전용 라이프사이클
├── registerRecurringMember() # HMS 회원 등록
└── validateHmsMember()       # HMS Member ID 검증

PointMethodService            # 적립포인트 관리
├── awardPoints()             # 포인트 적립/지급
├── getPointBalance()         # 잔액 조회
└── getTransactionHistory()   # 사용 내역
```

## 🏛️ 아키텍처 구조

### Layer 1: Controller

```typescript
// 결제 실행 전담
PaymentController → PaymentOrchestrationService

// 결제수단별 라이프사이클 관리
BnplController → BnplMethodService
PaymentMethodController → CardMethodService, PointMethodService
```

### Layer 2: Service

#### 🎼 PaymentOrchestrationService

```typescript
@Injectable()
export class PaymentOrchestrationService {
  // ✅ 순수 결제 오케스트레이션만 담당
  async processPayment(gatewayType, amount, metadata); // 결제 실행
  async refundPayment(gatewayType, transactionId, amount); // 환불 실행
  async processPaymentByMethodType(methodType, amount, metadata); // 편의 메서드
}
```

#### 🏦 BnplMethodService

```typescript
@Injectable()
export class BnplMethodService {
  // ✅ BNPL 전용 라이프사이클 관리
  async registerMember(request); // HMS 회원 등록
  async submitConsent(memberId, file); // 출금동의서 제출
  async getMemberStatus(memberId); // 회원 상태 조회
  async batchCapture(authorizationIds); // 배치 확정 처리
  async activateAccount(paymentMethodId, approvedLimit); // 계정 활성화
  async deactivateAccount(paymentMethodId, reason); // 계정 비활성화
}
```

#### 💳 CardMethodService

```typescript
@Injectable()
export class CardMethodService {
  // ✅ HMS CMS 카드 라이프사이클 관리
  async registerRecurringMember(request); // HMS 정기결제 회원 등록
  async validateHmsMember(hmsMemberId); // HMS Member ID 검증
}
```

#### 🪙 PointMethodService

```typescript
@Injectable()
export class PointMethodService {
  // ✅ 적립포인트 관리 (소비자 직접 충전 불가능)
  async awardPoints(userId, amount, sourceType); // 포인트 적립/지급 (시스템/관리자만)
  async getPointBalance(userId); // 잔액 조회
  async getTransactionHistory(userId); // 사용 내역 조회
  async ensurePointAccount(userId); // 계정 자동 생성
}
```

### Layer 3: Gateway & Adapter

#### 🔌 인터페이스 계층화

```typescript
// 기본 결제 실행 인터페이스
interface PaymentGateway {
  processPayment(amount, currency, metadata): Promise<PaymentResult>;
  refundPayment(transactionId, amount, reason?): Promise<RefundResult>;
  capturePayment?(authorizationIds, batchId?): Promise<CaptureResult>; // BNPL용
  registerPaymentMethod?(request): Promise<PaymentMethodRegistrationResult>; // 정기결제용
}

// 결제수단별 확장 인터페이스
interface BnplMethodGateway {
  registerMember(request): Promise<PaymentMethodRegistrationResult>;
  submitConsent(request): Promise<ConsentResult>;
  getMemberStatus(memberId): Promise<MemberStatusResult>;
  batchCapture(authorizationIds, batchId?): Promise<CaptureResult>;
}

interface CardMethodGateway {
  registerRecurringMember(request): Promise<PaymentMethodRegistrationResult>;
  validateHmsMember(hmsMemberId): Promise<ValidationResult>;
}

interface PointMethodGateway {
  awardPoints(userId, amount, sourceType): Promise<AwardResult>;
  getPointBalance(userId): Promise<BalanceResult>;
}
```

#### 🔧 어댑터 구현

```typescript
// 각 어댑터가 기본 + 확장 인터페이스 모두 구현
@Injectable()
export class HmsBnplPaymentAdapter
  implements PaymentGateway, BnplMethodGateway {
  // PaymentGateway: processPayment, refundPayment, capturePayment
  // BnplMethodGateway: registerMember, submitConsent, getMemberStatus, batchCapture
}

@Injectable()
export class HmsCardPaymentAdapter
  implements PaymentGateway, CardMethodGateway {
  // PaymentGateway: processPayment, refundPayment, registerPaymentMethod
  // CardMethodGateway: registerRecurringMember, validateHmsMember
}

@Injectable()
export class InternalPointPaymentAdapter
  implements PaymentGateway, PointMethodGateway {
  // PaymentGateway: processPayment, refundPayment
  // PointMethodGateway: awardPoints, getPointBalance
}

@Injectable()
export class TossPaymentAdapter implements PaymentGateway {
  // PaymentGateway: processPayment, refundPayment (즉시결제만)
}
```

## 🔄 결제 플로우

### 1️⃣ BNPL 회원 등록 플로우

```
POST /bnpl/register
    ↓
BnplController.registerMember()
    ↓
BnplMethodService.registerMember()
    ├─ DB: paymentMethod 테이블 삽입 (status: PENDING)
    ├─ DB: bnplAccount 테이블 삽입
    └─ HmsBnplAdapter.registerMember() → HMS API 호출
```

### 2️⃣ BNPL 출금동의서 제출 플로우

```
POST /bnpl/consent (multipart/form-data)
    ↓
BnplController.submitConsent()
    ↓
BnplMethodService.submitConsent()
    ↓
HmsBnplAdapter.submitConsent() → HMS API 파일 업로드
```

### 3️⃣ 결제 실행 플로우

```
POST /v2/payments/process
    ↓
PaymentController.processPayment()
    ↓
PaymentOrchestrationService.processPaymentByMethodType()
    ↓
PaymentGatewayFactory.getGatewayByMethodType()
    ↓
XxxAdapter.processPayment() → 외부 PG/HMS API 호출
    ↓
DB: paymentEvents, paymentSession 업데이트
```

### 4️⃣ 포인트 적립 플로우 (구매 완료 시)

```
시스템 내부 호출
    ↓
PointMethodService.awardPoints(userId, amount, 'PURCHASE_REWARD')
    ├─ DB: pointTransactions 삽입 (type: EARN)
    └─ DB: points.balance 증가
```

## 🚀 확장성

### 새로운 결제수단 추가 시

1. **어댑터 생성**: `NewPaymentAdapter implements PaymentGateway, NewMethodGateway`
2. **확장 인터페이스 정의**: `NewMethodGateway` (필요시)
3. **전용 서비스 생성**: `NewMethodService` (라이프사이클 관리용)
4. **팩토리 등록**: `PaymentGatewayFactory`에 케이스 추가
5. **컨트롤러 라우팅**: 새 엔드포인트 추가

### 기존 코드 수정 불필요

- ✅ `PaymentOrchestrationService`: 수정 없음
- ✅ 다른 어댑터들: 수정 없음
- ✅ 기존 컨트롤러들: 수정 없음

## 📊 결제수단별 특성

| 결제수단           | 등록 과정                        | 결제 방식                | 특수 기능            |
| ------------------ | -------------------------------- | ------------------------ | -------------------- |
| **BNPL**           | HMS 회원등록 → 출금동의서 → 심사 | 승인 → 배치확정          | 한도관리, 배치처리   |
| **카드 (HMS CMS)** | HMS 회원등록 (카드정보)          | HMS Member ID로 즉시결제 | Member ID 검증       |
| **카드 (토스)**    | 등록 불필요                      | UI 리다이렉트 즉시결제   | -                    |
| **적립포인트**     | 자동 생성 (가입시)               | 잔액 차감                | 구매적립, 이벤트지급 |

## 🔐 보안 및 안정성

### 멱등성 (Idempotency)

- 모든 결제/등록 요청에 멱등성 키 지원
- `IdempotencyService`로 중복 요청 방지

### 트랜잭션 무결성

- 모든 DB 작업을 트랜잭션으로 보장
- 실패 시 자동 롤백

### 에러 처리 계층화

- **Service**: 도메인 에러만 발생 (`throw new Error()`)
- **Controller**: HTTP 상태 코드로 변환 (`HttpException`)

## 🧪 테스트 전략

### 단위 테스트

```typescript
// Service 레이어 - 순수 비즈니스 로직만 테스트
describe('PaymentOrchestrationService', () => {
  // Mock PaymentGateway로 테스트
});

describe('BnplMethodService', () => {
  // Mock BnplMethodGateway로 테스트
});
```

### 통합 테스트

```typescript
// Adapter 레이어 - 외부 API 통신 테스트
describe('HmsBnplPaymentAdapter', () => {
  // Mock HMS API로 테스트
});
```

### E2E 테스트

```typescript
// Controller 레이어 - HTTP 응답 변환 테스트
describe('BnplController', () => {
  // 실제 서비스 인스턴스로 테스트
});
```

## 📁 최종 디렉토리 구조

```
apps/wallet/src/
├── controllers/                    # HTTP 엔드포인트
│   ├── payment.controller.ts       # 결제 실행
│   ├── payment-method.controller.ts # 결제수단 관리
│   ├── bnpl.controller.ts          # BNPL 라이프사이클
│   ├── refund.controller.ts        # 환불 처리
│   └── settlement.controller.ts    # 정산 관리
│
├── services/                       # 비즈니스 로직
│   ├── payment-orchestration.service.ts  # 결제 오케스트레이션
│   ├── payment-gateway.factory.ts        # 게이트웨이 팩토리
│   ├── idempotency.service.ts             # 멱등성 관리
│   ├── settlement.service.ts              # 정산 서비스
│   └── method-services/                   # 결제수단별 전용 서비스
│       ├── bnpl-method.service.ts         # BNPL 라이프사이클
│       ├── card-method.service.ts         # 카드 라이프사이클
│       └── point-method.service.ts        # 포인트 관리
│
├── adapters/                       # 외부 시스템 통신
│   ├── hms-bnpl-payment.adapter.ts        # HMS BNPL API
│   ├── hms-card-payment.adapter.ts        # HMS 카드 CMS API
│   ├── toss-payment.adapter.ts            # 토스페이먼츠 API
│   └── internal-point-payment.adapter.ts  # 내부 포인트 시스템
│
├── interfaces/                     # 타입 정의
│   ├── payment-gateway.interface.ts       # 기본 결제 인터페이스
│   └── payment-method-gateways.interface.ts # 확장 인터페이스
│
└── shared/                         # 공통 모듈
    ├── database/schema.ts          # DB 스키마
    ├── dtos/                       # 데이터 전송 객체
    ├── errors/                     # 커스텀 에러
    ├── tokens/                     # DI 토큰
    └── utils/                      # 유틸리티
```

## 🎯 SOLID 원칙 준수

### ✅ Single Responsibility Principle (SRP)

- **PaymentOrchestrationService**: 결제 실행 오케스트레이션만
- **BnplMethodService**: BNPL 라이프사이클 관리만
- **CardMethodService**: 카드 라이프사이클 관리만
- **PointMethodService**: 포인트 관리만

### ✅ Open/Closed Principle (OCP)

- 새로운 결제수단 추가 시 기존 코드 수정 불필요
- 어댑터 + MethodService + 인터페이스만 추가
- `PaymentGatewayFactory`에 케이스만 추가

### ✅ Liskov Substitution Principle (LSP)

- 모든 어댑터가 `PaymentGateway` 인터페이스 올바르게 구현
- 확장 인터페이스도 기본 인터페이스와 호환

### ✅ Interface Segregation Principle (ISP)

- **기본 인터페이스**: `PaymentGateway` (결제 실행 기능)
- **확장 인터페이스**: `XxxMethodGateway` (결제수단별 특수 기능)
- 클라이언트가 불필요한 메서드에 의존하지 않음

### ✅ Dependency Inversion Principle (DIP)

- 서비스가 구체 클래스가 아닌 인터페이스에 의존
- DI Container로 의존성 주입
- 어댑터 교체 가능한 구조

## 🔄 결제수단별 상세 플로우

### BNPL (HMS 후불결제)

1. **등록**: `BnplMethodService.registerMember()` → HMS 회원 등록
2. **동의서**: `BnplMethodService.submitConsent()` → HMS 파일 업로드
3. **결제**: `PaymentOrchestrationService.processPayment()` → 내부 한도 차감 (승인)
4. **확정**: `BnplMethodService.batchCapture()` → HMS 실제 출금 (배치)

### 카드 (HMS CMS)

1. **등록**: `CardMethodService.registerRecurringMember()` → HMS 회원 등록
2. **결제**: `PaymentOrchestrationService.processPayment()` → HMS Member ID로 즉시결제

### 카드 (토스페이먼츠)

1. **등록**: 불필요 (UI 리다이렉트)
2. **결제**: `PaymentOrchestrationService.processPayment()` → 토스 UI 리다이렉트

### 적립포인트

1. **등록**: 자동 생성 (회원가입 시)
2. **적립**: `PointMethodService.awardPoints()` → 구매완료 시 시스템 호출
3. **결제**: `PaymentOrchestrationService.processPayment()` → 잔액 차감

## 🚀 확장 가능한 설계

### 새로운 PG사 추가 (예: 네이버페이)

```typescript
// 1. 어댑터 생성
@Injectable()
export class NaverPaymentAdapter implements PaymentGateway {
  async processPayment() {
    /* 네이버페이 API */
  }
  async refundPayment() {
    /* 네이버페이 환불 API */
  }
}

// 2. 팩토리에 등록
// PaymentGatewayFactory.getGateway()에 'naver' 케이스 추가

// 3. 토큰 등록
// app.module.ts에 DI 설정 추가
```

### 새로운 결제수단 추가 (예: 계좌이체)

```typescript
// 1. 확장 인터페이스 정의
export interface BankTransferMethodGateway {
  registerBankAccount(request): Promise<BankAccountResult>;
  validateAccount(accountNumber): Promise<ValidationResult>;
}

// 2. 전용 서비스 생성
@Injectable()
export class BankTransferMethodService {
  async registerBankAccount() {
    /* 계좌 등록 */
  }
  async validateAccount() {
    /* 계좌 검증 */
  }
}

// 3. 어댑터 구현
@Injectable()
export class BankTransferAdapter
  implements PaymentGateway, BankTransferMethodGateway {
  // 기본 + 확장 인터페이스 구현
}
```

## 📈 성능 최적화

### 배치 처리

- BNPL: 스케줄러가 주기적으로 `batchCapture()` 호출
- 포인트: 구매 완료 시 비동기로 `awardPoints()` 호출

### 캐싱 전략

- 포인트 잔액: Redis 캐싱 가능
- HMS Member 정보: 단기 캐싱 가능

### 모니터링

- 각 서비스별 독립적인 로깅
- 결제수단별 성공률 추적 가능

---

## 🎉 리팩토링 결과

✅ **확장성**: 새로운 결제수단 추가 시 기존 코드 수정 불필요  
✅ **유지보수성**: 각 레이어의 책임이 명확히 분리  
✅ **테스트 용이성**: 레이어별 독립적인 단위 테스트 가능  
✅ **SOLID 원칙**: 모든 SOLID 원칙 준수  
✅ **타입 안전성**: TypeScript 인터페이스로 컴파일 타임 검증

이제 새로운 결제수단이나 PG사를 추가해도 명확한 패턴을 따라 안전하게 확장할 수 있습니다! 🚀
