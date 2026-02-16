# Wallet Rebuild - Test Scenarios (Draft)

## 1. Purpose

이 문서는 Wallet v1의 서비스 무결성을 검증하기 위한 테스트 시나리오 카탈로그다.
목표는 "핵심 불변식 + 상태 전이 + 정합성 + 운영 절차"가 실제 실행 경로에서 보장되는지 확인하는 것이다.

## 2. Integrity Gate Definition

아래 조건을 모두 만족하면 v1 서비스 무결성이 검증된 것으로 본다.

1. P0 시나리오 100% 통과
2. 결제 금액/상태/이벤트 불일치 0건
3. 보상 실패 건이 모두 수동 큐로 추적 가능
4. 권한 없는 관리자 액션 100% 차단

## 3. Test Layers

- Unit: 상태 전이 규칙, 검증 규칙, capability 가드
- Integration: DB 트랜잭션, outbox, provider adapter, idempotency
- E2E: Medusa/Wallet Front/Admin/Command/Event 종단 흐름
- Recovery: 재기동/중복전달/타임아웃/unknown 상태 복구

## 4. Assumptions

- v1 `referenceType`은 `STORE_ORDER`, `SUBSCRIPTION_BILLING`만 허용
- 0원 결제는 leg 생성 없이 intent fast path
- HMAC은 단일 공유 키, 키 로테이션 없음
- 변경성 API는 `Idempotency-Key` 필수 (단, `POST /v1/webhooks/{providerType}` 제외)
- 보상 자동 재시도는 없음(실패 시 수동 큐 이관)

## 5. Scenario Catalog

표기:

- Priority: `P0`(출시 필수), `P1`(확장/회귀 권장)
- Type: `U`(Unit), `I`(Integration), `E`(E2E), `R`(Recovery)

## 5.1 Intent Creation and Input Integrity

| ID | Priority | Type | Scenario | Expected |
| --- | --- | --- | --- | --- |
| `S-INT-001` | P0 | I | 유효한 `CreatePaymentIntent` 생성 | `PENDING` 생성, 이벤트/로그 기록 |
| `S-INT-002` | P0 | I | 허용되지 않은 `referenceType` | 요청 거절 |
| `S-INT-003` | P0 | I | `signatureVersion` 불일치 | 요청 거절 |
| `S-INT-004` | P0 | I | `signedAt` 만료 | 요청 거절 |
| `S-INT-005` | P0 | I | `signature` 위변조 | 요청 거절 |
| `S-INT-006` | P0 | I | canonicalization 차이 유발 payload | `INVALID_SIGNATURE` 또는 hash mismatch |
| `S-INT-007` | P0 | I | 동일 `reference` 동시 생성 경합 | reference-blocking intent 1개만 생성 |
| `S-INT-008` | P0 | I | 동일 Idempotency-Key + 동일 body 재요청 | 기존 응답 재전송 |
| `S-INT-009` | P0 | I | 동일 Idempotency-Key + 상이 body | `409 Conflict` |
| `S-INT-010` | P0 | I | `payableAmount == 0` | leg 없이 즉시 완료 처리 |
| `S-INT-011` | P0 | I | 동일 `reference`에 기존 Intent가 `SUCCEEDED`인 상태에서 새 Intent 생성 시도 | 요청 거절 (`REFERENCE_ALREADY_PAID`) |

## 5.2 Leg Orchestration and Provider Capability

| ID | Priority | Type | Scenario | Expected |
| --- | --- | --- | --- | --- |
| `S-LEG-001` | P0 | U | leg amount `<=0` 검증 | 거절 |
| `S-LEG-002` | P0 | I | POINTS `AUTHORIZE` 성공 | Leg `AUTHORIZED` |
| `S-LEG-003` | P0 | I | POINTS `CAPTURE` 성공 | Leg `CAPTURED`, Intent 진행 |
| `S-LEG-004` | P0 | U | 미지원 capability operation 호출 | `PROVIDER_CAPABILITY_NOT_SUPPORTED` |
| `S-LEG-005` | P0 | I | `REQUIRES_ADMIN_CONFIRMATION` leg 수동확인 전이 | manual confirm 후 `CAPTURED` |
| `S-LEG-006` | P0 | I | 고객행동 필요 상태(`REQUIRES_CUSTOMER_ACTION`) | 후속 액션 전 완료 불가 |
| `S-LEG-007` | P1 | I | TOSS auto-capture 모드 | authorize 단계 확정 |
| `S-LEG-008` | P1 | I | TOSS manual-capture 모드 | authorize 후 capture 필요 |

## 5.3 Reference-Blocking, Supersede, Expiration

| ID | Priority | Type | Scenario | Expected |
| --- | --- | --- | --- | --- |
| `S-ACT-001` | P0 | I | 동일 `reference` reference-blocking intent 중복 생성 시도 | DB 유니크 제약으로 차단 |
| `S-ACT-002` | P0 | E | supersede 시작 | 기존 intent `SUSPENDED` |
| `S-ACT-003` | P0 | E | supersede 보상 성공 | 기존 intent `SUPERSEDED` |
| `S-ACT-004` | P0 | E | supersede 보상 실패 | `SUPERSEDED_RECONCILE_REQUIRED` |
| `S-ACT-005` | P0 | R | 72h 만료 처리 | `EXPIRED` 또는 reconcile required |
| `S-ACT-006` | P0 | I | 만료 시 부분성공 leg 존재 | 보상 실행 후 종료 |

## 5.4 Refund and Allocation Integrity

| ID | Priority | Type | Scenario | Expected |
| --- | --- | --- | --- | --- |
| `S-RFD-001` | P0 | I | 단일 결제수단 환불(배분 명시) | 정상 처리 |
| `S-RFD-002` | P0 | I | 복합 결제 환불(배분 명시) | allocation대로 처리 |
| `S-RFD-003` | P0 | I | allocation 합계 != refundAmount | 거절 |
| `S-RFD-004` | P0 | I | 캡처되지 않은 leg 대상 allocation | 거절 |
| `S-RFD-005` | P0 | I | leg별 누적 환불 한도 초과 | 거절 |
| `S-RFD-006` | P0 | E | 환불 승인 후 완료 | `RefundCompleted` 이벤트 |
| `S-RFD-007` | P0 | E | 환불 실패 | `RefundFailed` + 수동 개입 표시 |
| `S-RFD-008` | P1 | I | 부분환불 연속 요청 | 누적 정합성 유지 |

## 5.5 Compensation and Reconcile

| ID | Priority | Type | Scenario | Expected |
| --- | --- | --- | --- | --- |
| `S-CMP-001` | P0 | E | 실패 종료 시 `AUTHORIZED` leg 보상 | `CANCEL` 수행 |
| `S-CMP-002` | P0 | E | 실패 종료 시 `CAPTURED` leg 보상 | `REFUND` 수행 |
| `S-CMP-003` | P0 | I | 보상 순서 검증 | cancel 우선, refund 후행 |
| `S-CMP-004` | P0 | I | 보상 성공 판정 | intent 정상 종료 상태 |
| `S-CMP-005` | P0 | I | 보상 실패 판정 | `RECONCILE_REQUIRED` |
| `S-CMP-006` | P0 | I | 자동 재시도 없음 검증 | 1회 실패 시 수동 큐 등록 |
| `S-CMP-007` | P0 | R | reconcile batch가 `UNKNOWN` attempt 복구 | 상태 보정 또는 큐 이관 |
| `S-CMP-008` | P0 | E | `PaymentReconcileRequired` 이벤트 | 정확한 reason/manualQueueItemId 포함 |

## 5.6 Manual Cancel Queue and Admin Ops

| ID | Priority | Type | Scenario | Expected |
| --- | --- | --- | --- | --- |
| `S-ADM-001` | P0 | E | 큐 `assign -> process -> complete` | 상태 전이/감사로그 정상 |
| `S-ADM-002` | P0 | E | 큐 처리 실패(`retryable=true`) | `FAILED_RETRYABLE` |
| `S-ADM-003` | P0 | E | 큐 처리 실패(`retryable=false`) | `FAILED_FINAL` |
| `S-ADM-004` | P0 | E | 무통장 수동확정 API | `REQUIRES_ADMIN_CONFIRMATION -> CAPTURED` |
| `S-ADM-005` | P0 | E | 환불 승인/거절 API | 상태 가드 준수 |
| `S-ADM-006` | P0 | E | reconcile retry API | 재처리 시작, 추적 가능 |
| `S-ADM-007` | P0 | I | 권한 없는 role에서 write API 호출 | `403` |
| `S-ADM-008` | P0 | I | `wallet_viewer`의 조회 API 접근 | 허용 |
| `S-ADM-009` | P0 | I | `wallet_admin`의 write API 접근 | 허용 |
| `S-ADM-010` | P0 | I | write API idempotency 키 재사용 | 중복 안전성 보장 |

## 5.7 Message Contracts and Event Integrity

| ID | Priority | Type | Scenario | Expected |
| --- | --- | --- | --- | --- |
| `S-MSG-001` | P0 | I | `CreatePaymentIntent` command 수신 | 필수 필드 검증 통과 시 처리 |
| `S-MSG-002` | P0 | I | command 중복 전달(`idempotencyKey`) | 1회 처리 |
| `S-MSG-003` | P0 | I | 동일 intent 이벤트 순서 보장 | 순서 역전 없음 |
| `S-MSG-004` | P0 | I | `PaymentIntentSucceeded` 이후 실패 이벤트 방지 | 금지 규칙 준수 |
| `S-MSG-005` | P0 | I | outbox 발행-커밋 원자성 | 상태/이벤트 불일치 없음 |
| `S-MSG-006` | P0 | E | `RefundCompleted` 이벤트 payload 검증 | allocation/금액 정확 |
| `S-MSG-007` | P1 | R | consumer 재기동 후 중복 consume | `messageId` 중복 방지 |
| `S-MSG-008` | P0 | I | 동일 `(providerType, providerEventId)` 웹훅 중복 수신 | 상태 재전이 없이 no-op + `2xx` |
| `S-MSG-009` | P0 | I | 다중 인스턴스가 동일 웹훅을 동시에 수신 | receipt 유니크 제약으로 1회만 처리, 나머지 no-op `2xx` |

## 5.8 Data Integrity and Concurrency

| ID | Priority | Type | Scenario | Expected |
| --- | --- | --- | --- | --- |
| `S-DB-001` | P0 | I | `payment_state_transitions` append-only | update/delete 불가 |
| `S-DB-002` | P0 | I | 상태 변경 트랜잭션 원자성 | 상태+전이로그+outbox 동시 커밋 |
| `S-DB-003` | P0 | I | optimistic lock 충돌 | `409` 처리 |
| `S-DB-004` | P0 | R | 프로세스 중단 후 재처리 | partial write 없음 |
| `S-DB-005` | P0 | I | 환불 allocation 무결성 | 합계/한도 불변식 유지 |
| `S-DB-006` | P0 | I | open 상태 수동 큐 중복 등록(`intent_id + leg_id`) | 기존 open row 갱신(no new row) |
| `S-DB-007` | P0 | I | intent-level 수동 큐 항목(`leg_id = null`) 생성 시도 | 요청/저장 거절 |
| `S-DB-008` | P0 | I | 결제/감사/멱등/웹훅 이력 데이터 삭제 시도(TTL purge/hard delete) | 정책상 거절 또는 미적용 |

## 5.9 HMAC Integrity Focus Cases

| ID | Priority | Type | Scenario | Expected |
| --- | --- | --- | --- | --- |
| `S-HMAC-001` | P0 | I | 정상 canonical payload 서명 검증 | 통과 |
| `S-HMAC-002` | P0 | I | payload 일부 변조 | 실패 |
| `S-HMAC-003` | P0 | I | `signedAt` 포맷 오류 | 실패 |
| `S-HMAC-004` | P0 | I | `signedAt` 허용시간 초과 | 실패 |
| `S-HMAC-005` | P0 | I | `signatureVersion` 미지원 | 실패 |
| `S-HMAC-006` | P0 | I | 공유키 누락/오설정 | 실패 + 운영 경보 |

## 5.10 End-to-End Business Scenarios

| ID | Priority | Type | Scenario | Expected |
| --- | --- | --- | --- | --- |
| `S-E2E-001` | P0 | E | Medusa 스토어 주문 결제 성공(POINTS) | 주문/결제 완료 정합성 확보 |
| `S-E2E-002` | P0 | E | Medusa 주문 중복결제 방지(재요청) | 단일 결제 결과 유지 |
| `S-E2E-003` | P0 | E | 복합 결제 중 하나 실패 후 보상 | 잔여 금액 롤백 완료 |
| `S-E2E-004` | P0 | E | supersede 전환 + 기존 결제 롤백 | 신규 intent로 정상 전환 |
| `S-E2E-005` | P0 | E | 무통장 대기 -> 관리자 확인 -> 성공 | 수동확인 흐름 정상 |
| `S-E2E-006` | P0 | E | 내부 서비스(`SUBSCRIPTION_BILLING`) 청구 결제 | reference 기반 무결성 유지 |
| `S-E2E-007` | P0 | E | 환불 요청-승인-완료 전과정 | 환불/이벤트/감사로그 정합 |
| `S-E2E-008` | P0 | E | 장애 발생 후 reconcile + 수동 큐 종결 | 운영 복구 가능성 입증 |

## 6. Coverage Matrix (Invariant -> Scenario)

| Invariant / Rule | Covered By |
| --- | --- |
| Single Reference-blocking Intent per reference | `S-INT-007`, `S-ACT-001`, `S-E2E-004` |
| No new Intent after `SUCCEEDED` on same reference | `S-INT-011` |
| 0원 fast path (no leg) | `S-INT-010` |
| Allocation exact match | `S-RFD-002`, `S-RFD-003`, `S-DB-005` |
| HMAC integrity | `S-INT-003~006`, `S-HMAC-*` |
| Idempotency guarantee | `S-INT-008~009`, `S-ADM-010`, `S-MSG-002`, `S-MSG-008~009` |
| Compensation on partial success termination | `S-CMP-001~005`, `S-E2E-003` |
| Manual queue ownership/operability | `S-ADM-001~003`, `S-E2E-008` |
| Event ordering/consistency | `S-MSG-003~005` |
| Role/scope authorization | `S-ADM-007~009` |

## 7. Release Recommendation

- 출시 차단 게이트:
  - 모든 P0 Green
  - P1은 실패 허용 가능하나 원인/완화전략 문서화 필요
- 회귀 기준:
  - 결제 핵심 경로(`S-E2E-001`, `S-E2E-003`, `S-E2E-007`)는 CI 필수
  - 권한/멱등/HMAC 시나리오는 PR 단위 필수

## 8. Open Decisions

- 현재 없음
