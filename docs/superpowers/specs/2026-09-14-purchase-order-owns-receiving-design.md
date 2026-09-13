# 발주가 자기 수령을 소유하고, 현장 입고는 공통 커널이 한다

> 이 문서는 **설계**만 소유한다. 실행 계획은 `docs/superpowers/plans/` 로 따로 나간다.
> 이 작업의 이슈는 스펙 리뷰가 끝난 뒤 연다 — 열리면 이 줄을 이슈 링크로 바꾼다.
>
> 선행 문서: [ADR-0032](../../adr/0032-procurement-inbound-transfer-boundaries.md) (결정 1·4 를 대체한다) ·
> [항목 7 스펙](2026-08-27-purchase-order-closure-derivation-design.md) (파생 사슬을 대체한다) ·
> 진단 [`docs/inventory-procurement-audit-2026-08.md`](../../inventory-procurement-audit-2026-08.md) · #724 · #745
>
> 2026-09-13~14 세션의 논의로 확정했다. 결정마다 기각한 대안을 같이 적는다 — 다음 사람이
> 같은 대안을 다시 제안하지 않게.

## 1. 배경 — 무엇이 문제였나

「리테일팀에 발주를 안내해도 되나」를 감사하다가, 사용자 표면 문제와 별개로 **입고예정 구조에서
결함이 셋** 나왔다. 전부 코드를 읽어 확인했고 재현은 하지 않았다.

| # | 결함 | 근거 |
|---|---|---|
| ㄱ | **분할 발주의 두 번째 입고가 입고 대기 목록에서 사라진다.** A 라인을 실행·전량 입고해 계획이 닫힌 뒤 B 라인을 실행하면, `ensurePlanForPurchaseOrder` 가 상태를 보지 않고 닫힌 계획을 재사용하고(`inbound.service.ts:754-760`) 다시 열지 않는다. `GET /inbound/pending` 은 `pending` 계획만 본다(`:339`) | 코드 |
| ㄴ | **입고 뒤 남은 라인을 「불가」로 끝내면 발주가 「확정됨」에 영원히 머문다.** `markLineUnavailable` 은 헤더 재계산만 하고(`purchase-order.manager.ts:229`), 종결 판정(`closePlanIfDone`)은 입고 경로에서만 불린다. 입고가 있어 취소도 409 다 | 코드 |
| ㄷ | **당일 입고 취소가 닫힌 계획·「입고완료」 발주를 되돌리지 않는다.** 품목의 받은 수량만 복원한다(`inbound.service.ts:1249-1267`) | 코드 |

셋의 뿌리는 같다 — **정산이 입고 모듈에서 발주로 역류하는 3층 파생**(`items → plan → PO`)이고,
8월의 ABBA 교착(FK 암묵 락, 항목 7 스펙 §9)도 같은 경계에서 났다.

### 입고계획 헤더에는 당위성이 없었다

`inbound_plans` 의 필드를 하나씩 보면 스스로 가진 정보가 없다.

| 필드 | 실제 |
|---|---|
| `linked_purchase_order_id` | 발주와 1:1 (ADR-0032 결정 1) — 발주를 가리키는 포인터 |
| `warehouse_id` | 발주의 `source_warehouse_id` 와 같은 값 |
| `destination_warehouse_id` · `requires_transfer` | 발주에 같은 컬럼이 이미 있다 |
| `plan_type` · `parent_plan_id` | 폐기된 이중 입고 계획의 잔재 |
| `status` | 품목 상태의 캐시 — 결함 ㄱ·ㄴ 이 사는 곳 |

품목(`inbound_plan_items`)도 **실발주 라인과 1:1** 이고(라인은 한 번만 실행된다), `expected_qty`·`expected_date`
는 라인 값의 사본이다. 헤더가 생긴 이유는 중국 source 계획 → 부천 destination 계획을 잇던 시절의 구조이고,
ADR-0032 가 이중 계획을 폐기하면서 할 일이 사라졌는데 구조만 남았다. 이후 「발주당 계획 1개」 불변식이
그 잔재를 지키는 규칙이 됐고, #724 항목 9 는 그 규칙에 맞추려 예정일을 품목으로 내렸다(`inventory.schema.ts:2280-2281`).

### 「발주는 수령을 소유하지 않는다」도 결정이 아니었다

ADR-0032 결정 4 는 **호출 방향**만 정했다. 수령이 입고 모듈에 있는 것은 항목 5 분리 때 진단 문서가
「inbound ← 실행만 남음」으로 한 모듈 시절의 배치를 그대로 둔 결과다. 그 사이 창고간이동은 자기 문서가
출발·도착·수령을 모두 소유하는 독립 모듈(`warehouse-transfer/`)로 나왔다.

## 2. 결정 요약

| # | 결정 | 기각한 대안 |
|---|---|---|
| D1 | **입고계획 헤더와 품목을 모두 없앤다. 발주 라인이 곧 입고예정이다** | 헤더를 무시만 한다(마이그 0) — 헤더를 남기면 다음 사람이 다시 쓴다 · 헤더만 제거하고 품목은 입고 모듈에 둔다 — 수량·날짜 사본이 남는다 |
| D2 | **발주가 자기 수령(정산)을 소유한다** | 입고 모듈이 전부 소유 — 역류 경계가 결함 ㄱ·ㄴ·ㄷ 과 8월 교착을 낸 자리다 |
| D3 | **현장 입고 작업은 입고 모듈의 공통 커널이 한다.** 문서는 커널을 호출한다 | 문서마다 현장 작업을 복제(이동 지시서 모양) — 이미 이동 지시서 수령에 적치 대기·당일 취소·작업 로그가 없다(`ReceiveTransferInput.toLocationId`) |
| D4 | **단독 입고예정(발주 없는 입고예정)은 만들지 않는다.** 발주 없는 입고는 간편입고로 충분하다 | `po_id` nullable 로 열어두기 — 운영상 이중 계상·영구 미종결 위험만 생긴다 |
| D5 | **입고예정일은 발주 라인에 nullable 로 둔다. 정확도 향상은 후속 과제** | — |
| D6 | **셀메이트 입고예정 CSV import 를 삭제한다.** 날짜는 core 발주 입력으로만 들어온다 | import 를 새 구조로 옮기기 — 급하지 않고, 발주의 정본 결정(리테일팀 도입) 전에 셀메이트 경유 구조를 새 모델에 다시 새기는 셈 |
| D7 | **초과 수령은 거절한다.** 넘는 분량은 간편입고 | 허용 — 실무에서 초과 발송을 본 적이 없고, 거절하면 `received_qty ≤ ordered_qty` 를 DB 가 잠근다 |
| D8 | **기존 간편·전수·개별입고도 커널로 옮긴다** | 옮기지 않기 — 커널이 다섯 번째 사본이 된다 |
| D9 | **라인의 입고 진행은 enum 값이 아니라 카운터에서 파생한다** (§5) | `po_line_status` 에 `received`·`short_closed` 추가 — §5 참조 |

## 3. 입고 커널의 경계

현행 입고 모듈에는 「회차 생성 → 원장 `RECEIVE` → 회차 라인 → 합계 → 작업 로그」가 **네 벌** 복제돼 있다
(`inbound.service.ts:88-331` 간편·전수·개별, `:821-930` 예정 입고). 원장 조작 자체는 이미 한 층 아래
`InventoryCommandService` 에 있으므로, 커널이 새로 갖는 것은 **회차 층**이다.

| 커널(입고 모듈)이 한다 | 커널은 하지 않는다 → 문서가 한다 |
|---|---|
| 회차·회차 라인 생성 (창고, 입고 로케이션 — 비우면 입고기본존, 방식, SKU·수량·메모) | 예정 수량·받은 누계·종결 판단 |
| 도착의 원장 이벤트 작성 | 초과 수령 검증 |
| 사후 현장 처리: 적치 · 회송 · 당일 취소 · 메모 | 문서 행 잠금과 상태 전이 |
| 작업 로그 · 멱등 · 회차/로그/적치 대기 조회 | 발주·이동 테이블 import (의존은 **문서 → 커널** 한 방향) |

### 3.1 원장 이벤트는 커널이 쓴다

당일 취소가 원 이벤트를 역분개하고(`eventStore.reverseEvent`) 작업 로그가 이벤트를 가리키므로 도착 이벤트는
회차와 같은 자리에서 만든다. 도착 종류는 닫힌 집합이다 — **이번 범위는 외부 입고(`RECEIVE`, 재고 창조) 하나**.
이동 도착(`IN_TRANSFER → ON_HAND`)은 이동 지시서를 커널에 올리는 단계에서 추가한다.

### 3.2 출처 링크는 문서가 소유한다

- 회차 라인은 **어느 문서인지 모르고, 문서에 묶였다는 사실만** 안다 — `source` (`direct` | `purchase_order`).
- 연결은 조달 모듈의 링크 테이블 `purchase_order_receipt_lines` 가 든다(§4.2). DB FK 방향도 문서 → 커널이다.
- 이동 지시서의 `transfer_order_receipt_lines` 가 이미 이 모양이다 — 편입 시 그대로 링크 테이블이 된다.

### 3.3 정산을 바꾸는 사후 작업만 문서를 거친다

| 작업 | 경로 | 발주 정산 |
|---|---|---|
| 적치 | 커널 직행 | 영향 없음 |
| 회송 | 커널 직행 | **바꾸지 않는다** (현행 유지 — 돌려보내도 발주상으로는 받은 것이다) |
| 당일 취소 — `source = direct` | 커널 직행 (`POST /inbound/cancel`) | 해당 없음 |
| 당일 취소 — `source = purchase_order` | **조달 경유** (§6). 커널 라우트는 거절하고 출처 문서로 안내한다 | 받은 누계를 되돌리고 헤더를 재파생 |

## 4. 데이터 모델

### 4.1 `purchase_order_lines` (조달 소유)

추가:

| 컬럼 | 타입 | 뜻 |
|---|---|---|
| `received_qty` | `integer NOT NULL DEFAULT 0` | 받은 누계. **발주 행 잠금 안에서만** 갱신한다 |
| `closed_reason` | `text` | 잔량 포기 사유 |
| `closed_at` | `timestamptz` | 잔량 포기 시각 — **null 이 아니면 잔량 포기된 라인이다** |
| `closed_by` | `uuid` | 잔량 포기한 사람 |

제약:

```sql
-- 실발주 전에는 받을 수 없고, 실발주를 넘겨 받을 수 없다 (D7).
-- COALESCE 가 필요하다 — `received_qty <= NULL` 은 NULL 이고, CHECK 는 NULL 을 통과시킨다.
CHECK (received_qty >= 0 AND received_qty <= COALESCE(ordered_qty, 0))
-- 잔량 포기는 실발주된 라인에만 있다
CHECK (closed_at IS NULL OR status = 'ordered')
```

`expected_arrival` 은 그대로 두고 **입고예정일의 유일한 거처**가 된다(D5). 품목 사본이 사라지므로 발주 목록과
입고 대기가 다른 날짜를 말할 수 없다(8월 스모크 결함 A 의 부류).

### 4.2 `purchase_order_receipt_lines` (신규, 조달 소유)

| 컬럼 | 제약 |
|---|---|
| `po_id`, `sku_id` | → `purchase_order_lines (po_id, sku_id)` 복합 FK, `ON DELETE RESTRICT` |
| `receipt_line_id` | → `inbound_receipt_lines.id` FK, **UNIQUE** |
| `created_at` | |

수량은 복사하지 않는다 — 회차 라인의 `quantity`·`canceled_qty` 가 진실이다. 불변식
`received_qty = Σ(링크된 회차 라인 quantity − canceled_qty)` 는 통합 스펙이 고정한다(§12 #3).

### 4.3 `inbound_receipt_lines` (커널 소유)

- 추가: `source inbound_receipt_source NOT NULL DEFAULT 'direct'` — enum `('direct', 'purchase_order')` 을
  **처음부터 두 값으로** 만든다(§5.1 D9 의 enum 함정 회피).
- 삭제(PR-C): `plan_item_id`. `inbound_work_logs.plan_item_id` 도 삭제.
- 수령 방식 `inbound_method` 는 기존 `planned`(「입고예정검수 기반 실입고」)를 발주 입고에 그대로 쓴다. 문서 종류는
  `source` 가 들므로 enum 값을 늘리지 않는다.

### 4.4 삭제 (PR-C)

`inbound_plan_items` · `inbound_plans` · enum `plan_type` · 회차 라인과 작업 로그의 `plan_item_id` ·
`PurchaseOrderClosurePort`·`PurchaseOrderClosureAdapter`·`inbound-plan-closure.rules.ts`(코드는 PR-B 에서 삭제).

## 5. 상태 모델

### 5.1 라인 — 두 축

`status` 는 **주문 결정** 축으로 남긴다(`requested` / `ordered` / `unavailable`, enum 변경 없음).
**입고 진행**은 카운터에서 파생한다.

```
requested ──실행──▶ ordered ──┬── 입고 대기   received_qty < ordered_qty ∧ closed_at IS NULL
    │                         ├── 전량 입고   received_qty = ordered_qty
    └──불가──▶ unavailable    └── 잔량 포기   closed_at IS NOT NULL
```

- 부분 입고 = 입고 대기 ∧ `received_qty > 0`.
- **남은 수량(outstanding)** = `ordered` ∧ `closed_at IS NULL` ∧ `ordered_qty − received_qty > 0` 일 때의 그 차.
- 당일 수령 취소는 `received_qty` 를 줄이므로 「전량 입고」가 「입고 대기」로 자연히 돌아간다. 잔량 포기된 라인의
  수령을 취소해도 라인은 잔량 포기로 남는다(받은 수만 줄어든다).

**D9 — 왜 enum 값을 늘리지 않는가.** 3절 논의에서는 `po_line_status` 에 `received`·`short_closed` 를 추가하기로
했으나, 스펙을 쓰며 두 가지를 확인하고 바꿨다.

1. **마이그레이션이 깨진다.** drizzle 마이그레이터는 대기 중인 마이그레이션 전부를 **한 트랜잭션**으로 돈다
   (`drizzle-orm/pg-core/dialect.js` `migrate` 의 `session.transaction`). Postgres 는 `ALTER TYPE … ADD VALUE`
   로 추가한 값을 **그 트랜잭션이 커밋되기 전에는 쓸 수 없다.** 백필(§11)이 새 값을 쓰는 순간 실패한다.
   8/27 마이그레이션(`20260827005020`)이 `ADD VALUE` 와 백필을 한 파일에 담고도 돌았던 것은 백필이 **기존 값만**
   썼기 때문이다.
2. **정본이 둘이 된다.** `received` 상태와 `received_qty = ordered_qty` 는 같은 사실의 두 표현이라, 수령·취소마다
   둘을 맞춰야 하고 어긋날 수 있다. 카운터 파생은 어긋날 자리가 없다. 이동 지시서 라인도 상태 enum 없이
   수량 카운터로 정산한다.

### 5.2 헤더 — 조달 안의 함수 하나

| 헤더 | 조건 |
|---|---|
| `cancelled` | 사람의 결정. 모든 라인 `received_qty = 0` 일 때만 (현행 규칙 유지) — **유일한 고정 종결** |
| `created` | `requested` 라인이 하나라도 있다 |
| `received` | `requested` 0 ∧ `ordered` 라인 ≥ 1 ∧ 남은 수량 있는 라인 0 |
| `confirmed` | 그 외 — 받을 게 남았거나, 전 라인이 `unavailable` |

- 라인을 바꾸는 **모든** 조작(실행 · 불가 · 수령 · 수령 취소 · 잔량 포기)이 끝에서 이 함수를 부른다.
  파생 경로가 하나라 결함 ㄱ·ㄴ·ㄷ 이 설 자리가 없다.
- `received` 는 더 이상 고정 종결이 아니다 — 당일 수령 취소로 `confirmed` 로 돌아갈 수 있다.
- `received` 의 뜻은 ADR-0032 대로 **「출발 창고 입고 완료」**다. 한 가지 더 명시한다 — 실발주한 라인이 전부
  잔량 포기(받은 것 0 포함)여도 `received` 다. 즉 「입고완료」는 **「더 받을 것이 없다」**이다. 화면 문구는 이
  뜻을 드러내야 한다(범위 밖 — 묶음 2 에서 다룬다).
- 헤더 도착예정일 = **남은 수량이 있는 라인** 중 가장 이른 `expected_arrival`
  (`shared/dates/earliest-expected-date.ts` 의 `purchaseOrderExpectedArrival` 필터를 바꾼다).

## 6. API 표면

### 6.1 조달 (`purchase-order.controller.ts`)

| 조작 | 라우트 | 스코프 | 규칙 |
|---|---|---|---|
| **수령** | `POST /purchase-orders/:poId/receipts` | OPERATE | 한 회차에 여러 SKU. 멱등키 필수 |
| **수령 취소** | `POST /purchase-orders/receipt-lines/:receiptLineId/cancel` | OPERATE | 당일 · 전량 · 적치·회송 전. 발주 id 는 링크에서 찾는다 — 이력 화면은 회차 라인 id 만 안다 |
| **잔량 포기** | `POST /purchase-orders/:poId/lines/:skuId/short-close` | MANAGE | 남은 수량 > 0 인 라인. 받은 것 0 이어도 된다(공급처 미발송) |
| **예정일 수정** | `PATCH /purchase-orders/:poId/lines/:skuId/expected-arrival` | MANAGE | `requested`, 또는 남은 수량 > 0 인 `ordered`. `null` 로 비울 수 있다 |
| 생성·라인 수정·실행·불가·취소 | 기존 | MANAGE | 라인 수정(`PUT :id/lines`)이 재삽입에서 `expected_arrival` 을 누락하던 결함(`purchase-order.manager.ts:507-514`)을 같이 고친다 |

수령 요청:

```ts
{
  idempotencyKey: string;
  warehouseId: string;       // 요청한 현장의 창고. 발주 출발 창고와 달라야 할 이유가 없으므로 검증에만 쓴다
  locationId?: string;       // 비우면 입고기본존
  lines: { skuId: string; quantity: number /* int ≥ 1 */; memo?: string }[];
}
```

거절 — **한국어 메시지**(현장·MD 가 직접 읽는다):

| 조건 | 상태 | 문구 방향 |
|---|---|---|
| 요청 창고 ≠ 발주 출발 창고 | 400 | 「이 발주는 ○○창고에서 받습니다」 |
| 한 요청 안의 중복 SKU | 400 | 「같은 품목이 두 번 들어 있습니다」 |
| 발주가 `cancelled` | 409 | 「취소된 발주입니다」 |
| 라인이 `requested` / `unavailable` | 409 | 「아직 주문 전인 품목입니다」 / 「발주 불가로 종결된 품목입니다」 |
| 라인이 전량 입고 / 잔량 포기 | 409 | 「이미 전량 입고된 품목입니다」 / 「잔량 포기된 품목입니다」 |
| 수량 > 남은 수량 | 409 | 「남은 수량 N개를 넘습니다 — 넘는 분량은 간편입고로 받으세요」 |

### 6.2 커널 (`inbound.controllers.ts`)

- 유지: `simple` · `simple-fullscan` · `individual` · `putaway` · `return` · `cancel` · `lines/:lineId/memo` ·
  `verify-barcode` · 회차/로그/적치 대기 조회.
- `POST /inbound/cancel` 은 `source ≠ direct` 라인을 409 로 거절한다(「발주 입고는 발주에서 취소하세요」).
- 회차·이력 응답에서 `planItemId` 를 빼고 `source` 를 싣는다 — 화면이 취소 라우트를 고르는 근거다.
- **삭제**: `GET /inbound/pending` · `POST /inbound/plans/items` · `GET /inbound/plans/items` ·
  `POST /inbound/plans/receive` · `POST /inbound/plans/:planId/items/:itemId/close`.

### 6.3 중립 읽기 (`stock-projection.controller.ts`, `@Controller('inventory')`)

- 신규 `GET /inventory/expected-arrivals?warehouseId=` (OPERATE) — §9.

`inventory-scope-coverage.spec.ts` 배정표를 신규·삭제 라우트에 맞춘다.

## 7. 잠금과 멱등

### 7.1 불변식 — 하나로 통일

```
발주 행 (FOR UPDATE) → 발주 라인 (FOR UPDATE, sku_id 순) → 커널 (회차 라인 · 원장 advisory 락)
```

- **커널은 발주 행·라인을 절대 잠그지 않는다.** 역방향 간선이 없으므로 8월 교착의 부류가 생길 수 없다.
- 커널 단독 조작(적치 · 회송 · direct 취소)은 **회차 라인만** 잠근다.
- 곁들여 고친다: 현행 적치·회송·취소는 회차 라인을 잠그지 않고 읽는다(`inbound.service.ts:1050`·`:1125`·`:1192`
  의 `findFirst`). 적치와 취소가 동시에 들어오면 카운터 검증이 샌다 → 커널에서 `FOR UPDATE`.
- 발주 수령 취소: 발주 행 → 라인 → 커널 `cancelLine`(회차 라인 `FOR UPDATE`). 같은 회차 라인의 적치와는 회차 라인
  락에서만 만나므로 사이클이 없다.

### 7.2 멱등

- 발주 수령: `InventoryIdempotencyService.withIdempotency('purchase_order.receive', key, …)` 가 트랜잭션 전체를 감싼다.
  원장 이벤트 키는 커널이 `idempotencyKey` 를 뿌리로 라인 순번을 붙여 만든다(현행 간편입고와 같은 방식).
- 발주 수령 취소: `purchase_order.receipt.cancel`.
- 잔량 포기·예정일 수정: 재실행이 같은 결과이거나 409 인 자연 멱등 — 키를 두지 않는다(항목 7 의 잎 종결 선례).

## 8. 커널 인터페이스 (입고 모듈이 export)

```ts
recordArrival(tx: DbTx, input: {
  warehouseId: string;
  locationId?: string;                                   // 비우면 입고기본존
  method: 'simple' | 'simple_fullscan' | 'individual' | 'planned';
  source: 'direct' | 'purchase_order';
  reason: string;                                        // 원장 이벤트 reason (현행 값 보존)
  idempotencyKey: string;                                // 원장 이벤트 키의 뿌리
  lines: { skuId: string; quantity: number; memo?: string }[];
}): Promise<{ receiptId: string; lines: { receiptLineId: string; skuId: string; quantity: number }[] }>;

cancelLine(tx: DbTx, receiptLineId: string, expected: { source: 'direct' | 'purchase_order' }):
  Promise<{ skuId: string; quantity: number }>;
  // 라인의 source 가 expected.source 와 다르면 거절한다.
  // POST /inbound/cancel 은 'direct' 로만, 조달은 'purchase_order' 로만 부른다.
```

적치 · 회송 · 메모 · 조회는 커널 자신의 라우트로 둔다. 간편·전수·개별입고는 라우트·응답·원장 reason·멱등 스코프를
그대로 두고 내부만 `recordArrival` 호출로 바꾼다(D8).

## 9. 읽기 쪽

| 소비자 | 지금 | 바뀐 뒤 |
|---|---|---|
| **입고 대기 목록** | `GET /inbound/pending` (계획 헤더) | `GET /inventory/expected-arrivals?warehouseId=` — 발주별 묶음, 남은 수량이 있는 라인만. 항목마다 `source` 구분자(지금은 `purchase_order`). 이동 지시서가 커널에 올라오면 같은 목록에 합류한다 |
| 재고 VIEW `stock_summary_view.inbound_pending_qty` | 품목 JOIN 헤더 (`inventory.schema.ts` 의 `inbound_pending` 서브쿼리) | 발주 라인 남은 수량을 발주 `source_warehouse_id` 로 집계. VIEW 재생성 |
| 보충 제안 파이프라인 ①·전사 합계 (`inbound-pipeline.reader.ts` `readOnOrder`·`readOnOrderTotal`) | 품목 JOIN 헤더 | 발주 라인 남은 수량. ①의 비판매 창고 조건은 출발 창고에 건다 |
| 리드타임 집계 (`lead-time-profile.refresher.ts` `observeSuppliers`) | 헤더 → 품목 → 회차 라인 | 링크 테이블 → 회차 |
| 스토어프론트 입고예정일 (`apps/channel-adapter/scripts/sync-restock-to-medusa.ts`) | `ip.expected_date` — **8/26 컬럼 삭제로 이미 깨져 있다** | 남은 수량 있는 발주 라인의 `expected_arrival`, null 제외, `purchase_orders.type = 'foreign'` 이면 「대략」 |
| 발주 응답 | 라인 상태·실발주 | + `receivedQty` · `outstandingQty` · 입고 진행(대기/전량/잔량 포기) · `closedReason`. 헤더 도착예정일은 §5.2 |
| 회차·이력 응답 (커널) | `planItemId` | `source` |

입고 대기 reader 는 **중립 층**(`stock-projection`)에 둔다 — 여러 문서를 합칠 자리라 조달·입고 어느 쪽 안에도
두지 않는다. 조달 reader 를 import 한다(중립 → 문서, ADR-0032 결정 4 의 방향과 맞다).

## 10. 화면

### 10.1 창고 앱 (`native/warehouse-app/src/domains/inbound/`)

- 입고 화면(`PendingPlanListScreen`): 목록 원천을 `expected-arrivals` 로. 카드 = 발주(공급처 · 가장 이른 예정일 ·
  남은 수량). 「잔여 없는 카드 숨기기」 우회 필터는 서버가 해결하므로 지운다.
- 수령 화면(`PlanReceiveScreen`): 라우트 키 `planId` → `poId`. 스캔·탭 한 번 = `POST /purchase-orders/:poId/receipts`
  (lines 1개). 취소는 새 수령 취소 라우트.
- 간편입고 · 적치 대기: 라우트 동일, 변경 없음.
- 구버전 앱: `tauri.conf.json` 에 자동 업데이트가 없어 구버전이 남을 수 있다. 구버전의 예정 입고 화면은 404 가 나지만
  라이브에 예정 데이터가 없으므로 잃는 기능은 없다.

### 10.2 admin-web

- **발주 드로어 라인**: 「요청 7 → 실발주 5 · 받음 3 (남음 2) · 도착예정 9/20」. [예정일 수정](`requested` · 남은 수량 >
  0 인 `ordered`), [잔량 포기](남은 수량 > 0). 입고 진행 문구와 버튼 노출 조건은 `line-execution-model.ts` 의 순수
  함수로 둔다(컴포넌트 테스트 불가 — 판정은 `.ts` 에서).
- **발주 목록**: 「라인 진행」에 입고 진행 포함.
- **입고 관리 › 입고 대기 탭**: 목록을 `expected-arrivals` 로 교체. 드로어의 수령 → 발주 수령 라우트, 잔량 포기 → 발주
  잔량 포기 라우트. 「이중 입고 계획 — leg-1 상태」 등 잔재 표시 제거. **사무실에서 수령을 입력하는 경로는 유지**한다
  (창고 앱이 없는 곳 — 중국 창고 등).
- **입고 관리 › 이력 탭**: 라인 메뉴의 취소를 `source` 로 분기.

## 11. PR 구성 · 마이그레이션 · 배포 순서

### PR-A — 입고 커널 추출 (동작 보존)

- `recordArrival` · `cancelLine` 추출, 간편·전수·개별입고를 커널 호출로. 적치·회송·취소의 회차 라인 `FOR UPDATE`.
- 마이그레이션: enum `inbound_receipt_source ('direct','purchase_order')` 생성 + `inbound_receipt_lines.source` 추가
  (기본 `direct`). additive.
- 예정 입고 경로(`receiveFromPlan`·`closePlanItem`)는 **건드리지 않는다** — PR-B 에서 통째로 사라진다.
- 순서: **`migrate → deploy`**.
- 분리 이유: 라이브에서 쓰일 수 있는 경로의 리팩터링을 발주 재설계와 섞지 않는다 — diff 가 「동작이 안 바뀌었다」로만
  읽혀야 한다.

### PR-B — 발주가 수령을 소유 (expand + 코드 전환)

마이그레이션(생성 DDL + `drizzle-kit generate --custom` 백필 — 8/27 선례):

```sql
-- DDL (generate)
ALTER TABLE purchase_order_lines ADD COLUMN received_qty integer NOT NULL DEFAULT 0;
ALTER TABLE purchase_order_lines ADD COLUMN closed_reason text;
ALTER TABLE purchase_order_lines ADD COLUMN closed_at timestamptz;
ALTER TABLE purchase_order_lines ADD COLUMN closed_by uuid;
CREATE TABLE purchase_order_receipt_lines (
  po_id uuid NOT NULL,
  sku_id uuid NOT NULL,
  receipt_line_id uuid NOT NULL UNIQUE REFERENCES inbound_receipt_lines(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (po_id, sku_id) REFERENCES purchase_order_lines(po_id, sku_id) ON DELETE RESTRICT
);
-- stock_summary_view 재생성 (§9)

-- 백필 (custom). 옛 행이 없으면 전부 no-op 이다. 기존 enum 값만 쓴다(§5.1 D9).
-- ① 옛 품목 → 발주 라인 정산
UPDATE purchase_order_lines pol
SET received_qty  = ipi.received_qty,
    closed_reason = ipi.closed_reason,
    closed_at     = ipi.closed_at,
    closed_by     = ipi.closed_by
FROM inbound_plan_items ipi
JOIN inbound_plans ip ON ip.id = ipi.plan_id
WHERE pol.po_id = ip.linked_purchase_order_id AND pol.sku_id = ipi.sku_id;

-- ② 옛 회차 링크 → 링크 테이블 + source
INSERT INTO purchase_order_receipt_lines (po_id, sku_id, receipt_line_id)
SELECT ip.linked_purchase_order_id, ipi.sku_id, irl.id
FROM inbound_receipt_lines irl
JOIN inbound_plan_items ipi ON ipi.id = irl.plan_item_id
JOIN inbound_plans ip ON ip.id = ipi.plan_id;
UPDATE inbound_receipt_lines SET source = 'purchase_order' WHERE plan_item_id IS NOT NULL;

-- ③ 헤더를 새 규칙(§5.2)으로 재계산 — cancelled 는 건드리지 않는다
UPDATE purchase_orders po
SET status = CASE
  WHEN EXISTS (SELECT 1 FROM purchase_order_lines l
               WHERE l.po_id = po.id AND l.status = 'requested') THEN 'created'
  WHEN EXISTS (SELECT 1 FROM purchase_order_lines l
               WHERE l.po_id = po.id AND l.status = 'ordered')
   AND NOT EXISTS (SELECT 1 FROM purchase_order_lines l
                   WHERE l.po_id = po.id AND l.status = 'ordered'
                     AND l.closed_at IS NULL AND l.received_qty < l.ordered_qty) THEN 'received'
  ELSE 'confirmed'
END::po_status
WHERE po.status <> 'cancelled';

-- ④ 제약은 백필 뒤에 건다. 옛 모델은 초과 수령을 막지 않았으므로 위반 행이 있으면
--    여기서 요란하게 실패한다 — 조용히 잘라내지 않는다.
ALTER TABLE purchase_order_lines ADD CONSTRAINT ck_po_lines_received
  CHECK (received_qty >= 0 AND received_qty <= COALESCE(ordered_qty, 0));
ALTER TABLE purchase_order_lines ADD CONSTRAINT ck_po_lines_closed
  CHECK (closed_at IS NULL OR status = 'ordered');
```

코드: §6 의 라우트 · §5 의 파생 통합 · §9 의 읽기 전환 · 종결 포트·어댑터·옛 입고예정 코드 삭제 · admin-web · 창고 앱 ·
dev 시드(`scripts/local/seed-dev-core/inbound.ts`) · **셀메이트 import(`apps/core/scripts/import-inbound-plans.ts`) 삭제**.
옛 테이블은 남지만 아무도 읽고 쓰지 않는다.

순서: **`migrate → deploy`**. 롤링 중 옛 태스크가 옛 경로로 입고예정을 쓰면 새 모델에 반영되지 않지만, 라이브에 이
경로를 쓰는 데이터가 없다.

### PR-C — contract (PR-B 배포 완료 뒤)

- `schema.ts` 에서 삭제 → 생성 마이그레이션: `inbound_plan_items` · `inbound_plans` · enum `plan_type` DROP,
  `inbound_receipt_lines.plan_item_id` · `inbound_work_logs.plan_item_id` DROP COLUMN.
- 순서: **`deploy → migrate`**.
- **적용 전 확인 쿼리** — 셋 다 0행이어야 한다. §12 #13 의 스펙이 같은 쿼리를 쓴다.

```sql
-- (1) 옛 품목에 대응하는 발주 라인이 없다
SELECT ipi.id FROM inbound_plan_items ipi
JOIN inbound_plans ip ON ip.id = ipi.plan_id
LEFT JOIN purchase_order_lines pol ON pol.po_id = ip.linked_purchase_order_id AND pol.sku_id = ipi.sku_id
WHERE pol.po_id IS NULL;

-- (2) 옛 품목에 묶였던 회차 라인 중 링크로 옮겨지지 않은 것
SELECT irl.id FROM inbound_receipt_lines irl
LEFT JOIN purchase_order_receipt_lines porl ON porl.receipt_line_id = irl.id
WHERE irl.plan_item_id IS NOT NULL AND porl.receipt_line_id IS NULL;

-- (3) 받은 누계 ≠ 링크된 회차 라인 합 (§4.2 불변식 — 옛 행과 새 행 모두에 성립해야 한다)
SELECT pol.po_id, pol.sku_id FROM purchase_order_lines pol
LEFT JOIN purchase_order_receipt_lines porl ON porl.po_id = pol.po_id AND porl.sku_id = pol.sku_id
LEFT JOIN inbound_receipt_lines irl ON irl.id = porl.receipt_line_id
GROUP BY pol.po_id, pol.sku_id, pol.received_qty
HAVING pol.received_qty <> COALESCE(SUM(irl.quantity - irl.canceled_qty), 0);
```

### 공통 주의

- `db:generate` 는 사람 머신에서 돈다 — 서브에이전트는 못 돌린다.
- SST 한 스택이라 core·admin-web 배포에 순서가 없다. 위 `migrate`/`deploy` 순서는 운영자가 지키는 규율이다(CLAUDE.md).
- 통합 러너는 `core`, `apps/core/.env` 는 `dev_core` 를 본다 — 스모크 전에 마이그레이션을 **양쪽에** 적용한다.

## 12. 테스트와 검증

| # | 잠그는 것 | 수단 |
|---|---|---|
| 1 | 헤더 파생 규칙(네 상태 · `cancelled` 고정 · `received → confirmed` 역행 · 전부 잔량 포기 = `received`) | 순수 함수 단위 스펙 (`closure.rules` 두 벌 대체) |
| 2 | **결함 ㄱ·ㄴ·ㄷ 회귀** — ㄱ A 실행·전량 입고 → B 실행 → B 가 입고 대기에 뜬다 · ㄴ A 입고 뒤 B 불가 → `received` · ㄷ `received` 발주의 수령 당일 취소 → `confirmed` + 목록 재등장 | 실 DB 통합 |
| 3 | 수령 한 번 = 회차 1 + 원장 `RECEIVE` + 링크 + `received_qty`; 파리티 `received_qty = Σ(링크 회차 라인 − 취소)` | 통합 |
| 4 | 초과 수령 409 **+ DB CHECK 가 직접 UPDATE 를 거절** | 통합 |
| 5 | §6.1 거절 표의 상태·문구 | 통합 |
| 6 | 동시성 — 같은 라인 동시 수령 두 건(합계 초과 불가) · 수령 vs 잔량 포기 · 수령 vs 라인 실행 · 적치 vs 취소. **40P01 없음 + 결과 정합** | 격리 DB · 커넥션 둘 (항목 7 교착 재현 방식) |
| 7 | 멱등 — 같은 키 재시도 = 회차 1개 | 통합 |
| 8 | **읽기 파리티** — 입고 대기 잔량 = VIEW `inbound_pending_qty` = 파이프라인 ①·전사; 헤더 도착예정일 = 목록 예정일 | 통합 |
| 9 | 커널 경계 — 커널 소스의 조달·이동 import 0 · `/inbound/cancel` 이 `source ≠ direct` 거절 | arch 스펙(`inventory-write-boundary.arch.spec.ts` 선례) + 통합 |
| 10 | PR-A 동작 보존 — 기존 간편·전수·개별·멱등·당일 취소 스펙이 **수정 없이** 통과 | 기존 스펙 |
| 11 | 라우트 표면 | `inventory-scope-coverage.spec.ts` |
| 12 | 스토어프론트 동기화 SQL 이 실제 DB 에서 돈다 (컬럼 삭제로 조용히 깨지는 부류) | 통합에서 SQL 1회 실행 |
| 13 | 백필 — **옛 모델 시드가 든 `dev_core`** 에 PR-B 마이그레이션 적용 → §11 PR-C 확인 쿼리 3종 0행 | 수동 + 쿼리 |
| 14 | admin-web 입고 진행 문구 · 버튼 노출 조건 | `line-execution-model.spec.ts` (순수 `.ts`) |
| 15 | 창고 앱 입고 대기 목록 · 수령 화면 | 기존 화면 테스트 갱신 |

**대체·삭제하는 기존 스펙**: `purchase-order-single-plan` · `purchase-order-closure`(어댑터) · `inbound-plan-port-invariant` ·
`inbound-plan-concurrent-create` · `inbound.service.cancel-plan-restore` · `inbound.service.plan-receive` ·
`inbound-plan-closure.rules`. 살아남는 불변식(이중 계상 없음 · 중복 실행 없음)은 #2·#3·#7 로 옮긴다.

**증거로 인정하는 것**

- `npm run type-check` 0 · `npx jest --maxWorkers=2` 0 · `cd apps/admin-web && npx tsc --noEmit` 0 · 창고 앱 테스트.
- `npm run test:core:integration:local` 결과를 PR 본문에 붙인다 — CI 는 DB 스펙을 skip 한다. develop 기준선 대비 새 실패 0.
- **dev 스모크(브라우저 + 창고 앱) 필수** — 이 도메인의 과거 결함 넷 중 셋이 게이트 사각지대였고 admin-web 화면 배선은
  어떤 게이트도 보지 않는다. 시나리오: 발주 생성 → 두 라인 분할 실행 → 앱에서 A 수령 → B 목록 등장 → B 부분 수령 →
  잔량 포기 → 「입고완료」 → 당일 취소로 「확정됨」 복귀 → 초과 수령 거절 문구 → 예정일 수정이 목록·동기화 dry-run 에
  반영. ⚠️ 스모크 전 core 를 **직접 재시작**한다(`--watch` 가 실제 프로세스에 안 붙은 전력).

## 13. 문서 · 이슈 갱신

- **ADR-0039 신설** — 「문서가 수령 정산을 소유하고, 현장 입고는 공통 커널이 한다」. ADR-0032 결정 1·4 대체, 결정 2·3
  유지. 기각 대안은 §2 표. (번호는 착수 시 `ls docs/adr` 로 재확인 — 이 저장소는 번호 충돌 전력이 있다.)
- **ADR-0032** — 대체된 결정 1·4 에 표시.
- **#724 본문** — 닫는 조건 2 의 「`items → plan → PO` 파생」 문장을 이 모델로 교정.
- **#745 본문** — 항목 6(`parentPlanId` drop)이 PR-C 에 흡수됐다고 표시.
- **런북** `docs/runbooks/selmate-stock-pipeline.md` — ① import 삭제, ③ 동기화 원천 변경.
- 이 작업의 이슈를 열고 이 문서 머리의 자리표시 줄을 링크로 바꾼다.

## 14. 범위 밖

| 항목 | 어디로 |
|---|---|
| 이동 지시서의 커널 편입 + 이동 화면(선적 · 도착 · ETA · 미도착) — 지금은 보충 제안에서 초안 생성만 화면이 있다 | 별도 단계. **해외 흐름을 끝까지 운영하려면 선행돼야 한다** |
| 입고예정일 정확도(해외 → 한국 도착 리드타임) | 후속 과제 (D5) |
| 회송이 발주 정산을 바꾸는 것 | 필요가 생기면 |
| 「입고완료」 화면 문구가 「출발 창고 · 더 받을 것 없음」을 드러내는 것 | 사용자 표면 묶음 |
| 발주 헤더의 창고 컬럼 중복 · `audit_status` 잔재 · `inbound_status`/`inbound_method` 의 죽은 값 | 정리 이슈 |
| #745 나머지(멱등 · 카트 유니크 · 중복 SKU 500 · N+1) | #745 |
| 목록 건수·검색 · SKU 피커 · 한국어 DTO 메시지 전반 · MD 역할 · 발주서/통화/주문 채널 필드 · 운영 매뉴얼 | 리테일 준비도 논의의 묶음 2~5 |

## 15. 확인하지 못한 사실

- **라이브 행 수** — `inbound_plans`·`inbound_plan_items`·`purchase_orders`·`inbound_receipt_lines.plan_item_id` 가 비어
  있는지 이번 세션에 재지 못했다(라이브 읽기가 거절됐다). 방증: 8/26 기준 `purchase_orders` 0행(#724), 스토어프론트 동기화가
  8/26 부터 깨져 있음. 설계는 **행이 있어도 옮기고 없으면 no-op** 이 되게 짰으므로 결론은 바뀌지 않는다 — 다만 PR-C 전
  확인 쿼리는 반드시 돌린다.
- **간편·전수·개별입고의 라이브 사용 여부** — 모른다. PR-A 를 따로 떼는 이유다.
