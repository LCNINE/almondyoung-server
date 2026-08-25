# 발주 라인 생명주기 설계 (#724 — 합의 3단계 중 2단계)

- 이슈: #724 (엄브렐러). 이 스펙은 **항목 4 + 신설 항목**을 함께 다룬다.
- 근거 문서: `docs/inventory-procurement-audit-2026-08.md`
- 1단계 기록: `docs/superpowers/plans/2026-08-25-remove-po-auto-confirm-cron.md`
- 마이그레이션: **additive 만** (expand phase → `migrate → deploy`)

## 1. 왜 이 설계인가

### 실무가 이렇다 (2026-08-25 확인)

1. 발주할 상품을 **발주예정(cart)** 에 모은다. cart 는 편의 장치이고 의미 있는 데이터가 아니다.
2. **발주서(PO)와 라인**이 만들어진다. 이 시점엔 아직 아무것도 주문하지 않았다.
3. 직원이(장차 AI 에이전트가) **라인을 하나씩 실제 발주 실행**한다. 그 순간:
   - **수량이 달라질 수 있다** (10개 요청 → 재고가 6개뿐이라 6개)
   - **단가가 그때 정해진다**
   - **도착예정일이 라인마다 다르다** (판매자·배송이 다르므로)
   - **아예 못 사는 라인이 생긴다** (품절·단종)
4. 한 라인을 나눠서 두 번 사는 일은 **없다.** 라인당 실행은 1회로 끝난다.

### 지금 모델은 이걸 담지 못한다

```
purchase_order_lines
  po_id | sku_id | quantity | unit_price | created_at
  PK = (po_id, sku_id)
```

| 필요 | 현재 |
|---|---|
| 라인 상태 (요청 / 발주됨 / 발주불가) | **없음** |
| 실발주 수량 (요청과 별개) | **없음** — `quantity` 한 벌 |
| 라인별 도착예정일 | **없음** — 헤더 `expected_arrival` 뿐 |
| 실행 시각·행위자 | **없음** |
| 단가 | `unit_price` nullable — **이미 실행 시점 확정을 전제한 모양** |

헤더 `status`(`created`/`confirmed`/`received`) 하나로 전부 아니면 전무다. "10개 라인 중 3개
발주 완료" 를 적을 곳이 없다.

### 핵심 통찰 — 라인은 *요청*, 실행은 *사실*

`purchase_order_lines.quantity` 는 **"이만큼 사고 싶다"** 이고, 실행 결과는 **"이만큼 샀다"** 다.
지금은 둘이 한 컬럼에 겹쳐 있어서, 6개만 산 순간 요청 기록이 사라진다. 두 축을 분리하는 것이
이 설계의 전부이고 나머지는 그 귀결이다.

## 2. 스키마 변경 (전부 additive)

### 2.1 `purchase_order_lines` — 실행 결과 컬럼

```ts
export const poLineStatusEnum = pgEnum('po_line_status', [
  'requested',    // 발주서에 적혔으나 아직 실행 안 됨
  'ordered',      // 실제로 발주함
  'unavailable',  // 품절·단종 등으로 끝내 발주 못 함 (종결)
]);

purchase_order_lines {
  // 기존
  poId, skuId, quantity /* 요청 수량 — 실행이 덮어쓰지 않는다 */, unitPrice, createdAt
  // 신설 (전부 nullable 또는 default 있음)
  status:          poLineStatusEnum.notNull().default('requested'),
  orderedQty:      integer('ordered_qty'),                       // 실발주 수량
  expectedArrival: date('expected_arrival', { mode: 'string' }), // 라인별 ETA
  orderedAt:       timestamp('ordered_at', { withTimezone: true }),
  orderedBy:       uuid('ordered_by'),
  unavailableReason: text('unavailable_reason'),
}
```

`quantity` 는 실행 시 **덮어쓰지 않는다** — 실행 결과는 `ordered_qty` 로 간다. 요청 10 / 실발주 6
이 둘 다 남아야 "왜 4개가 비었나" 를 나중에 답할 수 있다. 라인이 아직 `requested` 인 동안에는
`PUT /:id/lines` 로 `quantity` 를 고칠 수 있다 (그건 요청을 고치는 것이지 실행 기록이 아니다).

**PK 는 `(po_id, sku_id)` 그대로 둔다.** 분할 실행이 없으므로 surrogate id 가 필요 없고,
복합 PK 를 갈아엎는 것은 destructive 라 단계가 늘어난다. 라인 주소는 `(poId, skuId)` 다.
같은 PO 에 같은 SKU 가 두 라인으로 들어오는 것은 지금도 PK 가 막고 있다 (진단 문서 ⑩ 은
그 위반이 500 이 아니라 400 이어야 한다고 본다 — 항목 8).

**`expected_arrival` 은 `date` 이고 `mode: 'string'` 이다.** `timestamp` 가 아니라 `date` 인
이유는 이번 세션에서 값비싸게 배운 것이다: naive `timestamp` 에 달력 날짜를 넣으면
(a) drizzle 이 `toISOString()` 으로 보내 프로세스 TZ 에 따라 하루가 밀리고,
(b) `@IsDateString()` 이 `'2026-08-26T00:00:00+09:00'` 을 통과시켜 `'2026-08-25 15:00'` 으로
저장되며, (c) 읽는 쪽이 raw `sql` 로 `Date` 를 바인딩하면 드라이버가 터진다.
`date` + `mode:'string'` 이면 앱 경계 어디에도 `Date` 객체가 없어 **이 부류 전체가 구조적으로
사라진다.** DTO 검증도 `@Matches(/^\d{4}-\d{2}-\d{2}$/)` 로 정확해진다.

### 2.2 `inbound_plan_items` — 품목별 예정일

```ts
inbound_plan_items {
  // 신설
  expectedDate: date('expected_date', { mode: 'string' }),  // nullable
}
```

라인마다 ETA 가 다른데 `inbound_plans.expected_date` 는 **plan 단위**라 담을 수 없다.
**plan 을 쪼개는 것은 금지다** — `purchase-order-single-plan.integration.spec.ts` 가 지키는
"해외 발주는 계획 하나" 불변식이 깨지고, 그 스펙이 막으려던 입고예정 2배·이중계상이
되살아난다. 그래서 예정일을 아이템으로 내린다.

`inbound_plans.expected_date` 는 이 단계에서 **그대로 둔다.** 수동 계획 생성 경로와
admin-web 입고 대기 목록·기간 필터가 아직 그 컬럼을 쓴다. 파생으로 강등하거나 제거하는 것은
3단계(contract)다. 그 사이 두 벌이 갈라질 수 있으므로 **읽는 쪽이 아이템 우선으로 합의**한다
(§4).

### 2.3 백필

기존 행이 새 모델에서 거짓말하지 않게 한다.

```sql
-- 이미 확정/입고된 발주의 라인은 실제로 발주된 것이다
UPDATE purchase_order_lines l SET status = 'ordered', ordered_qty = l.quantity
  FROM purchase_orders p
 WHERE p.id = l.po_id AND p.status IN ('confirmed', 'received');
-- 라인 ETA 는 헤더에서 물려받는다 (헤더는 timestamp 라 날짜 부분만)
UPDATE purchase_order_lines l SET expected_arrival = p.expected_arrival::date
  FROM purchase_orders p
 WHERE p.id = l.po_id AND p.expected_arrival IS NOT NULL;
```

`created` 상태 PO 의 라인은 default `'requested'` 로 남는다 — 맞는 표현이다.

**백필은 계획을 만들지 않는다.** 이미 확정된 PO 는 계획이 이미 있다. 백필이 실행 경로를
타면 아이템이 두 벌 생긴다.

## 3. 선행 작업 — `inbound_plans` writer 단일화 (항목 4)

**이 작업 없이 2단계를 하면 지금보다 나빠진다.** 라인마다 계획에 붙이려면 발주 쪽이 입고
테이블을 반복해서 직접 써야 하고, 그게 진단 문서 ③ 이 지적한 결합을 더 굳힌다.

현재 writer 가 둘이다:

| writer | 위치 | 불변식 |
|---|---|---|
| 자동 | `createInboundPlanFromPO` (private, `purchase-order.service.ts:276`) | 해외 = source 계획 1개 (스펙이 고정) |
| 수동 | `InboundService.createInboundPlan` + `POST /inbound/plans` | **호출자가 planType/requiresTransfer/destination 을 그냥 넘김** |

할 일:

1. **불변식을 포트 안으로 옮긴다.** `createInboundPlan` 이 `linkedPurchaseOrderId` 로부터
   `sourceWarehouseId`/`destinationWarehouseId`/`requiresTransfer`/`planType` 을 **스스로 도출**한다.
   호출자가 넘기는 값은 무시하거나 거부한다. 그러면 수동 API 로도 이중계상 계획을 만들 수 없다.
2. `createInboundPlanFromPO` 를 삭제하고 `PurchaseOrderService` 가 포트를 호출한다.
3. `createInboundPlan` 의 `throw new Error('Purchase order not found')`(`inbound.service.ts:651`)
   를 `NotFoundError` 로 — 지금은 404 가 아니라 500 이다.
4. 신설: `ensurePlanForPurchaseOrder(poId, tx)` — 계획이 있으면 반환, 없으면 생성. 라인 실행이
   반복 호출하므로 멱등해야 한다.

`syncInboundPlanItems`(진단 문서 ④, 이미 받은 수량을 pending 으로 되살림)는 라인 실행 모델에서
**존재 이유가 사라진다** — 라인 단위로 아이템이 붙으므로 전체 재삽입이 없다. 함께 제거한다.

## 4. 실행 흐름

```
발주서 생성            → 라인 전부 requested. 계획 없음. 파이프라인에 안 보임. (맞는 동작)
라인 A 발주 실행       → ensurePlanForPurchaseOrder → 계획 생성(최초 1회)
                        → addInboundPlanItems(A: orderedQty, expectedArrival)
                        → 파이프라인 ①에 A 만큼 즉시 반영
라인 B 발주 실행       → 같은 계획에 B 아이템 추가
라인 C 발주불가        → 아이템 없음. 계획에 영향 없음.
전 라인 종결           → 헤더 status 파생값이 confirmed 로
```

**계획은 첫 실행에서 생긴다.** 발주서 생성 시점이 아니다 — 아직 아무것도 주문 안 했으니
입고 예정도 없다.

그때 만들어지는 계획의 `expected_date` 는 **헤더 `expected_arrival` 이 있으면 그 값**으로
채운다. 지금 `createInboundPlanFromPO` 가 하는 것과 같아서 admin-web 입고 대기 목록·기간
필터가 안 깨진다. 헤더 ETA 가 없으면 `NULL` 이고, 그 계획의 진실은 아이템 예정일이 소유한다.
이후 아이템이 추가돼도 계획 날짜는 **갱신하지 않는다** — 파생값 유지 로직을 여기서 만들면
3단계에서 지울 코드를 지금 쓰는 셈이다. 읽는 쪽은 §4 의 `COALESCE` 규칙으로 아이템을 우선한다.

### 파이프라인 ETA

`InboundPipelineReader.readOnOrder` 의 `min(plans.expectedDate)` 를
`min(COALESCE(items.expectedDate, plans.expectedDate))` 로 바꾼다. 아이템 예정일이 있으면
그것이 진실이고, 없으면(수동 생성 계획 등) 계획 예정일로 떨어진다.

`onOrderEta` 응답 타입은 `Date | null` 을 유지한다 — admin-web 이 이미 그렇게 읽는다.
`date` 컬럼을 문자열로 읽어 리더에서 `new Date(v)` 로 올린다. `'YYYY-MM-DD'` 는 UTC 자정으로
결정적으로 파싱되므로 TZ 함정이 없다.

## 5. API 표면

### 신설

```
POST /purchase-orders/:poId/lines/:skuId/order
  body: { orderedQty: number, unitPrice?: number, expectedArrival?: 'YYYY-MM-DD' }
  → 라인 status='ordered', 실행 정보 기록, 계획에 아이템 추가
  → 409 if status !== 'requested'  (재실행 금지 — 분할 실행 없음)

POST /purchase-orders/:poId/lines/:skuId/unavailable
  body: { reason?: string }
  → 라인 status='unavailable'
  → 409 if status !== 'requested'
```

`@User()` 를 실제로 넘겨 `ordered_by` 를 채운다. 진단 문서 ② 가 심사 API 에서 지적한
"행위자 미기록" 을 여기서 되풀이하지 않는다.

**멱등성**: 발주 쓰기에는 지금 멱등키가 없다(진단 문서 ⑧). 라인 실행은 상태 전이가
`requested → ordered` 단방향이고 재실행이 409 이므로 **자연 멱등**이다. 별도 키를 도입하지
않는다.

### 변경

- `PUT /:id/lines` (라인 일괄 수정) — `requested` 라인만 수정 가능. `ordered`/`unavailable`
  라인이 하나라도 있으면 그 라인은 건드리지 않는다. 지금은 `received` 만 막는다.
- `PUT /:id/status` — **이 단계에서는 그대로 둔다.** admin-web 이 아직 이 드롭다운을 쓰므로
  깨면 안 된다. `confirmed` 수동 설정 차단은 3단계(contract)다.
- 응답에 라인 상태가 실려야 한다. 현재 `PurchaseOrderResponse` 는 bare interface 라 Swagger
  스키마가 없고 `auditStatus` 도 빠져 있다(진단 문서 ⑤ = 항목 2). **항목 2 를 이 작업에 합친다** —
  어차피 응답 계약을 건드려야 하고, 두 번 건드리면 admin-web 이 두 번 따라와야 한다.

### 헤더 `status` 파생

| 라인 상태 | 헤더 |
|---|---|
| 하나라도 `requested` 남음 | `created` |
| 전부 `ordered` / `unavailable` | `confirmed` |
| 입고 완료 | `received` (기존 입고 경로가 소유 — 항목 7) |

컬럼은 **유지하되 라인 실행 시 계산해 갱신**한다. 파생값을 컬럼으로 두는 것이므로 진실은
라인이고 컬럼은 캐시다. 새 enum 값(`partially_ordered`)은 **넣지 않는다** — "부분" 은 라인이
이미 표현하고, enum 값 추가는 admin-web 선배포를 요구해 단계를 늘린다.

전 라인이 `unavailable` 인 발주가 `confirmed` 로 보이는 건 어색하지만 오늘보다 나쁘지 않다.
제대로 된 종결 상태는 항목 7 이 다룬다.

## 6. 배포 순서

**expand phase 이므로 `migrate → deploy`.** 컨벤션의 기본(`deploy → migrate`)과 반대다 —
새 컬럼을 읽고 쓰는 코드가 컬럼보다 먼저 뜨면 깨진다. 옛 태스크는 nullable 추가 컬럼을 무시하므로
먼저 migrate 해도 안전하다 (CLAUDE.md, ADR-0005 §5).

PR 분할:

| PR | 내용 | 마이그 |
|---|---|---|
| 1 | 항목 4 — writer 단일화 + `ensurePlanForPurchaseOrder` + `syncInboundPlanItems` 제거 | 0 |
| 2 | 스키마 additive + 백필 | **있음** |
| 3 | 라인 실행 API + 계획 접합 + 파이프라인 ETA + 응답 DTO화(항목 2) | 0 |
| 4 | admin-web — 라인 실행 UI, 상태 드롭다운 정리 | 0 |

**PR 4(admin-web)는 core PR 3 배포 후.** 새 엔드포인트가 없으면 화면이 404 를 받는다.

## 7. 테스트

단위 테스트로는 이 설계의 핵심이 하나도 안 잡힌다 — 전부 다중 테이블 상태 전이다.
**통합 스펙(`describeIfDb`)이 방어선이다.**

1. **부분 실행이 파이프라인에 정확히 반영된다** — 3라인 중 1개 실행(요청10/실발주6) →
   ①발주 잔량 = 6. 나머지 2라인은 안 셈.
2. **`unavailable` 은 세지 않는다** — 실행/불가 섞인 상태에서 ① = 실행분 합.
3. **계획은 첫 실행에서 한 번만 생긴다** — 라인 3개 순차 실행 후 `inbound_plans` 1행,
   `inbound_plan_items` 3행. (기존 single-plan 불변식과 같은 방향)
4. **재실행이 409** — `ordered` 라인 재실행 거부.
5. **라인별 ETA 가 ①의 eta 로 올라온다** — 서로 다른 ETA 3건 → `min`.
6. **백필이 기존 확정 발주를 깨지 않는다** — 마이그 전후로 ① 값이 같다.
7. **기존 `purchase-order-single-plan.integration.spec.ts` 가 계속 통과한다** (해외 발주 계획 1개).

⚠️ 이 통합 스펙들은 `DATABASE_URL` 이 없으면 CI 에서 skip 된다(저장소 관례). 즉 **CI 가
이 설계를 강제하지 못한다.** 로컬에서 `npm run test:core:integration:local` 로 반드시 돌리고,
PR 본문에 실행 결과를 붙인다.

## 8. 범위 밖

- **항목 3 (심사 워크플로) / D1** — 이 설계와 직교한다. 심사를 살리면 "발주서 전체 실행 허가"
  게이트가 되어 라인 실행의 선행 조건이 될 뿐, 라인 모델 자체는 안 바뀐다.
- **항목 6 (재주문 제안)** — `stock_summary_view.on_order_qty` 가 하드코딩 `0` 이라
  재주문 제안이 발주 잔량을 못 본다. 이 설계가 **진짜 on-order 를 계산 가능하게 만들지만**,
  뷰 수정은 별건이다.
- **항목 7 (종결·취소 상태)** — 전 라인 `unavailable` 인 발주의 올바른 종결 상태.
- **통화** (진단 문서 ⑨, D2) — 해외 발주인데 통화 필드가 없다. 라인 단가를 손대는 김에
  같이 하고 싶을 수 있으나, 기능 추가지 리팩터링이 아니다.
- **cart** — 편의 장치이므로 이 설계가 건드리지 않는다.

## 9. 확정된 결정 (2026-08-25)

**D-1 — `unavailable` 은 단방향 종결이다.** 품절이었던 품목이 나중에 재입고돼 다시 살 수
있게 돼도 그 라인을 되살리지 않는다. **새 발주서를 만든다.**

귀결:
- 라인 상태 전이는 `requested → ordered` 와 `requested → unavailable` 둘뿐이다. 역방향 없음.
- 두 발주서를 잇는 `superseded_by` 같은 링크는 **만들지 않는다.** 요구된 적 없고, 없어도
  이력은 온전하다 — 옛 발주서에 "10 요청 / 발주 불가", 새 발주서에 실제 구매가 남는다.
- 실행 API 두 개 모두 `status !== 'requested'` 면 409. 재실행·번복이 같은 규칙으로 막힌다.

**D-2 — 실발주 수량 0 은 거부한다.** `orderedQty` 는 `@IsInt() @Min(1)`. 0 은
`unavailable` 과 의미가 겹치므로 그쪽으로 보낸다 — 한 사실에 표현이 둘이면 조회하는 쪽이
매번 두 경우를 다 처리해야 하고, 언젠가 한쪽을 빠뜨린다.

귀결: "발주는 했는데 0개 받기로 했다" 는 표현 불가능한 상태가 된다. 의도한 것이다.
