# Sprint FO/Admin-web 기준선 (2026-06-09)

> Phase 0 산출물 — "무엇을 완료로 볼지" 합의 문서.
> 이 문서의 판단 기준은 코드가 아니라 ADR/마이그레이션 문서이며,
> Phase 1 이후 구현 완료 여부는 이 기준에서 체크한다.

---

## 1. 서비스 경계 (불변)

| 소유자 | 책임 |
|--------|------|
| **Core** | FO 상태 전이, 재고 예약/해제/이전, 배송 상태, 출고 이벤트 발행의 SoT |
| **admin-web** | 운영 명령 UI. 상태 판단은 서버 응답 기반. 서버가 내려준 관리자용 `adminAvailableActions`만 활성화 |
| **storefront** | Core store-facing action/tracking projection만 소비. FO 상태를 직접 계산하지 않음 |
| **channel-adapter** | Core 이벤트를 외부 채널/Medusa projection으로 반영 |
| **Medusa** | Medusa order는 Core `sales_orders`와 다른 정체성. `(salesChannel, channelOrderId)`로 참조 |
| **Wallet** | 취소/환불 후처리에서만 Core와 연결. FO 상태의 SoT 아님 |

---

## 2. ADR 결정 요약 (이번 Sprint의 룰셋)

### ADR-0012 — FO 생성과 예약은 분리
- 재고 부족 → FO 객체는 생성, reservation 단계에서 실패/대기 표시
- "생성 + 예약을 한 트랜잭션"으로 묶는 API는 폐기 (POST /fulfillment-orders = deprecated)
- Canonical: `POST /fulfillments`

### ADR-0014 — FO 생성 대기는 durable backlog
- 판매상품↔재고상품 매칭 누락 → backlog 기록. SO 롤백 불가
- 운영화면은 "매칭 없어 대기 중인 주문"을 backlog 기준으로 표시해야 함

### ADR-0015 — 상품매칭은 strategy 중심
- `strategy='void'` = 물리 출고 불필요. `strategy='variant'` + `status='matched'` = 정상 매칭
- `status='ignored'`는 legacy; 새로 쓰지 않음
- 출고주문 생성은 `strategy='void'` 여부를 명시적으로 확인

### ADR-0016 — 수락 후 주문은 계약 스냅샷
- `sales_order_lines`는 직접 PATCH/DELETE 금지
- 사후 변경: 주문정정(SalesOrderAmendment), 취소(OrderCancellation), 환불(Wallet), 출고 조정
- 관리자 화면은 CS/정정/취소/환불/출고/반품 연결 타임라인을 보여야 함

### ADR-0017 + order-post-processing-action-matrix — 표시 상태 조합 규칙
- 표시 상태 = SO status + FO status + Wallet refund status 조합
- 고객용 `availableActions`는 서버(Core store-facing API)가 내려줌. storefront는 계산 안 함
- 관리자 FO 액션은 고객 액션과 별도 계약(`adminAvailableActions`)으로 둠
- FO 중 하나라도 `shipped`/`completed`이면 SO가 `confirmed`여도 전체취소 불가

---

## 3. 현재 구현 상태 평가

### 3.1 완료로 인정하는 것 (Wave D1/D2 산출물)

Wave D1/D2는 ✅로 표시되어 있으나, 아래 "완료로 인정하는 범위"는 한정적이다.

**완료 (이번 Sprint에서 건드리지 않아도 되는 것):**
- `/order/picking-list` 화면 (FO ID 입력 → 피킹 시작 → 바코드 스캔 → 완료)
- `/order/inspection` 화면 (세션 시작 → 검수 입력 → 일괄 승인 → 세션 완료)
- `/order/print-invoices-by-order` 화면 (goodsflow 발행 → 출력 URI)
- `/order/outbound-batches` 화면 (배치 생성 → FO 추가 → start-picking 흐름)
- `/order/direct-ship` 화면 (forward → CSV export → complete)
- admin-web `ALMONDYOUNG_API_BASE_URL` 단일 base URL 이전
- `BarcodeScanInput` 공용 컴포넌트 추출

**완료였으나 이번 Sprint에서 반드시 보정해야 하는 것:**

| 항목 | 현재 증상 | 근거 파일 |
|------|-----------|-----------|
| `POST /fulfillment-orders` 경로 | admin-web이 여전히 deprecated 410 경로 호출 | `wms-pim-통합-마이그레이션.md` §4 PR#1-4 |
| FO 목록/상세 hook | `Promise.resolve([])` stub — 실 API 미연결 | `queries.ts:221` |
| FO split reservation 재분배 | 새 FOI id로 원본 예약 조회 → 재분배 누락 | `fulfillments.service.ts:922` |
| direct-ship 상태 매핑 손실 | `allocated≡forwarded`, `completed≡shipped` 합침 | 마이그레이션 문서 D2 ⚠️ |
| invoice `direct`/`self` ship 처리 경로 | `markAsShipped`가 `printed` 상태만 허용 → 전이 불가 | 마이그레이션 문서 D1 ⚠️ |
| reserve/unreserve/transfer URL:id ↔ body FOI 소속 검증 없음 | 다른 FO의 FOI를 잘못 처리 가능 | `fulfillments.controller.ts:97` |

### 3.2 미구현 (이번 Sprint 신규 작업)

| 항목 | 우선순위 |
|------|---------|
| `GET /fulfillments` 필터 확장 (status, warehouseId, fulfillmentMode, salesOrderId, priority, pagination) | Phase 1 필수 |
| `GET /fulfillments/:id` 응답 확장 (items, reservations, batch, shipment, invoice, directShipStatus, adminAvailableActions) | Phase 1 필수 |
| shipped evidence 있는 FO → split/reserve/unreserve/batch-remove 서버 차단 | Phase 1 필수 |
| admin-web FO 목록 read-only 화면 `/order/fulfillments` | Phase 4A |
| admin-web FO 상세 read-only 화면 `/order/fulfillments/[id]` | Phase 4B |
| admin-web FO 재고 액션 탭 | Phase 4C |
| admin-web FO 분할 탭 | Phase 4D |
| admin-web FO 배송 탭 | Phase 4E |
| admin-web FO 직배 탭 | Phase 4F |
| 기존 화면에서 FO 상세 deep link 연결 | Phase 5 |
| storefront `availableActions`/tracking 회귀 검증 | Phase 6 |
| 배송조회 API `GET /store/orders/:id/tracking` projection 회귀 검증 | Phase 6 |
| Core cancellation → Wallet refund 자동 연결 | Phase 6 검증 |

### 3.3 이번 Sprint 범위 외 (명시적 제외)

- 반품/교환 workflow (`return_requests`, `exchange_requests` 테이블)
- Admin 타임라인 UX (raw JSON → 사람이 읽는 타임라인)
- 채널 주문 취소/반품 안내 통합
- consolidation/location-optimization 실 구현 (advisory 유지)
- inspection 세션 DB 영속 (현재 in-memory)
- JWT 가드 일괄 적용 (별도 인프라 PR)

---

## 4. 이번 Sprint 완료 기준 (Acceptance Criteria)

### Core 계약

- [ ] `GET /fulfillments`가 status, warehouseId, fulfillmentMode, salesOrderId, priority, limit, offset 필터를 지원한다
- [ ] `GET /fulfillments/:id` 응답에 items, reservations, shipment, invoice, directShipStatus, `adminAvailableActions`가 포함된다
- [ ] `POST /fulfillments/:id/split` 후 원본/신규 FO의 reservedQty와 reservation row 수가 일치한다 (unit test)
- [ ] reserve/unreserve/transfer-reservation 요청에서 URL의 FO id와 body FOI의 실제 소속 FO id가 다르면 400이 반환된다
- [ ] FO에 shippedQty > 0인 FOI가 있으면 split/unreserve/batch-remove 요청이 409로 차단된다

### 배송/직배 이벤트

- [ ] goodsflow invoice를 통한 ship 처리, direct ship complete, self ship 처리가 모두 동일하게 FulfillmentShipped outbox 이벤트를 발행한다
- [ ] channel-adapter가 FulfillmentShipped 이벤트를 수신할 수 있는 경로가 존재한다

### admin-web

- [ ] admin-web에서 deprecated `POST /fulfillment-orders`를 호출하는 코드가 0건이다
- [ ] `/order/fulfillments` 목록 화면에서 FO 목록이 실제 API로 조회된다
- [ ] `/order/fulfillments/[id]` 상세 read-only 화면에서 개요/items/reservations/batch/invoice/shipment/directShipStatus가 표시된다
- [ ] FO 상세 재고 탭에서 재고 확인/예약/해제/이전 액션이 접근 가능하다
- [ ] FO 상세 분할 탭에서 미출고 수량만 분할 가능하다
- [ ] FO 상세 배송 탭에서 assign-shipment/ship/deliver가 접근 가능하다
- [ ] FO 상세 직배 탭은 `drop_ship` FO에만 노출된다
- [ ] 모든 관리자 액션 버튼의 활성/비활성화가 서버의 `adminAvailableActions`/`blockedReasons` 기반이다
- [ ] `/order/outbound-batches`, `/order/direct-ship` row에서 FO 상세 deep link가 있다

### storefront

- [ ] SO cancelled + refund 상태 조합에 따라 `REFUND_PENDING` / `REFUND_COMPLETE` / `CANCELLED`가 정확히 구분된다
- [ ] shipped FO가 있는 주문에서 고객 취소 API가 차단된다

---

## 5. 구현 순서 제약

```
Phase 1 (Core 보정)
  ├── FO split reservation 재분배 버그 수정          [필수 선행]
  ├── URL:id ↔ FOI 소속 검증 추가                    [필수 선행]
  ├── GET /fulfillments 필터 확장                     [Phase 4 선행]
  └── GET /fulfillments/:id 응답 확장                 [Phase 4 선행]
      │
Phase 2 (배송 이벤트 통합)
  ├── invoice direct/self ship → FulfillmentShipped  [Phase 6 선행]
  └── direct-ship complete → FulfillmentShipped      [Phase 6 선행]
      │
Phase 3 (admin-web client 정리)
  ├── /fulfillments canonical client                  [Phase 4 선행]
  └── FO hook stub 제거                               [Phase 4 선행]
      │
Phase 4A (admin-web FO 목록 read-only)
  └── /order/fulfillments 목록 + row deep link
      │
Phase 4B (admin-web FO 상세 read-only)
  └── /order/fulfillments/[id] 개요/items/reservations/batch/invoice/shipment
      │
Phase 4C (admin-web FO 재고 탭)
  └── check-availability/reserve/unreserve/transfer-reservation
      │
Phase 4D (admin-web FO 분할 탭)
  └── split + reservation 합계 검증
      │
Phase 4E (admin-web FO 배송 탭)
  └── assign-shipment/ship/deliver
      │
Phase 4F (admin-web FO 직배 탭)
  └── drop_ship forward/export/complete
      │
Phase 5 (기존 화면 연결)
  └── deep link 추가 (outbound-batches, direct-ship, reservations, transfers)
      │
Phase 6 (storefront/customer projection 회귀 검증)
  └── 고객용 availableActions/tracking 버튼 조건부 노출
```

---

## 6. 용어 정의 (이번 Sprint 한정)

| 용어 | 정의 |
|------|------|
| **재고 확인** | check-availability + 현재 reservation 목록 조회 |
| **재고 예약** | FOI 단위 reserve (POST /fulfillments/:id/reserve) |
| **예약 해제** | FOI 단위 unreserve (POST /fulfillments/:id/unreserve) |
| **예약 이전** | 같은 SKU FOI 간 transfer-reservation |
| **배치 할당** | FO를 outbound batch에 배정하는 작업. 재고 예약과 다른 의미 |
| **직배 전달** | directShipStatus=forwarded (공급사에 주문 전달 완료) |
| **직배 완료** | FO status=shipped/completed + directShipStatus=completed (고객 배송 완료 아님) |
| **출고 완료** | FO status=shipped (invoice shipped + FulfillmentShipped 이벤트 발행됨) |
| **배송 완료** | FO status=completed + SO status=delivered (고객 수령 확인) |
| **고객용 availableActions** | storefront 전용 액션. 예: cancel, track, return, exchange, receipt |
| **관리자용 adminAvailableActions** | admin-web FO 전용 액션. 예: split, reserve, unreserve, transferReservation, assignShipment, ship, deliver, forwardDropShip, completeDropShip |

---



