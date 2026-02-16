# Wallet Rebuild - Provider Capabilities (Draft)

## 1. Purpose

이 문서는 Wallet의 결제수단 Provider 설계를 정의한다.
목표는 결제수단이 늘어나도 코어 오케스트레이션 코드를 안정적으로 유지하는 것이다.

## 2. Scope

- v1 실구현 우선순위: `POINTS` Provider
- 확장 대상(로드맵): `TOSS`, `BANK_TRANSFER`(무통장입금)
- 본 문서는 `01~05`를 전제로 하며, 상태머신/데이터모델/메시지 계약을 침범하지 않는다.
- `payable_amount == 0`인 경우는 Provider Leg를 만들지 않고 Intent fast path로 처리한다.

## 3. Capability Pattern Definition

Capability 패턴은 "Provider 타입 분기"가 아니라 "지원 기능 여부"로 실행 경로를 결정하는 방식이다.

- 안티패턴:
  - `if providerType === "TOSS" ... else if providerType === "POINTS" ...`
- 권장패턴:
  - `supports("CAPTURE")`, `supports("MANUAL_CONFIRM")`로 분기

### 3.1 Benefits

- 결제수단 추가 시 코어 서비스 변경 최소화
- 수동형/자동형/외부PG형 결제수단을 단일 오케스트레이션에 수용 가능
- 기능 롤아웃(예: 부분환불 지원) 단위 제어 용이

### 3.2 Trade-offs

- capability 선언과 실제 구현이 불일치하면 런타임 오류 가능
- capability 조합이 늘수록 테스트 조합이 증가

## 4. Architectural Boundary

## 4.1 Wallet Orchestrator Responsibility

- Intent/Leg/Attempt 상태 전이 관리
- 트랜잭션/락/멱등성/outbox 처리
- 보상 트랜잭션 및 수동 취소 큐 이관 판단
- Provider 호출 전후 도메인 검증

## 4.2 Provider Responsibility

- 외부 시스템/원장 시스템 연동
- Provider 고유 요청/응답 스키마 처리
- Provider 결과를 Wallet 표준 결과로 정규화

## 4.3 Provider Non-Responsibility

- Wallet DB의 Intent/Leg 상태 직접 업데이트 금지
- outbox 이벤트 직접 발행 금지

## 5. Capability Model

## 5.1 Capability Set (v1)

- `AUTHORIZE`
- `CAPTURE`
- `CANCEL`
- `REFUND`
- `PARTIAL_REFUND`
- `MANUAL_CONFIRM`
- `CUSTOMER_ACTION`
- `WEBHOOK`
- `POLL_STATUS`
- `AUTO_COMPENSATE`

## 5.2 Static vs Runtime Capability

- Static Capability:
  - Provider 등록 시 고정된 지원 기능
  - 예: `BANK_TRANSFER`는 `MANUAL_CONFIRM` 필수
- Runtime Capability:
  - 거래 컨텍스트에 따라 달라지는 기능
  - 예: 동일 Provider라도 외부 PG 거래 상태(만료/이미확정 등)에 따라 실제 수행 가능 여부가 달라질 수 있음

## 6. Provider Contract (Recommended)

v1 권장안은 "필수 최소 인터페이스 + 선택 capability" 하이브리드다.

v1 결정:

- Provider public 계약은 `authorize/capture/cancel/refund/manualConfirm` 개별 메서드로 분리한다.
- 위 메서드는 optional로 두지 않는다(모든 Provider가 동일 시그니처 제공).
- 실제 지원 여부는 capability로 선언/검증한다.
- 미지원 operation이 호출되면 `PROVIDER_CAPABILITY_NOT_SUPPORTED`를 반환한다.
- `TOSS`의 capture 모드는 거래별 요청값이 아니라 Provider 설정으로 고정한다.

```ts
type ProviderOperation =
  | "AUTHORIZE"
  | "CAPTURE"
  | "CANCEL"
  | "REFUND"
  | "MANUAL_CONFIRM";

type ProviderCapability =
  | "AUTHORIZE"
  | "CAPTURE"
  | "CANCEL"
  | "REFUND"
  | "PARTIAL_REFUND"
  | "MANUAL_CONFIRM"
  | "CUSTOMER_ACTION"
  | "WEBHOOK"
  | "POLL_STATUS"
  | "AUTO_COMPENSATE";

interface PaymentProvider {
  providerType: string;
  version: string;

  getStaticCapabilities(): ProviderCapability[];
  resolveRuntimeCapabilities(ctx: CapabilityContext): ProviderCapability[];

  validateLeg(req: ValidateLegRequest): Promise<void>;
  authorize(req: AuthorizeRequest): Promise<ProviderOperationResult>;
  capture(req: CaptureRequest): Promise<ProviderOperationResult>;
  cancel(req: CancelRequest): Promise<ProviderOperationResult>;
  refund(req: RefundRequest): Promise<ProviderOperationResult>;
  manualConfirm(req: ManualConfirmRequest): Promise<ProviderOperationResult>;
  getTransaction(req: GetTransactionRequest): Promise<ProviderTransactionSnapshot>;

  handleWebhook?(req: HandleWebhookRequest): Promise<WebhookResult>;
}
```

### 6.1 Common Request Fields

- `intentId`
- `legId`
- `attemptId`
- `operation`
- `amount` (minor unit)
- `currency`
- `customerId`
- `idempotencyKey`
- `correlationId`
- `metadata`

### 6.2 Common Result Fields

- `resultStatus`
  - `AUTHORIZED`
  - `CAPTURED`
  - `CANCELLED`
  - `REFUNDED`
  - `REQUIRES_CUSTOMER_ACTION`
  - `REQUIRES_ADMIN_CONFIRMATION`
  - `FAILED`
- `providerTransactionId` (nullable)
- `providerRequestId` (nullable)
- `nextAction` (nullable)
- `raw` (provider payload snapshot)

## 7. Operation Semantics

## 7.1 AUTHORIZE

- 목적: 결제 가능 상태 확보(예약/입금대기/인증 완료)
- 허용 결과:
  - `AUTHORIZED`
  - `REQUIRES_CUSTOMER_ACTION`
  - `REQUIRES_ADMIN_CONFIRMATION`
  - `CAPTURED` (Provider가 즉시 확정하는 경우)
  - `FAILED`

## 7.2 CAPTURE

- 목적: 승인된 금액의 최종 결제 확정
- 전제: `CAPTURE` capability 필요
- 허용 결과:
  - `CAPTURED`
  - `FAILED`

## 7.3 CANCEL

- 목적: 승인/대기 상태 결제의 취소 또는 보상 취소
- 전제: `CANCEL` capability 필요
- 허용 결과:
  - `CANCELLED`
  - `FAILED`

## 7.4 REFUND

- 목적: 캡처 완료 금액 환불
- 전제: `REFUND` capability 필요
- 부분환불은 `PARTIAL_REFUND` capability로 별도 검증

## 7.5 MANUAL_CONFIRM

- 목적: 수동형 결제수단(무통장 등)의 관리자 확인 처리
- 전제: `MANUAL_CONFIRM` capability 필요
- 허용 결과:
  - `CAPTURED`
  - `FAILED`

## 8. Capability Matrix (v1 + Roadmap)

표기 규칙:

- `Y`: 자동 지원
- `M`: 수동 처리(관리자 액션 기반)
- `C`: 조건부 지원(설정/상태 의존)
- `N`: 미지원

| Capability | `POINTS` (v1) | `TOSS` (Roadmap) | `BANK_TRANSFER` (Roadmap) |
| --- | --- | --- | --- |
| `AUTHORIZE` | `Y` | `Y` | `Y` |
| `CAPTURE` | `Y` | `C` | `M` |
| `CANCEL` | `Y` | `C` | `C` |
| `REFUND` | `Y` | `Y` | `M` |
| `PARTIAL_REFUND` | `Y` | `Y` | `C` |
| `MANUAL_CONFIRM` | `N` | `N` | `Y` |
| `CUSTOMER_ACTION` | `N` | `Y` | `N` |
| `WEBHOOK` | `N` | `Y` | `N` |
| `POLL_STATUS` | `Y` | `Y` | `C` |
| `AUTO_COMPENSATE` | `Y` | `C` | `C` |

## 8.1 Provider Behavior Summary

### `POINTS`

- `AUTHORIZE`: 잔액 검증 + 홀드(원장)
- `CAPTURE`: 홀드 금액 최종 차감 확정
- `CANCEL`: 홀드 해제
- `REFUND`: 역분개(원장)

### `TOSS`

- `AUTHORIZE`: 고객 인증/리다이렉트 후 승인
- `CAPTURE`: Provider 설정 모드에 따라 동작
  - `MANUAL_CAPTURE` 모드: `AUTHORIZE` 후 `CAPTURE` 분리 실행
  - `AUTO_CAPTURE` 모드: authorize 단계에서 즉시 확정되어 별도 capture 미수행
- `REFUND`: PG 환불 API 호출
- `WEBHOOK`: 비동기 상태 반영(필수)

### `BANK_TRANSFER`

- `AUTHORIZE`: 입금대기 생성, 상태는 `REQUIRES_ADMIN_CONFIRMATION`
- `MANUAL_CONFIRM`: 운영자 입금 확인 시 `CAPTURED`
- `CANCEL`: 미입금 대기건 취소 중심, 입금완료 건은 수동 정리 가능
- `REFUND`: 자동화가 어려운 경우 수동 처리 큐 연계

## 9. Orchestrator Rules with Capabilities

- 오케스트레이터는 operation 실행 전에 capability를 반드시 검증한다.
- capability 미지원 operation 요청은 즉시 거절한다.
  - 권장 코드: `PROVIDER_CAPABILITY_NOT_SUPPORTED`
- 모든 operation 호출은 `payment_attempts`에 기록한다.
- Provider 반환값은 `PaymentLegStatus`/`PaymentAttemptStatus`로 표준 매핑한다.
- 보상 경로에서 `AUTO_COMPENSATE`가 없거나 실패하면 수동 취소 큐로 이관한다.

## 10. Medusa Mapping Guideline

Medusa Payment Module Provider와 Wallet Provider Operation의 권장 매핑:

| Medusa Side | Wallet Provider Operation |
| --- | --- |
| `authorizePayment` | `AUTHORIZE` |
| `capturePayment` | `CAPTURE` |
| `cancelPayment` | `CANCEL` |
| `refundPayment` | `REFUND` |
| `getPaymentStatus` | `getTransaction`/`POLL_STATUS` |

`BANK_TRANSFER`는 구조적으로 `AUTHORIZE`와 `CAPTURE` 사이에 운영자 수동확인 단계가 존재한다.

### 10.1 TOSS Capture Mode Policy (v1 확정)

- v1은 Provider 설정 고정 정책을 사용한다.
- 거래별 capture 모드 지정은 허용하지 않는다.
- 권장 운영:
  - `TOSS_AUTO_CAPTURE` Provider와 `TOSS_MANUAL_CAPTURE` Provider를 분리 등록
  - 지역/채널/상품 정책에 따라 Provider를 선택

## 11. Open Decisions

- 현재 없음
