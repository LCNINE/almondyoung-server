# Wallet Rebuild - Scope and Rules (Draft)

## 1. Purpose

이 문서는 Wallet 서비스 전면 재작업의 1차 범위(MVP)와 핵심 비즈니스 규칙을 정의한다.
이 문서의 목표는 구현 전에 불변식(invariant), 상태 경계, 정책 우선순위를 고정하는 것이다.

## 2. MVP Scope (v0)

- 결제 수단 1차 지원: `POINTS` (적립금)
- 결제 수단 확장 가능성: 열어둠 (추후 `TOSS`, `무통장`, 기타 Provider 추가)
- 적용 결제 도메인:
  - 스토어프론트 주문 결제 (`Medusa` 주문 SoT)
  - 내부 서비스 결제 지시 (예: membership 정기결제/청구)
- Provider 내부 복잡도 캡슐화:
  - 결제/원장/정산 관련 세부 로직은 Provider 내부 서비스(Repository + Domain Service)에서 처리
  - 상위 서비스는 Provider 공통 인터페이스만 사용
- 원장 모델: 적립금 Provider는 이중원장(Double-entry ledger) 적용을 전제로 함

## 3. Core Domain Terms

- `PaymentIntent`: 결제 대상(주문/내부 청구) 단위 결제 의도 컨테이너
- `PaymentLeg`: 결제 수단별 분할 결제 단위
- `PaymentAttempt`: 특정 Leg의 실제 결제 시도 이력
- `Payment Reference`: 결제 대상 식별자 (`referenceType`, `referenceId`)
- `Reference-blocking Intent`: 동일 `referenceType + referenceId`에서 동시 존재가 금지되는 상태의 Intent
- `Checkout-active Intent`: 결제가 진행 중이며 최종 성공/실패가 확정되지 않은 상태의 Intent

### 3.1 `referenceType` Enum (v1)

- `STORE_ORDER`: Medusa 스토어 주문 결제
- `SUBSCRIPTION_BILLING`: 내부 서비스(예: membership) 정기 청구 결제

## 4. Non-Negotiable Invariants

- 동일 `Payment Reference`(`referenceType + referenceId`) 당 `reference-blocking Intent`는 정확히 1개만 허용한다.
- 동일 `Payment Reference`에 `SUCCEEDED` Intent가 이미 존재하면, 새 Intent 생성을 허용하지 않는다.
- `PaymentIntent`의 최종 결제 목표 금액은 생성 후 변경하지 않는다.
- 결제 성공 판정은 기본적으로 "모든 필수 Leg 성공"이다.
- 부분 성공 상태에서 Intent가 종료(실패/만료/대체)되면 보상 트랜잭션을 수행해야 한다.
- 환불은 결제 완료 금액 한도 내에서만 허용한다.
- 결제/환불/정합성/감사 관련 데이터는 무기한 보관하며, TTL 기반 자동 삭제나 hard delete를 허용하지 않는다.

## 5. Intent Policy

### 5.1 Reference-blocking 단일화 정책

- 채택 정책: `Single Reference-blocking Intent per reference`
- 구현 권장:
  - DB 레벨에서 `referenceType + referenceId + reference-blocking-status` 유니크 제약(Partial Unique Index) 적용
  - 생성/대체 시 트랜잭션 잠금으로 경합 방지

reference-blocking-status 집합(v1 확정):

- `PENDING`
- `IN_PROGRESS`
- `PARTIALLY_CAPTURED`
- `RECONCILING`

checkout-active-status 집합(v1 확정):

- `PENDING`
- `IN_PROGRESS`
- `PARTIALLY_CAPTURED`

정의 관계:

- `checkout-active`는 사용자 결제가 진행 중인 상태 집합이다.
- `reference-blocking`은 동일 reference의 중복 결제 생성을 차단하는 상태 집합이다.
- `checkout-active`는 `reference-blocking`의 부분집합이다.

### 5.2 대안 정책 (참고)

- `Versioned Intent`:
  - 동일 `reference`에 여러 Intent를 허용하되 `currentVersion`만 활성
  - 장점: 이력 추적 유리
  - 단점: 조회/검증/운영 복잡도 증가
- 현재 단계에서는 `Single Reference-blocking Intent`가 운영 안정성 측면에서 우선이다.

### 5.3 Expiration

- 만료 시간: 생성 후 3일 (`72h`)
- 만료 시 처리:
  - 상태 전이: `EXPIRED`
  - 부분 성공 건이 있으면 자동 취소/환불 보상 실행

## 6. Supersede (기존 Intent 대체) Policy

- 명시적 supersede 요청(`SupersedePaymentIntent` 커맨드 또는 `POST /v1/intents/{intentId}/supersede`) 시 기존 reference-blocking Intent는 즉시 `SUSPENDED` 처리
- 이후 보상 오케스트레이션:
  - 자동 취소 가능한 Leg: 즉시 자동 취소
  - 자동 취소 불가 Leg: 수동 처리 큐로 이관
- 최종 상태:
  - 보상 완료: `SUPERSEDED`
  - 보상 미완료: `SUPERSEDED_RECONCILE_REQUIRED`

### 6.1 Manual Cancellation Queue Ownership

- 수동 취소 큐의 소유 및 관리는 Wallet 서비스가 담당한다.
- 운영자는 Wallet 관리자 페이지를 통해 수동 취소 큐를 조회/처리한다.
- 이를 위해 Wallet은 관리자 전용 API를 제공한다.

## 7. Payment Leg Rules

- Leg 금액은 `0 초과`만 허용한다. (`0원 leg` 금지)
- 허용 조합은 기본적으로 제한하지 않음
- 결제 수단 추가 시 핵심 도메인 코드를 수정하지 않고 Provider 추가로 확장 가능해야 함

### 7.1 0원 결제 처리 방식

- 전액 할인 등으로 최종 결제 금액이 `0원`인 경우, 일반 Leg를 만들지 않는다.
- `0원 결제`는 Provider 결제수단으로 모델링하지 않는다.
- 처리 방식은 Intent-level fast path로 고정한다.
  - `payableAmount === 0`일 때만 활성
  - 요청 즉시 승인/캡처 완료 처리
  - `payment_legs` 생성 없음
  - 외부 PG/Provider 호출 없음
  - 감사 로그 및 이벤트는 일반 결제와 동일하게 남김

## 8. Provider Interface Direction

공통 인터페이스는 공통 메서드 시그니처를 고정하고, 실제 지원 여부는 Capability로 판정한다.

- Provider public 계약 메서드는 non-optional로 통일한다.
- capability 미지원 operation은 표준 에러(`PROVIDER_CAPABILITY_NOT_SUPPORTED`)로 거절한다.

- 예시 Capability:
  - `AUTHORIZE`
  - `CAPTURE`
  - `CANCEL`
  - `REFUND`
  - `PARTIAL_REFUND`
  - `MANUAL_CONFIRM`
  - `AUTO_COMPENSATE`

무통장/수동 검증형 수단은 `MANUAL_CONFIRM` 중심 흐름을 지원해야 한다.

## 9. Refund Policy

- 부분 환불: 허용
- 임의 결제수단/임의 금액 부분 취소(환불) 지원이 목표
- 단, Provider Capability가 허용하지 않으면:
  - 자동 처리 실패로 표준 실패 코드 반환
  - 수동 정산/처리 큐로 전환

### 9.1 Refund Allocation Rule

환불 배분은 서버 추론 없이 **요청에 명시된 allocation만** 허용한다.

- 적용 범위:
  - 복합 결제: 필수
  - 단일 결제수단 결제: 동일하게 필수 (일관성 유지)
- 검증 규칙:
  - `sum(allocation.amount) === refundAmount`
  - allocation의 각 항목은 실제 캡처된 Leg를 참조해야 함
  - 각 Leg별 누적 환불 한도를 초과할 수 없음
  - 검증 실패 시 환불 요청은 거절

## 10. Event / Message Contract Policy

- 공통 메시지 구조는 `libs/events` 및 `packages/event-contracts` 규약을 사용
- Command/Event 토픽 분리:
  - `payments.commands.v1`
  - `payments.events.v1`
- 공통 필드:
  - `messageId`
  - `messageType`
  - `messageKind`
  - `messageVersion`
  - `correlationId`
  - `timestamp`

## 10.1 Order Snapshot Integrity

- 주문 스냅샷 무결성 검증은 `HMAC` 서명 방식으로 처리한다.
- Wallet은 Intent 생성 시 전달받은 주문 스냅샷과 서명을 검증해야 한다.
- v1은 단일 공유 HMAC 키를 사용하며, 키 로테이션은 적용하지 않는다.
- 권장 필드:
  - `snapshotPayload` (canonical JSON)
  - `signature`
  - `signatureVersion`
  - `signedAt`

## 11. Medusa Integration Boundary

- Medusa는 시스템 외부 판매채널로 간주
- 따라서 `Medusa Payment Module Provider -> Wallet HTTP` 직접 호출 허용
- 이 정책은 "내부 서비스 간 Kafka-only 원칙"과 충돌하지 않음

## 12. Idempotency / Retry Policy

- 현재 결정: 클라이언트 자동 재시도는 도입하지 않음
- 단, **멱등성은 필수**:
  - 사용자 중복 클릭
  - 네트워크 타임아웃 후 동일 요청 재전송
  - 외부 시스템의 중복 전달
  - 위 상황은 재시도 정책과 무관하게 반드시 발생
- v1 결정:
  - 기존 Wallet의 공용 `idempotency_keys` 테이블을 재사용
  - 동일 키+동일 요청은 저장된 응답 재전송
  - 동일 키+상이한 요청은 `409 Conflict`

> 결론: "재시도 없음"은 가능하지만 "멱등성 없음"은 불가.

## 13. Out of Scope (MVP)

- 운영 SLA/SLO 정의
- 고급 장애 대응 플레이북
- 다중 통화/다국가 정산

## 14. Open Decisions

- 현재 없음
