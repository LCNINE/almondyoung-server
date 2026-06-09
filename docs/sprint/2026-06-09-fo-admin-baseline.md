# Sprint FO/Admin-web 기준선 및 구현 검토 (2026-06-09)

> 목표: FO 분할, 재고할당 확인/할당/해제/이전, 직배(dropship), 배송 기능을 admin-web에서 실제 운영자가 사용할 수 있게 노출한다.
> Phase 0 기준선에서 시작했고, Phase 1-7 구현 후 현재 코드 기준으로 완료/잔여 리스크를 재정리한다.

---

## 1. 서비스 경계

| 소유자 | 책임 |
|--------|------|
| **Core** | FO 상태 전이, 재고 예약/해제/이전, 배송 상태, 출고 이벤트 발행의 SoT |
| **admin-web** | 운영 명령 UI. 상태 판단은 서버 응답 기반. 서버가 내려준 `adminAvailableActions`만 버튼 활성화 기준으로 사용 |
| **storefront** | Core store-facing action/tracking projection만 소비. FO 상태를 직접 계산하지 않음 |
| **channel-adapter** | Core 이벤트를 외부 채널/Medusa projection으로 반영 |
| **Medusa** | Medusa order는 Core `sales_orders`와 다른 정체성. `(salesChannel, channelOrderId)`로 참조 |
| **Wallet** | 취소/환불 후처리의 SoT. FO 상태의 SoT 아님 |

판단: 현재 구현 방향은 이 경계를 대체로 지킨다. 특히 출고/배송 이벤트는 Core에서 발행하고, admin-web은 API client/mutation을 통해 Core에 명령만 보낸다.

---

## 2. 구현 현황

### Phase 1 — Core FO 계약/정합성 보정

완료:
- `GET /fulfillments`에 `status`, `warehouseId`, `fulfillmentMode`, `salesOrderId`, `priority`, `limit`, `offset` 필터 추가
- `GET /fulfillments/:id`에 `items`, `reservations`, `batch`, `shipment`, `invoice`, `directShipStatus`, `adminAvailableActions`, `blockedReasons` 포함
- split reservation 재분배 버그 수정
- reserve/unreserve/transfer-reservation에서 URL FO id와 FOI 소속 FO id 검증 추가
- terminal/shipped evidence guard 추가

검토 메모:
- `adminAvailableActions` 계약은 admin-web 버튼 활성 기준으로 사용되고 있어 UI 방향은 맞다.
- 단, 서버 액션별 guard는 `ship()`까지 완전히 닫혀 있지 않다. 아래 "잔여 리스크" 참고.

### Phase 2 — 배송/직배 이벤트 전이 통합

완료:
- `invoice.service.ts`의 `markAsShipped()`가 FO 직접 업데이트 대신 `FulfillmentsService.ship()`로 위임
- goodsflow/direct/self invoice 출고가 같은 canonical ship path를 사용
- `direct-ship.service.ts`의 `markOrdersAsCompleted()`가 FO별 `ship()` 호출 후 `directShipStatus='completed'`를 업데이트
- `ship()`은 FO status, FOI shippedQty, shippedAt, reservation lifecycle, `FulfillmentShipped` outbox를 함께 처리
- `markDelivered()`는 FO `completed`, shipment tracking, `FulfillmentDelivered` outbox를 처리

검토 메모:
- "출고 완료"와 "배송 완료"의 의미 분리는 논리적으로 맞다.
- "직배 완료"는 고객 수령이 아니라 공급사 출고 완료로 처리하고 `FulfillmentDelivered`를 발행하지 않는 정책이 맞다.

### Phase 3 — admin-web API client/type 정리

완료:
- `fulfillmentsClient` 신규 추가: `GET/POST /fulfillments` canonical API 사용
- deprecated `POST /fulfillment-orders` 생성 경로 제거
- `useFulfillments`, `useFulfillment` stub 제거 및 실 API 연결
- FO 관련 DTO 타입 확장
- mutation invalidate 범위에 fulfillments/detail/outbound-batches/reservations/direct-ship 포함

남아도 되는 legacy 경로:
- 피킹/검수/아웃바운드 배치의 하위 URL에 포함된 `/fulfillment-orders`
- `PUT /fulfillment-orders/:id/priority`, legacy cancel/delete

### Phase 4 — admin-web FO 목록/상세/액션

완료:
- `/order/fulfillments` 목록 read-only 화면
- `/order/fulfillments/[id]` 상세 화면
- 상세 탭: overview, items, inventory, split, shipment, direct-ship, history
- 재고 탭: 가용성 확인, 예약, 해제, 이전 접근 가능
- 분할 탭: 미출고 수량 기준 분할 UI
- 배송 탭: 운송장 등록, 출고 완료, 배송 완료 접근 가능
- 직배 탭: `drop_ship` FO에서만 공급사 전달, CSV export, 공급사 출고 완료 접근 가능
- history 탭: Core outbox 이벤트 실데이터 + 상태 타임라인 표시. `GET /fulfillments/:id/outbox-events` 연결

검토 메모:
- 버튼 활성화는 `adminAvailableActions` 기반이라 의도와 맞다.
- history 탭의 "발행 완료"는 Core outbox → Kafka 전달까지이며, channel-adapter/Medusa projection 성공 여부는 별도 확인 필요.

### Phase 5 — 기존 화면 deep link 연결

완료:
- outbound-batches drawer FO 행 -> `/order/fulfillments/[fo.id]`
- FO 목록/상세 -> `/order/outbound-batches?batchId=...`
- `/order/outbound-batches?batchId=...` 진입 시 drawer 자동 오픈
- direct-ship order row -> `/order/fulfillments/[foId]`
- FO 목록/상세 -> `/order/direct-ship?foId=...`
- `/order/direct-ship?foId=...` 진입 시 orders 탭 자동 선택 및 해당 행 하이라이트
- inventory reservations의 `targetType=FULFILLMENT_ORDER` targetId -> FO 상세 링크

구조적으로 아직 연결하지 않은 화면:
- `/inventory/transfers` -> FO 상세: `TransferJobLineDto`에 `fulfillmentOrderId` 없음
- `/order/picking-list` -> FO 상세: 화면이 stub/hard-coded 성격
- `/order/inspection` -> FO 상세: 화면이 stub/hard-coded 성격

### Phase 6 — storefront/customer projection 검증

검토 결과:
- storefront는 `adminAvailableActions`를 쓰지 않고 Core store-facing `availableActions`만 사용한다.
- shipped evidence가 생기면 Core 고객 취소 차단 정책에 걸린다.
- 취소/환불 상태는 Wallet/Core business link 흐름과 분리되어 있으며 Phase 1-5 admin-web 변경과 직접 충돌하지 않는다.

### Phase 7 — 검증

이번 문서 업데이트 중 재검증:
- `yarn --cwd apps/admin-web type-check` 통과
- `yarn --cwd apps/admin-web build` 통과
- build warning은 기존 lint성 경고와 Phase 5의 `no-unused-expressions` 1건이며 빌드는 성공

붙여넣은 Phase 7 산출물 기준 검증:
- Core fulfillment 관련 focused tests 통과
- admin-web type-check/lint/build 통과로 보고됨

---

## 3. 현재 완료 판단

목표별 상태:

| 목표 | 상태 | 판단 |
|------|------|------|
| FO 목록/상세를 admin-web에서 조회 | 완료 | 실 API 연결 및 라우트 존재 |
| FO 분할 | 완료에 가까움 | UI/API 연결됨. shipped evidence guard 존재 |
| 재고 확인 | 완료 | 상세 재고 탭에서 check-availability 접근 가능 |
| 재고 예약 | 완료 | `POST /fulfillments/:id/reserve` 연결 |
| 재고 해제 | 완료 | `POST /fulfillments/:id/unreserve` 연결 |
| 예약 이전 | 완료 | `POST /fulfillments/:id/transfer-reservation` 연결 |
| 배송 운송장 등록 | 완료 | `assign-shipment` 연결 |
| 출고 완료 | 완료 | `ship()` 상태 guard + FOR UPDATE lock + DB unique constraint 추가 |
| 배송 완료 | 완료 | `markDelivered()`는 shipped 상태만 허용 |
| 직배 전달 | 완료 | `directShipStatus=pending/null` -> `forwarded` |
| 직배 공급사 출고 완료 | 완료 | `ship()` guard에 drop_ship forwarded 조건 포함 |
| 기존 운영 화면 deep link | 부분 완료 | outbound/direct/reservations 완료, transfers/picking/inspection은 구조상 미연결 |
| storefront 고객 액션 회귀 | 완료에 가까움 | admin 계약과 분리됨. shipped evidence로 고객 취소 차단 |

결론:
- admin-web에서 목표 기능은 운영자가 접근 가능한 수준까지 노출됐다.
- "완벽하게 완료"로 보기에는 `ship()` 서버 guard와 일부 화면의 실데이터/딥링크 미연결이 남아 있다.

---

## 4. 잔여 리스크 및 수정 필요

### ~~P1. `ship()` 서버 상태 guard 미완료~~ — 완료

`ship()` 내 상태 guard가 추가됐다 (services/fulfillments.service.ts):
- 이미 `shipped`: idempotent return
- `completed`/`canceled`: 409
- `drop_ship` + `directShipStatus !== 'forwarded'`: 409
- 일반 모드에서 `invoiced/labeled/picked/inspecting` 외: 409

### ~~P2. `assignShipment()` 상태/중복 guard 미완료~~ — 완료, 동시성 보강 포함

`assignShipment()` 내 guard 추가됐다:
- terminal 상태(`shipped/completed/canceled`): 409
- 동일 FO에 active shipment 존재: 409
- `picked/inspecting/invoiced`에서 상태 역전이 없음
- **FO row `FOR UPDATE` lock** 추가 — SELECT → INSERT 사이 race 차단
- **`shipments.fulfillmentOrderId` DB unique constraint** 추가 (`uq_shipments_fulfillment_order_id`) — 애플리케이션 우회 경우의 안전망

migration: `apps/core/drizzle/20260609063049_add-shipments-fo-unique-idx.sql`

### ~~P2. direct-ship 라벨 오해 가능성~~ — 완료

- `forwarded`: "공급사 전달", `completed`: "공급사 출고 완료" 로 수정됨

### ~~P2. history 탭 placeholder~~ — 완료

Core outbox 이벤트 실데이터 표시. "발행 완료"는 Kafka 전달까지이며 projection 성공은 별도 확인 필요임을 UI에 명시.

### P3. Picking/Inspection 화면 deep link — 다음 phase

현재 `/order/picking-list`, `/order/inspection`은 하드코딩 stub. picking 세션 데이터에 `fulfillmentOrderId`가 없어 deep link 추가 불가. 다음 phase에서 실데이터 연결과 함께 처리.

---



## 6. 다음 보강 순서 — 완료 (2026-06-09)

1. ✅ `ship()` 서버 상태 guard 추가 및 테스트
   - 이미 `shipped` → idempotent return (중복 호출 안전)
   - `completed`/`canceled` → 409 ConflictException
   - `drop_ship` + `directShipStatus !== 'forwarded'` → 409
   - 일반 모드는 `invoiced/labeled/picked/inspecting` 외 → 409
   - 테스트 9건 추가 (`ship guard` describe block), 전체 49개 통과

2. ✅ `assignShipment()` 상태/중복 shipment guard 추가
   - terminal 상태(`shipped/completed/canceled`) → 409
   - 동일 FO에 active shipment 존재 → 409 (update-in-place 엔드포인트 별도로 두는 정책)
   - `picked/inspecting/invoiced`에서 호출 시 상태 역전이 없이 shipment만 등록
   - `ready/created`에서만 `labeled`로 전이
   - 테스트 5건 추가 (`assignShipment guard` describe block)

3. ✅ direct-ship 목록 라벨/버튼 문구를 공급사 출고 의미로 정리
   - `forwarded`: "공급사 전달" (기존: "발송 중")
   - `completed`: "공급사 출고 완료" (기존: "완료")
   - forward-dialog/complete-dialog 제목·설명·버튼 전면 수정

4. ✅ picking/inspection 실데이터 연결 분석 — 연결 보류
   - `/order/picking-list`, `/order/inspection` 두 화면 모두 하드코딩된 fake 데이터 + API 연결 없음
   - stub 화면에 FO deep link를 추가하면 오히려 혼란 → 다음 phase에서 실데이터 연결과 함께 처리

5. ✅ history 탭을 outbox/inbox trace 기반 실제 운영 추적 UI로 교체
   - Core에 `GET /fulfillments/:id/outbox-events` 추가 (`aggregateType='fulfillment'`)
   - `FulfillmentOutboxEvent` 타입 + `fulfillmentsClient.getOutboxEvents()` + `useFulfillmentOutboxEvents` 훅 추가
   - history-tab.tsx: 상태 타임라인 + Core outbox 이벤트 테이블 (이벤트 타입, 상태 배지, 시도 수, 발행/재시도 시각)
   - 실패/재시도 이벤트 있으면 운영 Alert 노출
   - `yarn --cwd apps/admin-web type-check` 통과

### 잔여 작업

- picking/inspection 실데이터 연결 → 다음 phase에서 picking 세션에 `fulfillmentOrderId` 추가 후 deep link
- `/inventory/transfers` → FO 상세: `TransferJobLineDto`에 `fulfillmentOrderId` 없음, 다음 phase

