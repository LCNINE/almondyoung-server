# 작업 15 — SO 상태 결정: 저장 상태 최소 선언 + FO 기준 도출 (설계)

> 현황판: `docs/logistics-backend-hardening-2026-07.md` · 워크스트림 **WS-D** · 항목 **P1-7 · W10 + D2 · D3**
> 날짜: 2026-07-13 · 브랜치(예정): `feat/sales-order-status-derivation`

## 1. 배경과 문제

`sales_orders.status` enum 은 `pending / confirmed / processing / shipped / delivered / cancelled / timeout` 7개를 정의한다. 그러나 감사(P1-7)와 착수 재확인(2026-07-12), 그리고 본 설계의 코드 재조사 결과 **`processing / shipped / delivered` 세 값은 저장소 전역에서 writer 가 0개**다 — 도달 불가능한 dead 저장 상태다.

이로 인한 유일한 실 결함:
- `SalesOrdersService.getStats()` 의 `outboundComplete = byStatus('processing') + byStatus('shipped') + byStatus('delivered')` (`sales-orders.service.ts:831`) 가 **항상 0** 이다. admin-web 대시보드 "출고완료" 카드(`apps/admin-web/src/features/order/history/components/status-section/index.tsx:63`)가 늘 0을 표시한다.

부수적으로 ADR-0017(SO 상태 소유 서술)·ADR-0010(confirm 서술)이 현재 코드 현실과 어긋난 채 남아 있다(D2·D3).

**이 작업은 "결정 선행" 작업이다.** 두 방향 중 택일이 선행되어야 한다:
- **A**: 세 상태를 실제로 채운다(FulfillmentShipped 소비 또는 in-process 쓰기로 SO.status 전이 구현).
- **B**: 세 상태를 저장하지 않는다고 공식 선언하고, 출고완료 통계를 FO 기준으로 도출한다.

**본 설계는 B 로 확정한다.** (사용자 결정, 2026-07-13.)

## 2. 조사 결과 (결정의 근거 — 현재 코드 사실)

1. **표시 레이어는 이미 100% FO 기준으로 도출된다.** SO.status 는 SoT 가 아니다.
   - 고객 배송조회 `store-sales-orders.service.ts` `deriveOverallTrackingStatus()`(L1119-1132): `fulfillmentOrders.status` + `shippedAt` + 상자 상태로 `not_shipped / preparing / shipping / delivered` 를 도출.
   - 관리자/액션 뷰 `deriveFulfillmentStatus()`(L864-874): FO 행만 읽음.
   - SO.status 는 약한 OR-폴백으로만 등장(`|| so.status === 'shipped'` L546, `|| fulfillmentStatus === 'delivered'` L551).
   - 고객용 배송상태 표시 요구는 **이미 이 FO-도출 경로로 서빙된다**: `GET /store/orders/by-channel-order/:channelOrderId/tracking`(스토어프론트 전용) → `StoreOrderTrackingResponseDto.status`(`store-order-tracking.dto.ts:58`). 주문목록은 `POST /store/orders/by-channel-order/actions/batch`.

2. **SO ↔ FO 는 0..1 : 0..1** (ADR-0027 / CONTEXT.md L160-167). 디지털-only 주문은 FO 0개, 보상출고 FO 는 SO 미연결. 따라서 저장 `SO.status='shipped'` 는 모든 주문에 well-defined 하지 않다(디지털 주문은 영원히 도달 불가).

3. **core 는 자기 `fulfillments.events.v1` 을 구독하지 않는다.** `FulfillmentShipped`/`Delivered` 발행처는 core(`outbound-consumption.service.ts:149,193`·`fulfillments.service.ts:926,1011`)이나 소비자는 channel-adapter(송장 채널동기화) 1곳뿐. A안이면 새 in-process 쓰기 지점 또는 새 컨슈머가 필요.

4. **저장 상태를 채우면 두 번째 SoT 가 생긴다.** 표시가 FO 로 도출하는데 SO.status 도 같은 사실을 저장 → drift 위험. 이 스프린트의 단일-SoT 원칙(G3)·YAGNI 판례(작업 12, 구 8b)와 상충. A안이 주는 유일 실익(SO 단일 테이블 리포팅)은 현재 실 소비자가 없다.

→ B 가 표시 레이어의 이미-FO-도출 동작과 정합하고, 유일 실 결함을 최소 변경으로 해소하며, 스프린트 철학과 일관.

## 3. 설계 상세

스키마 변경 없음 · admin-web 코드 변경 없음(getStats 반환 shape 동일) · 새 컨슈머/이벤트 없음.

### 파트 1 — getStats FO 기준 재구현 (유일한 실 동작 변경)

`outboundComplete` 를 **표시 레이어와 동일한 출고 증거 정의**로 산출한다. 공유 정의:

```
shipped-evidence(fo) := fo.status IN ('shipped','completed') OR fo.shippedAt IS NOT NULL
```

이는 `deriveFulfillmentStatus`/`hasShippedEvidence` 가 쓰는 술어와 동일하다 → 통계 카드와 고객 화면이 구조적으로 어긋날 수 없다(단일 정의).

**Choice 2 (중첩/nested) 확정** — 두 카드는 disjoint 가 아니라 `완료 ⊆ 요청` 의 퍼널이다:
- `outboundRequested` = `byStatus('confirmed')` — **현행 유지**. 최근 14일 confirmed SO 총량(출고 대상 총량).
- `outboundComplete` = 최근 14일 confirmed SO 중 FO 가 shipped-evidence 를 가진 건수(도출).

Drizzle 쿼리(기존 `directShipRows`/`cannotShipRows` 패턴 미러, 같은 메서드 내 `this.db.db` read):

```typescript
const outboundCompleteRows = await db
  .select({ id: wmsTables.salesOrders.id })
  .from(wmsTables.salesOrders)
  .innerJoin(
    wmsTables.fulfillmentOrders,
    eq(wmsTables.fulfillmentOrders.salesOrderId, wmsTables.salesOrders.id),
  )
  .where(
    and(
      gte(wmsTables.salesOrders.orderDate, fourteenDaysAgo),
      eq(wmsTables.salesOrders.status, 'confirmed'),
      or(
        inArray(wmsTables.fulfillmentOrders.status, ['shipped', 'completed']),
        isNotNull(wmsTables.fulfillmentOrders.shippedAt),
      ),
    ),
  )
  .groupBy(wmsTables.salesOrders.id); // DISTINCT so.id — 미래 SO:다중 FO 이중계산 방지
// ...
outboundComplete: outboundCompleteRows.length,
```

의미 규칙:
- `status='confirmed'` 필터로 outboundRequested 아래에 **중첩**(완료 ⊆ 요청) 보장.
- "출고완료" = FO 가 **하나라도** 출고 증거를 가진 SO(=표시가 'shipped' 이상으로 보이는 주문). 표시 `deriveFulfillmentStatus` 의 shipped 분기(`active.some(...)`)와 동일 정의. 미래 다중 FO 의 "전량 출고" 세분화는 W5 시점 후속(비목표).
- 디지털-only(FO 0개)·미출고 confirmed 는 자연히 제외(INNER JOIN + 술어).

`todayCount / directShip / cannotShip / partialOutbound / waitingMatching` 은 **무변경**(전부 이미 FO 또는 confirmed 기준으로 정상 동작).

### 파트 2 — dead 저장 상태 공식 선언 (스키마 무변경)

1. **enum 마커 주석** — `orderStatusEnum`(`inventory.schema.ts:120-128`)의 `processing/shipped/delivered` 에 producer 0·SoT=FO·재사용 금지 마커를 붙인다(구 8b 판례: 물리 제거는 destructive·저가치라 의도적 비목표, 마커로 재사용 잠금). generate no-op(구조 무변경).

2. **`NON_CONFIRMABLE` 가드**(`sales-orders.service.ts:328`)의 `'shipped'/'delivered'/'processing'` 항목: 도달 불가하나 **방어적으로 존치 + 한 줄 주석**(미래 값 부활 대비 fail-safe). 동작 무변경.

3. **죽은 OR-폴백 제거** — B 의 "코드=현실" 원칙에 따라 `store-sales-orders.service.ts` 의 SO.status 도출 폴백을 정리(동작 무변경 순수 정리, 작업 5·9 dead-branch 삭제 판례):
   - L546 `else if (hasShippedEvidence || so.status === 'shipped' || so.status === 'delivered')` → `else if (hasShippedEvidence)`
   - L551 `const isDelivered = so.status === 'delivered' || fulfillmentStatus === 'delivered'` → `const isDelivered = fulfillmentStatus === 'delivered'`
   - 근거: 세 상태 producer 0 이 확정되어 두 폴백 항은 항상 false. `hasShippedEvidence`/`fulfillmentStatus` 는 FO 도출값이라 결과 불변.
   - (작업 14 는 이 파일을 건드리지 않음 — 겹침 0 확인.)

### 파트 3 — 문서 정정 (D2 · D3)

1. **D2 — ADR-0017** (`docs/adr/0017-order-status-action-matrix.md`):
   - 상태 레이어 표(L13)의 `sales_orders.status` 서술에 "`processing/shipped/delivered` 는 정의만 존재하고 producer 0 — 출고/배송 진실은 `fulfillmentOrders.status`+`shippedAt` 도출이 SoT" 를 명시.
   - L40 각주("FO 중 하나라도 shipped/completed 이면 SHIPPING 이상")를 각주가 아닌 **정식 도출 규칙**으로 승격 서술.
   - 표시 상태 정의 표(L22-38)의 `SHIPPING`/`DELIVERED` 행 조건을 "SO `shipped/delivered`" 가 아니라 "FO shipped-evidence / completed" 기준으로 정정.

2. **D3 — ADR-0010** (`docs/adr/0010-library-grant-trigger-on-order-created.md`) / **W10**:
   - `confirm()` 은 **FO 생성 트리거가 아님**을 명확화 — FO 생성은 `OrderCreated` 시점 backlog(`order-events.consumer.ts:103` → 백로그 워커)이며, `confirm()`(`sales-orders.service.ts:306-361`)은 매핑 스냅샷 생성 + row lock + `pending→confirmed` 전이만 수행(창고 배정≠FO 생성).
   - ADR-0010 은 이미 결제확정(OrderCreated) vs 출고확정(confirm) 을 구분하나, "출고 확정 = 이 SO 를 창고에 보내 처리한다"(L12) 서술이 FO 생성을 함의하는 오해를 남김 → confirm 이 FO 를 만들지 않음을 보강 서술.
   - CONTEXT.md W10 관련 서술은 이미 정확(L126-127 자동 전환 서술)이라 별도 수정 불요 — 현황판 W10/D3 를 완료 처리.

### 파트 4 — 테스트

`sales-orders.service.spec.ts`(또는 신규 getStats 유닛)에 회귀 가드:
- confirmed SO + FO(status='shipped') → `outboundComplete` 에 1 계상.
- confirmed SO + FO(shippedAt != null, status 임의) → 계상.
- confirmed SO + FO(status='picking') → 미계상.
- confirmed SO + **FO 없음**(디지털-only) → 미계상.
- `outboundComplete ≤ outboundRequested` 중첩 불변식.

dev DB 부재 시 통합은 deferred(`describeIfDb` skip) + isolatedModules-off tsc 타입체크 관행 준수.

## 4. 비목표 (명시)

- SO.status 에 출고/배송 전이를 **쓰지 않음**(A안 기각분).
- `processing/shipped/delivered` pgEnum 값의 물리적 제거(destructive) — 구 8b·작업 12 판례대로 비목표.
- SO ↔ 다중 FO 의 "전량 출고" 세분 집계 — W5(합배송/송장분할) 시점 후속.
- 반품/교환 workflow, ADR-0017 미구현 항목(표시상태 통합 문자열 API 등) — 범위 밖.
- admin-web 변경 — 없음(반환 shape 불변).

## 5. 변경 파일 목록

| 파일 | 변경 |
|------|------|
| `apps/core/src/modules/sales-order/services/sales-orders.service.ts` | getStats `outboundComplete` FO 기준 재구현 + NON_CONFIRMABLE 주석 |
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` | `orderStatusEnum` dead 값 3종 마커 주석 |
| `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts` | 죽은 SO.status OR-폴백 2곳 제거 |
| `apps/core/src/modules/sales-order/services/sales-orders.service.spec.ts` | getStats 회귀 가드(신규/보강) |
| `docs/adr/0017-order-status-action-matrix.md` | D2 정정 |
| `docs/adr/0010-library-grant-trigger-on-order-created.md` | D3 정정 |
| `docs/logistics-backend-hardening-2026-07.md` | 작업 15 완료 반영 + P1-7·W10·D2·D3 상태 갱신 |

## 6. 검증 체크리스트 (공통 규약)

- `nest build core` exit 0
- arch 경계 `inventory-write-boundary.arch.spec.ts` PASS(직접 INSERT 무관 — 영향 없음 확인)
- getStats 유닛 GREEN
- 변경 파일 **신규** eslint error 0 (repo 전역 lint debt 는 판정 대상 아님)
- admin-web 무변경(type-check 불요)
- 삭제 심볼(OR-폴백 조건) 저장소 참조 정합
- 스키마 무변경 → dev DB 의존 ⏸ 없음
