# Wallet Rebuild - Compensation and Reconcile (Draft)

## 1. Purpose

이 문서는 Wallet v1의 보상 트랜잭션(Compensation)과 정합성 정리(Reconcile) 운영 규칙을 정의한다.
목표는 부분 결제 성공 후 실패/만료/대체 상황에서 금전 정합성을 보장하고, 자동 처리 실패 시 운영 절차를 표준화하는 것이다.

## 2. Scope and Assumptions

- 본 문서는 `01~06`을 전제로 한다.
- v1 원칙:
  - 클라이언트 자동 재시도 정책 없음
  - 보상 자동 처리 실패 시 수동 취소 큐로 즉시 이관
- `payableAmount == 0` fast path는 보상 대상 Leg를 만들지 않는다.

## 3. Compensation Trigger Rules

보상은 "종료 전이 자체"가 아니라 "종료 시점에 되돌려야 할 금전 상태가 존재하는가"로 시작한다.

보상 시작 조건:

- Intent가 `EXPIRED`, `CANCELLED`, `FAILED`, `SUPERSEDED` 경로로 종료될 때
- 그리고 아래 중 하나가 존재할 때
  - `AUTHORIZED` 상태 Leg (취소 필요)
  - `CAPTURED` 상태 Leg (환불 필요)

보상 미시작 조건:

- 모든 Leg가 `PLANNED|READY|FAILED|EXPIRED`만 존재
- 즉시 종료해도 금전 롤백 대상이 없는 경우

## 4. Leg Compensation Action Matrix

| Leg Status | 보상 액션 | 비고 |
| --- | --- | --- |
| `PLANNED` | 없음 | 금전 상태 없음 |
| `READY` | 없음 | Provider 실행 전 |
| `PROCESSING` | 상태 재조회 후 판정 | `UNKNOWN` 가능성 고려 |
| `REQUIRES_CUSTOMER_ACTION` | 만료/취소 처리 | 금전 확정 전 단계 |
| `REQUIRES_ADMIN_CONFIRMATION` | 미입금 취소 또는 수동 확인 큐 | 무통장 등 |
| `AUTHORIZED` | `CANCEL` | 승인분 롤백 |
| `CAPTURED` | `REFUND` | 캡처분 전액 환불(보상 맥락) |
| `CANCELING` | 진행 상태 조회 후 완료/수동이관 | 중복 호출 금지 |
| `REFUNDING` | 진행 상태 조회 후 완료/수동이관 | 중복 호출 금지 |
| `RECONCILE_REQUIRED` | 수동 큐 처리 | 자동 보상 대상 아님 |

## 5. Compensation Execution Order

v1의 기본 순서는 아래와 같다.

1. `AUTHORIZED` Leg 취소(`CANCEL`) 먼저 실행
2. `CAPTURED` Leg 환불(`REFUND`) 실행

환불 순서는 `capturedAt` 역순(최신순)으로 고정한다.

- 이유:
  - 높은 성공 가능 액션(`CANCEL`)을 먼저 소거
  - 실행 순서 결정성을 확보해 운영 추적/재현 용이

## 6. Completion and Failure Criteria

## 6.1 Compensation Success

아래를 모두 만족하면 보상 성공으로 간주한다.

- 보상 대상 Leg가 최종적으로 `CANCELLED|REFUNDED` 상태
- `RECONCILE_REQUIRED` 잔여 Leg 없음

Intent 최종 전이:

- 일반 종료 경로: `RECONCILING -> FAILED|EXPIRED|CANCELLED`
- 대체 경로: `SUSPENDED -> SUPERSEDED`

## 6.2 Compensation Failure

아래 중 하나라도 발생하면 자동 보상 실패다.

- capability 미지원(`CANCEL`/`REFUND` 불가)
- Provider 오류/타임아웃으로 최종 상태 확정 불가
- 최대 처리 시도(v1: 1회) 내 완료 실패

Intent 최종 전이:

- 일반 종료 경로: `RECONCILING -> RECONCILE_REQUIRED`
- 대체 경로: `SUSPENDED -> SUPERSEDED_RECONCILE_REQUIRED`

## 7. Retry Policy (v1)

- 보상 operation 자동 재시도: 없음
- 1회 시도 실패 시 즉시 수동 취소 큐 등록
- 멱등성은 필수:
  - 동일 `intentId/legId/action` 요청 중복 시 부작용 없이 처리

## 8. Manual Cancel Queue Policy

## 8.1 Queue Insert Conditions

아래 케이스는 `manual_cancel_queue_items`에 등록한다.

- Provider capability 미지원
- Provider 응답 `UNKNOWN` 또는 타임아웃으로 상태 확정 불가
- 수동 확인이 필수인 결제수단(`MANUAL_CONFIRM`)
- 자동 보상 시도 실패

큐 단위 규칙(v1 확정):

- `manual_cancel_queue_items`는 leg-level 항목만 허용한다.
- intent-level 큐 항목은 생성하지 않는다.
- intent 전체에 수동 정리가 필요하면 해당 intent의 대상 leg 각각을 큐에 등록한다.

## 8.2 De-duplication Rule

중복 등록을 막기 위해 논리적 유니크 키를 사용한다.

- v1 확정 기준:
  - open 상태 집합(`QUEUED`, `ASSIGNED`, `PROCESSING`, `FAILED_RETRYABLE`)에서는 `(intent_id, leg_id)`가 중복되면 안 된다.
  - closed 상태 집합(`COMPLETED`, `FAILED_FINAL`, `CLOSED`)에는 유니크 제약을 적용하지 않는다.
  - 결과적으로 동일 `intent_id + leg_id`에 대해 여러 `action_type`이 동시에 open되는 것은 허용하지 않는다.
- 동일 대상 open 항목이 있으면 신규 생성 대신 기존 open 항목 업데이트로 처리한다.
  - `action_type` 재판정이 필요한 경우에도 새 row를 만들지 않고 기존 open row의 `action_type`을 업데이트한다.
  - 변경 사유/재시도 카운트/감사 로그를 함께 남긴다.

## 8.3 Priority Rule

- 기본 `normal`
- 승격 조건:
  - 고객 클레임/CS 에스컬레이션
  - 고액 결제
  - 장기 미처리(`age > SLA threshold`)

## 9. Operator Workflow

수동 처리 상태 흐름:

- `QUEUED -> ASSIGNED -> PROCESSING -> COMPLETED`
- 실패 시:
  - `PROCESSING -> FAILED_RETRYABLE`
  - `PROCESSING -> FAILED_FINAL`
  - 필요 시 운영 정책으로 `CLOSED`

운영자 처리 시 필수 기록:

- `operatorId`
- `reasonCode`
- `reasonMessage`
- `providerTransactionId` (가능 시)
- 증적 메모(외부 처리 근거, 계좌이체 확인 등)

## 10. Reconcile Batch Policy

## 10.1 Run Schedule

- 주기 실행 배치(예: 10분)
- 즉시 트리거:
  - 운영자 수동 재처리 요청(`RetryReconcile` 커맨드)

## 10.2 Target Selection

아래 상태를 우선 대상으로 한다.

- Intent: `RECONCILING`, `RECONCILE_REQUIRED`, `SUPERSEDED_RECONCILE_REQUIRED`
- Leg: `CANCELING`, `REFUNDING`, `RECONCILE_REQUIRED`
- Attempt: `UNKNOWN`

## 10.3 Reconcile Checks

- 내부 상태 vs Provider 실제 상태 일치 여부
- Leg별 누적 캡처/환불 금액 정합성
- Intent 합계 정합성:
  - `sum(captured) - sum(refunded) == intent net paid`

## 10.4 Reconcile Outcomes

- 자동 확정 가능한 경우:
  - 상태 보정 + 전이 로그 + outbox 이벤트 기록
- 자동 확정 불가:
  - 수동 큐 유지/신규 등록
  - `RECONCILE_REQUIRED` 유지

## 11. Event and Alert Policy

기존 이벤트 계약(`03-message-contracts.md`)을 우선 사용한다.

보상/정리 상황의 최소 발행 기준:

- `PaymentReconcileRequired`
  - 자동 보상 실패 또는 정합성 확정 불가 시
- `PaymentIntentFailed|Expired|Cancelled|Superseded`
  - 보상 완료 후 최종 종료 이벤트
- `RefundFailed`
  - 보상 환불 실패 시

운영 알림 기준(권장):

- `PaymentReconcileRequired` 발생 즉시
- 수동 큐 적체 임계치 초과
- 장기 미해결 항목 임계치 초과

## 12. Audit and Observability

## 12.1 Mandatory Audit Fields

- `intentId`, `legId`, `attemptId`
- `previousStatus`, `newStatus`
- `actionType` (`CANCEL` | `REFUND` | `MANUAL_CONFIRM` 등)
- `reasonCode`, `reasonMessage`
- `triggeredByType`, `triggeredById`
- `correlationId`, `causationId`

## 12.2 Metrics (v1)

- `compensation_success_rate`
- `compensation_duration_ms`
- `compensation_failure_count{providerType,reasonCode}`
- `manual_queue_open_count`
- `manual_queue_oldest_age_ms`
- `reconcile_required_count`

## 13. Open Decisions

- 현재 없음
