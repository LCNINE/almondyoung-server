# 주문 상태/액션 매트릭스와 고객-관리자 표시 기준

## 배경

Core의 판매주문(`sales_orders.status`)과 Wallet의 환불(`refunds.status`)은 서로 다른 bounded context에 존재한다. 고객 화면과 관리자 화면이 "같은 의미로 같은 버튼"을 보여주려면, 이 두 상태를 조합한 **표시 상태(display status)** 레이어가 필요하다.

또한 반품/교환은 아직 Core에 별도 workflow가 없으므로, 현재 구현 가능한 범위와 미래 작업을 명시적으로 분리한다.

## 상태 레이어 구분

| 레이어 | 소유자 | 상태값 |
|--------|--------|--------|
| Core `sales_orders.status` | Core | `pending`, `confirmed`, `processing`, `shipped`, `delivered`, `cancelled`, `timeout` |
| Core `fulfillmentOrders.status` | Core | `created`, `allocating`, `picking`, `picked`, `invoiced`, `shipped`, `completed`, `canceled`, ... |
| Wallet `refunds.status` | Wallet | `PENDING`, `SUCCEEDED`, `FAILED` |
| 표시 상태 (derived) | API layer | 아래 정의 |

## 표시 상태 정의 (고객·관리자 공통)

표시 상태는 SO + FO + Wallet refund를 조합해 결정한다. 우선순위는 위에서 아래 순.

| 표시 상태 | 조건 (우선 적용 순) | 고객 레이블 | 관리자 레이블 |
|-----------|---------------------|------------|--------------|
| `CANCEL_REQUESTED` | (미래) cancel_request 존재 + pending | 취소 요청 중 | 취소 요청 접수 |
| `REFUND_PENDING` | SO `cancelled` + refund `PENDING` | 환불 처리 중 | 환불 대기 (수동 처리 필요) |
| `REFUND_FAILED` | SO `cancelled` + refund `FAILED` | 환불 실패 (문의 필요) | 환불 실패 |
| `REFUND_COMPLETE` | SO `cancelled` + refund `SUCCEEDED` | 환불 완료 | 환불 완료 |
| `CANCELLED` | SO `cancelled` + refund 없음 | 취소 완료 | 취소 완료 (환불 미연결) |
| `RETURN_REQUESTED` | (미래) return_request 존재 + pending | 반품 접수 중 | 반품 요청 확인 필요 |
| `RETURN_COMPLETE` | (미래) return_request resolved | 반품 완료 | 반품 완료 |
| `EXCHANGE_REQUESTED` | (미래) exchange_request 존재 + pending | 교환 접수 중 | 교환 요청 확인 필요 |
| `EXCHANGE_COMPLETE` | (미래) exchange_request resolved | 교환 완료 | 교환 완료 |
| `DELIVERED` | SO `delivered` | 배송 완료 | 배송 완료 |
| `SHIPPING` | SO `shipped` | 배송 중 | 출고 완료 / 배송 중 |
| `PREPARING` | SO `confirmed` or `processing`, FO 출고 전 | 상품 준비 중 | 피킹/패킹 진행 중 |
| `PAYMENT_COMPLETE` | SO `confirmed`, FO 없음 | 결제 완료 | 결제 완료 (출고 대기) |
| `PENDING` | SO `pending` | 결제 확인 중 | 결제 대기 |
| `TIMEOUT` | SO `timeout` | 주문 시간 초과 | 타임아웃 |

> **참고**: FO 중 하나라도 `shipped`/`completed` 이면 SO가 `confirmed`여도 `SHIPPING` 이상으로 처리한다.

## 액션 매트릭스

### 고객 액션

| 표시 상태 | 주문취소 | 배송조회 | 반품신청 | 교환신청 |
|-----------|:--------:|:--------:|:--------:|:--------:|
| `PAYMENT_COMPLETE` | ✅ 가능 | ❌ | ❌ | ❌ |
| `PREPARING` | ⚠️ 정책 결정 필요¹ | ❌ | ❌ | ❌ |
| `SHIPPING` | ❌ | ✅ 가능 | ⚠️ 미구현² | ⚠️ 미구현² |
| `DELIVERED` | ❌ | ✅ 가능 | ⚠️ 미구현² | ⚠️ 미구현² |
| `CANCEL_REQUESTED` | ❌ (처리 중) | ❌ | ❌ | ❌ |
| `CANCELLED` | ❌ | ❌ | ❌ | ❌ |
| `REFUND_PENDING` | ❌ | ❌ | ❌ | ❌ |
| `REFUND_FAILED` | ❌ | ❌ | ❌ | ❌ |
| `REFUND_COMPLETE` | ❌ | ❌ | ❌ | ❌ |
| `RETURN_REQUESTED` | ❌ | ✅ | ❌ (처리 중) | ❌ |
| `RETURN_COMPLETE` | ❌ | ✅ | ❌ | ✅ 교환 가능여부 확인 필요 |
| `EXCHANGE_REQUESTED` | ❌ | ✅ | ❌ | ❌ (처리 중) |
| `EXCHANGE_COMPLETE` | ❌ | ✅ | ✅ 가능여부 확인 필요 | ❌ |
| `TIMEOUT` | ❌ | ❌ | ❌ | ❌ |

¹ 피킹 시작 후 취소: FO cancellable status 여부에 따라 가능/불가. Core API가 판단하고 에러 메시지 반환. 고객에게는 "이미 처리 중이라 취소가 어려울 수 있다"는 안내 필요.

² 반품/교환은 `return_requests`/`exchange_requests` 테이블과 workflow가 없어 현재 미구현. 고객에게는 "고객센터 문의" 또는 "채널(쿠팡/네이버) 반품" 안내로 대체.

### 관리자 액션

| 표시 상태 | 주문취소(전체) | 주문취소(부분) | 환불실행 | 환불수동완료 | 반품승인/거절 | 교환승인/거절 |
|-----------|:--------------:|:--------------:|:--------:|:------------:|:-------------:|:-------------:|
| `PAYMENT_COMPLETE` | ✅ | ✅ | ✅¹ | — | — | — |
| `PREPARING` | ⚠️ FO 상태 확인² | ✅ | ✅¹ | — | — | — |
| `SHIPPING` | ❌ | ✅(부분만) | ✅¹ | — | — | — |
| `DELIVERED` | ❌ | ✅(부분만) | ✅¹ | — | ⚠️ 미구현 | ⚠️ 미구현 |
| `CANCELLED` | ❌ | ❌ | ✅ 환불 연결 가능 | — | — | — |
| `REFUND_PENDING` | ❌ | ❌ | ❌ | ✅ (BANK_TRANSFER만) | — | — |
| `REFUND_FAILED` | ❌ | ❌ | ✅ 재시도 | — | — | — |
| `REFUND_COMPLETE` | ❌ | ❌ | ❌ | ❌ | — | — |
| `RETURN_REQUESTED` | — | — | — | — | ⚠️ 미구현 | — |
| `EXCHANGE_REQUESTED` | — | — | — | — | — | ⚠️ 미구현 |

¹ Wallet 환불 실행 → Core business link 연결은 현재 수동 2단계 (취소 후 별도 환불 버튼). 자동 연결은 미구현.

² `PREPARING` 상태에서 전체 취소: FO에 shipped evidence가 없으면 가능. Core가 판단해서 거절/허용.

## 현재 구현 상태 vs 미구현

### 구현 완료 (이번 작업 기준)

- [x] Core full cancel — shipped evidence guard (FO status + FOI shippedQty + FOR UPDATE lock)
- [x] Core partial cancel — payload 전달 (lines, reasonCode, cancelledBy)
- [x] Wallet refund — 중복/초과 방지, 실패 사유 저장, charge lock
- [x] Wallet BANK_TRANSFER refund — PENDING 반환 + 수동 완료 플로우
- [x] Admin 결제 상세 — FAILED/PENDING 구분 toast, manualConfirmable 버튼
- [x] Admin 주문이력 — 취소 dialog (전체/부분, 사유, shipped 차단)

### 미구현 (다음 작업)

- [ ] 고객용 주문 action API (`GET /store/orders/:id/actions`, `POST /store/orders/:id/cancel-request`)
- [ ] 표시 상태 도출 API (SO + FO + Wallet refund 조합)
- [ ] Storefront 주문내역 버튼 조건부 노출 (표시 상태 기반)
- [ ] Core cancellation → Wallet refund 자동 연결
- [ ] 반품/교환 workflow (`return_requests`, `exchange_requests` 테이블 + API)
- [ ] 배송조회 API (FO tracking + 택배사/송장번호)
- [ ] Admin timeline 운영 UX (raw JSON → 사람이 읽는 타임라인)

## 고객 API 설계 원칙

### 소유권 검증 필수

고객 API는 반드시 `customerId` (또는 JWT subject)와 `orderId`의 소유 관계를 검증해야 한다. Core 현재 컨트롤러는 admin/internal용이므로 고객 엔드포인트는 별도로 만든다.

### 상태 기반 허용 판단은 서버가

고객 클라이언트는 "취소 가능 여부"를 직접 계산하지 않는다. `GET /store/orders/:id/actions`가 현재 가능한 액션 목록을 내려준다. 클라이언트는 그 목록에 있는 버튼만 활성화한다.

### 취소 vs 반품 분리

출고 전 → `cancel-request`. 출고 후 → `return-request`. 두 개념을 클라이언트에서 섞지 않는다. 상태에 따라 자동으로 올바른 엔드포인트로 안내한다.

### 채널 주문 특수 처리

네이버, 쿠팡 등 채널 주문은 취소/반품을 채널 자체에서 해야 하는 경우가 있다. 이 경우 고객 API는 "채널에서 직접 신청" 안내를 내려줘야 한다 (`canCancelDirectly: false`, `channelCancelUrl: "..."`).

## Consequences

- 표시 상태 도출 로직은 Core store-facing API에서 계산하거나, BFF layer에서 처리한다.
- 반품/교환 workflow 구현 전까지 해당 버튼은 "고객센터 문의" 또는 채널 직접 처리로 대체한다.
- 관리자가 취소를 먼저 하고 환불을 나중에 연결하는 현재 2단계 구조는, Core cancellation → Wallet refund 자동 연결 구현 후 단일 플로우로 통합된다.
