# 발주가 자기 수령을 소유하고, 현장 입고는 공통 커널이 한다

> 이 문서는 **설계**만 소유한다. 실행 계획은 `docs/superpowers/plans/` 로 따로 나간다.
> 추적 이슈: [#871](https://github.com/LCNINE/almondyoung-server/issues/871) · PR-B: [#872](https://github.com/LCNINE/almondyoung-server/pull/872).
>
> 선행 문서: [ADR-0032](../../adr/0032-procurement-inbound-transfer-boundaries.md) (결정 1·4 를 대체한다) ·
> [항목 7 스펙](2026-08-27-purchase-order-closure-derivation-design.md) (파생 사슬을 대체한다) ·
> 진단 [`docs/inventory-procurement-audit-2026-08.md`](../../inventory-procurement-audit-2026-08.md) · #724 · #745
>
> 2026-09-13~14 세션의 논의로 확정했다. 결정마다 기각한 대안을 같이 적는다 — 다음 사람이
> 같은 대안을 다시 제안하지 않게. 2026-09-14 1차 리뷰(Standards·Spec 두 축)를 반영했다.
>
> ⚠️ **이 문서의 코드 좌표(`파일:줄`)는 `9e8dff7e4` 기준이다.** PR-A 가 `inbound.service.ts` 를 크게 바꾸므로
> 그 뒤로는 줄 번호가 낡는다 — 심볼 이름으로 찾을 것.

## 1. 배경 — 무엇이 문제였나

「리테일팀에 발주를 안내해도 되나」를 감사하다가, 사용자 표면 문제와 별개로 **입고예정 구조에서
결함이 셋** 나왔다. 전부 코드를 읽어 확인했고 재현은 하지 않았다.

| # | 결함 | 근거 |
|---|---|---|
| ㄱ | **분할 발주의 두 번째 입고가 입고 대기 목록에서 사라진다.** A 라인을 실행·전량 입고해 계획이 닫힌 뒤 B 라인을 실행하면, `ensurePlanForPurchaseOrder` 가 상태를 보지 않고 닫힌 계획을 재사용하고(`inbound.service.ts:754-760`) 다시 열지 않는다. `GET /inbound/pending` 은 `pending` 계획만 본다(`:339`) | 코드 |
| ㄴ | **입고 뒤 남은 라인을 「불가」로 끝내면 발주가 「확정됨」에 영원히 머문다.** `markLineUnavailable` 은 헤더 재계산만 하고(`purchase-order.manager.ts:229`), 종결 판정(`closePlanIfDone`)은 입고 모듈의 두 경로 — 수령(`inbound.service.ts:907`)과 잎 종결(`:988`) — 에서만 불린다. 조달 쪽 라인 종결은 그 판정을 부르지 않는다. 입고가 있어 취소도 409 다 | 코드 |
| ㄷ | **당일 입고 취소가 닫힌 계획·「입고완료」 발주를 되돌리지 않는다.** 품목의 받은 수량과 품목 status 는 복원하지만(`inbound.service.ts:1249-1267`, status 는 `:1263`), 계획 헤더와 발주 헤더는 그대로다 | 코드 |

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

ADR-0032 결정 4 는 **호출 방향**(조달 → 입고 포트 둘)과 **파생 방향**(`items → plan → PO` 단방향, 역방향 호출 없음,
`0032:66`)을 정했다. **수령을 어느 모듈이 가질지는 논하지 않았다.** 수령이 입고 모듈에 있는 것은 항목 5 분리 때 진단 문서가
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
| D10 | **`received` 에서 나가는 길은 당일 수령 취소 하나다.** 라인 수정·실행·불가·발주 취소·예정일 수정은 `received`·`cancelled` 에서 막는다 | `received` 발주에 요청 라인을 넣어 `created` 로 되돌리기 — 종결된 발주에 요청 라인을 되살리는 셈(현행 드로어 주석의 결정) |
| D11 | **`isTerminal` 을 지우고 술어 둘로 나눈다** — 편집 관문 `acceptsChanges` · 파생 동결 `isDerivationFrozen` (§5.3) | `isTerminal` 의 뜻만 `cancelled` 로 좁히기 — 옛 뜻으로 쓴 호출이 컴파일을 통과한 채 조용히 틀어진다 |

## 3. 입고 커널의 경계

현행 입고 모듈에는 「저널(`stock_journals`, `sourceType='inbound'`) → 회차 → 원장 `RECEIVE` → 회차 라인 → 합계 →
작업 로그」가 **네 벌** 복제돼 있다(`inbound.service.ts:88-331` 간편·전수·개별, `:821-930` 예정 입고). 원장 조작
자체는 이미 한 층 아래 `InventoryCommandService` 에 있으므로, 커널이 새로 갖는 것은 **저널·회차 층**이다.

| 커널(입고 모듈)이 한다 | 커널은 하지 않는다 → 문서가 한다 |
|---|---|
| 저널·회차·회차 라인 생성 (창고, 입고 로케이션 — 비우면 입고기본존, 방식, SKU·수량·메모) | 예정 수량·받은 누계·종결 판단 |
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
- 이동 지시서의 `transfer_order_receipt_lines` 가 문서 쪽 수령 행이라는 점에서 같은 자리다. 다만 그 테이블은
  `received_qty`·`lost_qty`·`receive_event_id`·`lost_event_id`·`to_location_id` 를 **자체로 들고 있다** — 편입 시
  수령분 컬럼은 커널 회차 라인으로 이관하고 분실분(`lost_*`, 원장 SCRAP)만 문서에 남기는 이관이 필요하다.
  「그대로 링크 테이블이 된다」가 아니다.

### 3.3 정산을 바꾸는 사후 작업만 문서를 거친다

| 작업 | 경로 | 발주 정산 |
|---|---|---|
| 적치 | 커널 직행 | 영향 없음 |
| 회송 | 커널 직행 | **바꾸지 않는다** (현행 유지 — 돌려보내도 발주상으로는 받은 것이다) |
| 당일 취소 — `source = direct` | 커널 직행 (`POST /inbound/cancel`) | 해당 없음 |
| 당일 취소 — `source = purchase_order` | **조달 경유** (§6). 커널 라우트로 들어오면 거절하고 출처 문서로 안내한다 | 받은 누계를 되돌리고 헤더를 재파생 |

source 검증은 **커널 `cancelLine` 한 곳**에만 산다(§8). 라우트는 자기가 다룰 source 를 인자로 넘기기만 한다.

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
-- 실발주 수량은 실발주된 라인에만, 그리고 반드시 있다. 지금은 코드 주석뿐인 규칙이다
-- (`purchase_order_lines.ordered_qty` 주석). 이게 없으면 남은 수량 계산의 `received_qty < ordered_qty`
-- 가 NULL 로 평가돼 「받을 게 없음」으로 오판된다 — 백필 ③·헤더 파생·파이프라인이 전부 그 식을 쓴다.
CHECK ((status = 'ordered') = (ordered_qty IS NOT NULL))
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
- ⚠️ 그러면 `inbound_receipts.method = 'planned'` 와 `inbound_receipt_lines.source = 'purchase_order'` 가 **같은 사실을
  두 축으로** 가리킨다. 두 컬럼이 다른 테이블에 있어 DB CHECK 로 묶을 수 없으므로, **두 컬럼을 쓰는 곳을 커널 하나로
  한정하고 커널 입력을 판별 유니온으로 받는다**(§8). 어긋난 조합은 타입이 막는다. 이동 지시서 편입 때(도착도 예정
  입고다) 두 축의 관계를 다시 정한다.

### 4.4 삭제 (PR-C)

`inbound_plan_items` · `inbound_plans` · enum `plan_type` · 회차 라인과 작업 로그의 `plan_item_id` ·
`PurchaseOrderClosurePort`·`PurchaseOrderClosureAdapter`·`inbound-plan-closure.rules.ts`·`purchase-order-closure.rules.ts`
(→ `purchase-order-status.rules.ts` 로 대체, §5.3)·admin-web `isTerminalPoStatus` (코드는 PR-B 에서 삭제).

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
| `cancelled` | 사람의 결정(§5.3 관문). **유일한 고정 종결** |
| `created` | `requested` 라인이 하나라도 있다 |
| `received` | `requested` 0 ∧ `ordered` 라인 ≥ 1 ∧ 남은 수량 있는 라인 0 |
| `confirmed` | 그 외 — 받을 게 남았거나, 전 라인이 `unavailable` |

- 라인을 바꾸는 **모든** 조작(실행 · 불가 · 수령 · 수령 취소 · 잔량 포기)이 끝에서 이 함수를 부른다.
  파생 경로가 하나라 결함 ㄱ·ㄴ·ㄷ 이 설 자리가 없다.
- `received` 는 더 이상 고정 종결이 아니다 — 당일 수령 취소로 `confirmed` 로 돌아갈 수 있다. **그것이 `received` 에서
  나가는 유일한 길이다**(D10). `received` 발주는 라인 수정·실행을 받지 않으므로 요청 라인이 생겨 `created` 로
  되돌아가는 경로는 없다.
- `received` 의 뜻은 ADR-0032 대로 **「출발 창고 입고 완료」**다. 한 가지 더 명시한다 — 실발주한 라인이 전부
  잔량 포기(받은 것 0 포함)여도 `received` 다. 즉 「입고완료」는 **「더 받을 것이 없다」**이다. 화면 문구는 이
  뜻을 드러내야 한다(범위 밖 — 묶음 2 에서 다룬다).
- 헤더 도착예정일 = **남은 수량이 있는 라인** 중 가장 이른 `expected_arrival`
  (`shared/dates/earliest-expected-date.ts` 의 `purchaseOrderExpectedArrival` 필터를 바꾼다).

### 5.3 상태 관문 — 술어 둘 (D11)

현행 `isTerminal`(`purchase-order-closure.rules.ts:8`, 호출 `purchase-order.manager.ts:254`·`:369`·`:422`·`:488`)과
admin-web 거울 `isTerminalPoStatus`(`line-execution-model.ts:57`)는 **두 뜻**으로 쓰인다 — 편집 금지와 파생 동결.
지금은 두 집합이 우연히 `{received, cancelled}` 로 같아서 버텼지만, 이 설계에서 갈라진다.

| 뜻 | 새 집합 |
|---|---|
| 편집 금지 | `received`, `cancelled` |
| 파생 동결 | `cancelled` 만 |

**`isTerminal` 과 `isTerminalPoStatus` 를 지운다 — 뜻만 바꿔 재정의하지 않는다.** 같은 이름에 뜻만 좁히면 옛 뜻을
전제로 쓴 호출(진행 중 브랜치·주석)이 컴파일을 통과한 채 조용히 틀어진다. 지우면 타입체커가 호출 지점을 전부
나열하고 지점마다 둘 중 하나를 고르게 한다. `cancelled` 만 남는 쪽을 상태 기계 용어로 `isTerminal` 이라 부르는 게
정확하긴 하지만, 바로 그 이유로 이름을 재사용하지 않는다.

목적으로 이름 붙이고 **exhaustive 표**로 정의한다 — 상태값이 늘면 두 표 모두 컴파일 에러로 결정을 강제한다(8/27
라벨 맵 사고의 교훈). 서버(`procurement/services/purchase-order-status.rules.ts` — 헤더 파생 함수와 같은 파일)와
admin-web(`line-execution-model.ts`)에 **같은 표를 각자** 둔다(트리마다 별칭 해석이 달라 공유 패키지를 쓰지 않는 선례).

```ts
/** 편집 관문 — 라인 수정 · 라인 실행 · 불가 · 발주 취소 · 예정일 수정 */
const ACCEPTS_CHANGES: Record<PurchaseOrderStatus, boolean> =
  { created: true, confirmed: true, received: false, cancelled: false };
export const acceptsChanges = (s: PurchaseOrderStatus) => ACCEPTS_CHANGES[s];

/** 파생 동결 — 헤더 파생 함수가 손대지 않는 상태 */
const DERIVATION_FROZEN: Record<PurchaseOrderStatus, boolean> =
  { created: false, confirmed: false, received: false, cancelled: true };
export const isDerivationFrozen = (s: PurchaseOrderStatus) => DERIVATION_FROZEN[s];
```

조작마다 어느 관문을 쓰는지 — **두 술어 어디에도 걸리면 안 되는 조작이 있어서** 표로 박는다.

| 조작 | 헤더 관문 | 라인 수준 검사 |
|---|---|---|
| 라인 수정 · 실행 · 불가 | `acceptsChanges` | `requested` 인가 |
| 발주 취소 | `acceptsChanges` | 모든 라인 `received_qty = 0` |
| 예정일 수정 | `acceptsChanges` | `requested` 이거나 남은 수량 > 0 |
| 수령 · 잔량 포기 | 없음 — `cancelled` 면 문구용 409 만 | 남은 수량 > 0 |
| **수령 취소** | **없음** — `received` 에서 나가는 유일한 길이라 막으면 안 된다 | 커널이 당일·전량·적치·회송 전 검사 |
| 헤더 파생 | `isDerivationFrozen` | — |

**발주 취소 규칙은 의미가 바뀌지 않는다.** 현행도 회차 존재가 아니라 `inbound_plan_items.received_qty > 0` 을
본다(`purchase-order.manager.ts:268-273`). 당일 취소가 그 수량을 되돌리므로 **현행도 입고를 전부 당일 취소한 발주는
취소할 수 있다.** 새 규칙(모든 라인 `received_qty = 0`)은 같은 뜻이다. 그 경우 취소된 회차의 링크 행은 **이력으로
남는다**(발주·회차 삭제 경로가 없으므로 `RESTRICT` 가 막을 일은 없다). 곁들여, 현행 취소는 계획·품목을 잠그지 않아
경합을 주석으로 감수했는데(`:262-267`) 새 모델에서는 취소도 발주 행 → 라인 순으로 잠그므로 그 경합이 사라진다.

admin-web 이득: 현행 `canCancel` 은 「부분 입고된 발주를 화면이 걸러내지 못해 사용자가 409 를 만난다」는 한계를
주석에 적고 있다(`line-execution-model.ts:67-72`). 새 응답은 라인에 `receivedQty` 를 실으므로
`canCancel = acceptsChanges(status) && lines.every(l => l.receivedQty === 0)` 로 서버와 같은 판정을 한다.

## 6. API 표면

### 6.1 조달 (`purchase-order.controller.ts`)

| 조작 | 라우트 | 스코프 | 규칙 |
|---|---|---|---|
| **수령** | `POST /purchase-orders/:poId/receipts` | OPERATE | 한 회차에 여러 SKU. 멱등키 필수 |
| **수령 취소** | `POST /purchase-orders/receipt-lines/:receiptLineId/cancel` | OPERATE | 당일 · 전량 · 적치·회송 전. 발주 id 는 링크에서 찾는다 — 이력 화면은 회차 라인 id 만 안다 |
| **잔량 포기** | `POST /purchase-orders/:poId/lines/:skuId/short-close` | MANAGE | 남은 수량 > 0 인 라인. 받은 것 0 이어도 된다(공급처 미발송) |
| **예정일 수정** | `PATCH /purchase-orders/:poId/lines/:skuId/expected-arrival` | MANAGE | `requested`, 또는 남은 수량 > 0 인 `ordered`. `null` 로 비울 수 있다 |
| 생성·라인 수정·실행·불가·취소 | 기존 | MANAGE | 라인 수정(`PUT :id/lines`)이 `expected_arrival` 을 잃던 결함을 같이 고친다 — **DTO 와 Manager 둘 다**다. `UpdatePurchaseOrderLineDto` 에 필드 자체가 없고(`purchase-order.dto.ts:74-89`) 재삽입(`purchase-order.manager.ts:514-521`)도 싣지 않는다 |

수령 요청:

```ts
{
  idempotencyKey: string;
  warehouseId: string;       // 요청한 현장의 창고. 발주 출발 창고와 달라야 할 이유가 없으므로 검증에만 쓴다
  locationId?: string;       // 비우면 입고기본존
  lines: { skuId: string; quantity: number /* int ≥ 1 */; memo?: string }[];
}
```

거절 — **한국어 메시지**(현장·MD 가 직접 읽는다). 검증은 **층을 나눈다**(CLAUDE.md 계층 규약): DB 를 보지 않는
형태 검증은 DTO(class-validator), DB 를 보는 검증은 **Manager 에서 `@app/shared` 도메인 예외**로. 컨트롤러는 검증하지
않고 위임만 한다.

| 조건 | 층 | 상태 | 문구 방향 |
|---|---|---|---|
| 수량이 1 이상 정수가 아님 · 라인 0개 | DTO | 400 | 「수량은 1 이상이어야 합니다」 등 |
| 한 요청 안의 중복 SKU | DTO | 400 | 「같은 품목이 두 번 들어 있습니다」 |
| 요청 창고 ≠ 발주 출발 창고 | Manager | 400 (`BadRequestError`) | 「이 발주는 ○○창고에서 받습니다」 |
| 발주가 `cancelled` | Manager | 409 (`ConflictError`) | 「취소된 발주입니다」 |
| 라인이 `requested` / `unavailable` | Manager | 409 | 「아직 주문 전인 품목입니다」 / 「발주 불가로 종결된 품목입니다」 |
| 라인이 전량 입고 / 잔량 포기 | Manager | 409 | 「이미 전량 입고된 품목입니다」 / 「잔량 포기된 품목입니다」 |
| 수량 > 남은 수량 | Manager | 409 | 「남은 수량 N개를 넘습니다 — 넘는 분량은 간편입고로 받으세요」 |

### 6.2 커널 (`inbound.controllers.ts`)

- 유지: `simple` · `simple-fullscan` · `individual` · `putaway` · `return` · `cancel` · `lines/:lineId/memo` ·
  `verify-barcode` · 회차/로그/적치 대기 조회.
- `POST /inbound/cancel` 은 `cancelLine(…, { source: 'direct' })` 를 부르기만 한다. `source ≠ direct` 라인의 409
  (「발주 입고는 발주에서 취소하세요」)는 **커널이 낸다** — 라우트에 따로 검증을 두지 않는다. 이 409 는 **PR-B 부터**
  생긴다(§11 PR-A 창 참조).
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
  의 `tx.query.…findFirst`). 적치와 취소가 동시에 들어오면 카운터 검증이 샌다 → 커널에서
  `trx.select().from().where().for('update')`. `db.query.*` 는 CLAUDE.md Inventory 규칙이 금지한 API 이기도 하다.
- 발주 수령 취소: 발주 행 → 라인 → 커널 `cancelLine`(회차 라인 `FOR UPDATE`). 같은 회차 라인의 적치와는 회차 라인
  락에서만 만나므로 사이클이 없다.

**FK 가 거는 암묵 락도 센다** — 8/27 교착은 명시적 `FOR UPDATE` 만 세고 FK 검사의 `FOR KEY SHARE` 를 안 세서
났다(항목 7 스펙 §9).

- 링크 행 insert 가 거는 `FOR KEY SHARE` 의 대상은 둘뿐이다: **같은 트랜잭션이 이미 `FOR UPDATE` 로 잡은 발주 라인**과
  **같은 트랜잭션이 방금 만든 회차 라인**(커밋 전이라 다른 트랜잭션에 보이지 않는다). 새 대기 간선이 생기지 않는다.
- 커널의 회차 라인 insert 가 부모 회차·SKU·로케이션에 거는 `FOR KEY SHARE` 는 현행 간편입고와 같다 — 새로 생기는
  간선이 아니다.
- 수령 취소가 회차 라인에 거는 `NO KEY UPDATE`(수량 카운터 UPDATE)는 링크 행의 FK 가 요구하는 `KEY SHARE` 와 충돌하지
  않는다 — 다만 이건 절반만 맞다. 커널의 `cancelLine`(및 `putaway`·`returnLine`)은 그 전에 이미 회차 라인에
  **명시적 `FOR UPDATE`** 를 걸어 두는데, 이건 `KEY SHARE` 와 충돌한다. 그런데도 새 대기 간선이 안 생기는 이유는
  따로 있다: 링크 행 insert 는 **회차 라인을 만든 바로 그 트랜잭션 안에서만** 일어난다(다른 트랜잭션이 이미
  존재하는 회차 라인을 링크 행의 FK 로 참조·삽입하는 경로가 없다) — 그래서 `FOR UPDATE` 를 쥔 트랜잭션과 링크
  insert 의 `KEY SHARE` 가 서로 다른 트랜잭션으로 갈라져 대기하는 상황 자체가 생기지 않는다.

### 7.2 멱등

- 발주 수령: `InventoryIdempotencyService.withIdempotency('purchase_order.receive', key, …)` 가 트랜잭션 전체를 감싼다.
  원장 이벤트 키는 커널이 `idempotencyKey` 를 뿌리로 라인 순번을 붙여 만든다(현행 간편입고와 같은 방식).
- 발주 수령 취소: `purchase_order.receipt.cancel`.
- 잔량 포기·예정일 수정: 재실행이 같은 결과이거나 409 인 자연 멱등 — 키를 두지 않는다(항목 7 의 잎 종결 선례).

## 8. 커널 인터페이스 (입고 모듈이 export)

```ts
/** 출처가 방식을 정한다 — method·source 를 따로 받으면 어긋난 조합을 막을 곳이 없다(§4.3). */
type ArrivalOrigin =
  | { source: 'direct'; method: 'simple' | 'simple_fullscan' | 'individual' }
  | { source: 'purchase_order' };                          // 커널이 method='planned' 로 기록한다

recordArrival(
  input: ArrivalOrigin & {
    warehouseId: string;
    locationId?: string;                                   // 비우면 입고기본존
    reason: string;                                        // 원장 이벤트 reason (현행 값 보존)
    idempotencyKey: string;                                // 원장 이벤트 키의 뿌리
    lines: { skuId: string; quantity: number; memo?: string }[];
  },
  tx: DbTx,
): Promise<{ receiptId: string; lines: { receiptLineId: string; skuId: string; quantity: number }[] }>;

cancelLine(
  receiptLineId: string,
  expected: { source: 'direct' | 'purchase_order' },
  tx: DbTx,
): Promise<{ skuId: string; quantity: number }>;
// 라인의 source 가 expected.source 와 다르면 거절한다 — source 검증은 여기 한 곳뿐이다.
// POST /inbound/cancel 은 'direct' 로만, 조달은 'purchase_order' 로만 부른다.
```

> **PR-A 실제 시그니처.** 위 스케치는 그대로 두고, PR-A 가 실제로 낸 모양만 여기 적는다 — PR-B 계획은
> 스케치가 아니라 이 실제 코드를 근거로 쓴다.
>
> - `recordArrival(input: { source: 'direct'; method; warehouseId; locationId?; reason; lines: { skuId;
>   quantity; memo?; eventKey }[] }, tx) → { receipt; lines }` — 원장 이벤트 키를 커널이 뿌리+순번으로
>   합성하는 대신, **라인별 `eventKey` 를 호출자가 그대로 넘긴다.** 개별입고의 현행 키
>   `inbound.individual:${key}` 에는 순번이 없어(간편입고의 `:${i}` 와 다르다) 스케치의 "뿌리 하나 +
>   커널이 순번을 붙이는" 방식으로는 보존할 수 없었다. 반환도 스케치의 id 요약이 아니라 **행 전체**다 —
>   기존 응답이 행 전체를 돌려줬기 때문이다.
> - `cancelLine({ receiptLineId, quantity? }, tx) → 잠근 시점의 라인` — source 가드와 `expected` 파라미터는
>   아직 없다(PR-A 창에서는 source 검사를 켜지 않는다, Global Constraints). PR-B 가 추가한다.
> - `putaway({ receiptLineId, toLocationId, quantity, eventKey }, tx): Promise<void>`
> - `returnLine({ receiptLineId, quantity, reason?, eventKey }, tx): Promise<void>`

**`tx` 는 마지막 인자이고 필수다 — CLAUDE.md Transaction Propagation 규약(«Public methods: `tx?: DbTx` as last
param»)의 예외로 둔다.** 이유: 커널은 **항상 호출자의 트랜잭션 안에서만** 돌아야 한다. 선택 인자면 호출자가 빠뜨렸을 때
커널이 제 트랜잭션을 따로 열어, 원장·회차는 커밋되고 문서 정산은 롤백되는 식으로 **원자성이 조용히 깨진다.** 필수로
두면 그 실수가 컴파일 에러다. 선례: `PurchaseOrderClosurePort.onPlanClosed(poId, tx: DbTx)` — 같은 이유로 필수·마지막
인자였다. 커널은 `DbService` 로 트랜잭션을 열지 않는다(`dbService.run` 미사용).

간편·전수·개별입고는 라우트·응답·원장 reason·멱등 스코프를 그대로 두고, 이미 열려 있는
`withIdempotency(…, async (tx) => …)` 안에서 `recordArrival(…, tx)` 를 부르도록 내부만 바꾼다(D8). 적치 · 회송 · 메모 ·
조회는 커널 자신의 라우트로 둔다.

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
  (기본 `direct`). additive. `CREATE TYPE` 은 같은 트랜잭션 안에서 바로 쓸 수 있으므로(§5.1 D9 의 함정은 `ADD VALUE`
  에만 해당) PR-A·PR-B 마이그레이션이 한 번의 `migrate` 로 같이 돌아도 안전하다.
- 예정 입고 경로(`receiveFromPlan`·`closePlanItem`)는 **건드리지 않는다** — PR-B 에서 통째로 사라진다.
- **「동작 보존」의 범위를 명시한다**: 라우트·요청·응답·원장 이벤트·멱등 스코프·에러 코드가 보존 대상이다. 내부 조회
  API 는 바뀐다 — 적치·회송·취소가 `tx.query.…findFirst`(금지 API)에서 `select … for('update')` 로 간다. 동시 요청의
  카운터 검증이 새지 않게 되는 것은 의도한 **동작 강화**다.
- **PR-A → PR-B 창의 공백**: PR-A 동안 옛 `receiveFromPlan` 은 `source` 를 안 채우므로 발주 입고 회차 라인도
  `source='direct'`(기본값)로 쌓인다. 그래서 커널 `cancelLine` 의 source 가드는 **PR-B 에서 켠다** — PR-A 에서 켜면
  옛 예정 입고의 당일 취소가 거절된다. PR-A 동안 `/inbound/cancel` 은 현행대로 품목 수량·상태를 복원한다
  (`inbound.service.ts:1249-1267` 보존). 그 기간에 쌓인 회차 라인의 `source` 는 PR-B 백필 ② 가 `plan_item_id` 로
  바로잡는다.
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

-- ⓪ 가드 — 백필이 결정적이지 않은 데이터면 요란하게 멈춘다.
--    `inbound_plan_items` 에는 (plan_id, sku_id) UNIQUE 가 없고, `inbound_plans.linked_purchase_order_id` 도 UNIQUE 가
--    아니다. `ensurePlanForPurchaseOrder` 주석(`inbound.service.ts:736-740`)이 「과거 이중계획 사고 탓에 라이브에 PO
--    하나에 계획이 둘 붙은 행이 남아 있을 수 있다」고 적는다. 그런 데이터에서 ① 의 UPDATE … FROM 은 다중 매치 중
--    임의 행을 채택하고 ② 는 양쪽 회차를 모두 링크해 §4.2 불변식을 즉시 깬다. 합산으로 우회하면 옛 destination
--    계획의 수령을 이중으로 센다(ADR-0032 결정 1 의 사고). 그래서 자동 해석하지 않고 사람에게 넘긴다.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM inbound_plan_items ipi JOIN inbound_plans ip ON ip.id = ipi.plan_id
    GROUP BY ip.linked_purchase_order_id, ipi.sku_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'backfill guard: 한 발주·SKU 에 입고예정 품목이 둘 이상이다 — 사전 확인 쿼리 (P1) 로 행을 보고 사람이 정리할 것';
  END IF;
  IF EXISTS (SELECT 1 FROM inbound_plans WHERE plan_type = 'destination') THEN
    RAISE EXCEPTION 'backfill guard: destination 계획이 남아 있다 — 사전 확인 쿼리 (P2) 로 행을 보고 사람이 정리할 것';
  END IF;
  IF EXISTS (SELECT 1 FROM purchase_order_lines WHERE (status = 'ordered') <> (ordered_qty IS NOT NULL)) THEN
    RAISE EXCEPTION 'backfill guard: status 와 ordered_qty 가 어긋난 발주 라인이 있다 — 사전 확인 쿼리 (P3)';
  END IF;
END $$;

-- ① 옛 품목 → 발주 라인 정산 (⓪ 이 다중 매치를 막았으므로 결정적이다)
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
                     AND l.closed_at IS NULL
                     -- COALESCE: ordered_qty 가 NULL 이면 `<` 가 NULL 이 되어 「받을 게 없음」으로 오판한다.
                     -- ⓪ 가드가 그런 행을 막지만, 식 자체도 NULL 에 안전하게 쓴다.
                     AND l.received_qty < COALESCE(l.ordered_qty, 0)) THEN 'received'
  ELSE 'confirmed'
END::po_status
WHERE po.status <> 'cancelled';

-- ④ 제약은 백필 뒤에 건다. 옛 모델은 초과 수령을 막지 않았으므로 위반 행이 있으면
--    여기서 요란하게 실패한다 — 조용히 잘라내지 않는다.
ALTER TABLE purchase_order_lines ADD CONSTRAINT ck_po_lines_received
  CHECK (received_qty >= 0 AND received_qty <= COALESCE(ordered_qty, 0));
ALTER TABLE purchase_order_lines ADD CONSTRAINT ck_po_lines_closed
  CHECK (closed_at IS NULL OR status = 'ordered');
ALTER TABLE purchase_order_lines ADD CONSTRAINT ck_po_lines_ordered_qty
  CHECK ((status = 'ordered') = (ordered_qty IS NOT NULL));
```

**PR-B 마이그레이션 전 사전 확인 쿼리** — 셋 다 0행이면 ⓪ 가드를 통과한다. 0행이 아니면 migrate 전에 사람이 행을
보고 정리한다(가드가 멈추기 전에 알 수 있게).

```sql
-- (P1) 한 발주·SKU 에 품목이 둘 이상
SELECT ip.linked_purchase_order_id, ipi.sku_id, count(*)
FROM inbound_plan_items ipi JOIN inbound_plans ip ON ip.id = ipi.plan_id
GROUP BY 1, 2 HAVING count(*) > 1;
-- (P2) 옛 destination 계획
SELECT id, linked_purchase_order_id FROM inbound_plans WHERE plan_type = 'destination';
-- (P3) status 와 ordered_qty 가 어긋난 라인
SELECT po_id, sku_id, status, ordered_qty FROM purchase_order_lines
WHERE (status = 'ordered') <> (ordered_qty IS NOT NULL);
```

⚠️ **`migration-safety.yml` 은 이 마이그레이션에 라벨을 붙이지 못한다** — 패턴이 `DROP COLUMN|DROP TABLE|ALTER COLUMN
… TYPE|SET NOT NULL|RENAME …` 이라 `ADD CONSTRAINT … CHECK`(기존 행을 좁히는 변경)와 `RAISE EXCEPTION` 가드를 못
잡는다. **PR-B 본문에 사람이 적는다**: 「기존 행을 좁히는 CHECK 3개와 백필 가드가 있다 — 사전 확인 쿼리 P1~P3 결과를
붙인다」.

코드: §6 의 라우트 · §5 의 파생 통합 · §9 의 읽기 전환 · 종결 포트·어댑터·옛 입고예정 코드 삭제 · admin-web · 창고 앱 ·
dev 시드(`scripts/local/seed-dev-core/inbound.ts`) · **셀메이트 import(`apps/core/scripts/import-inbound-plans.ts`) 삭제**.
옛 테이블은 남지만 아무도 읽고 쓰지 않는다.

순서: **`migrate → deploy`**. 롤링 중 옛 태스크가 옛 경로로 입고예정을 쓰면 새 모델에 반영되지 않는다. 설계 당시에는
라이브에 이 경로를 쓰는 데이터가 없다고 가정했다. 이후 2026-09-14 23:55 KST PR-B 라이브 적용에서 destination 계획
135건·품목 1,775건을 백업 후 삭제하고 source 계획 182건·품목 2,533건과 대응 발주 182건·라인 2,533건을 보존했다.
옛 셀메이트 CSV import가 발주와 입고계획을 함께 만들던 코드 경로는 확인했지만, 각 라이브 행의 정확한 실행 출처는
확정하지 않았다.

### PR-C — contract (PR-B 배포 완료 뒤)

- `schema.ts` 에서 삭제 → 생성 마이그레이션: `inbound_plan_items` · `inbound_plans` · enum `plan_type` DROP,
  `inbound_receipt_lines.plan_item_id` · `inbound_work_logs.plan_item_id` DROP COLUMN.
- **문장 순서보다 `CASCADE` 를 본다.** 이 저장소의 drizzle 생성 SQL 은 `DROP TABLE "…" CASCADE` 다(선례
  `20260630125603_cluster-a-box-workflow.sql`). 그래서 FK 를 먼저 끊지 않아도 순서 때문에 실패하지는 않는다 — 대신
  **CASCADE 가 조용히 끌고 가는 의존 객체**가 위험이다. 적용 전에 확인한다:
  `SELECT classid::regclass, objid, deptype FROM pg_depend WHERE refobjid IN ('inbound_plans'::regclass, 'inbound_plan_items'::regclass);`
  — FK 제약(두 `plan_item_id` 컬럼의 것)과 테이블 자신의 부속(시퀀스·인덱스·타입) 외에 VIEW 등이 나오면 멈춘다.
  (`stock_summary_view` 는 PR-B 에서 이 테이블들을 안 읽게 재생성됐어야 한다.)
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
| 1 | 헤더 파생 규칙(네 상태 · `cancelled` 고정 · `received → confirmed` 역행 · 전부 잔량 포기 = `received`) + **관문 술어 4×2 표**(§5.3) | 순수 함수 단위 스펙 (`closure.rules` 두 벌 대체) |
| 1a | 관문 적용 — `received` 발주의 라인 수정·실행·불가·취소·예정일 수정 거절, **`received` 발주의 수령 취소는 통과** | 통합 |
| 2 | **결함 ㄱ·ㄴ·ㄷ 회귀** — ㄱ A 실행·전량 입고 → B 실행 → B 가 입고 대기에 뜬다 · ㄴ A 입고 뒤 B 불가 → `received` · ㄷ `received` 발주의 수령 당일 취소 → `confirmed` + 목록 재등장 | 실 DB 통합 |
| 3 | 수령 한 번 = 회차 1 + 원장 `RECEIVE` + 링크 + `received_qty`; 파리티 `received_qty = Σ(링크 회차 라인 − 취소)` | 통합 |
| 4 | 초과 수령 409 **+ DB CHECK 가 직접 UPDATE 를 거절** | 통합 |
| 5 | §6.1 거절 표의 상태·문구 | 통합 |
| 6 | 동시성 — 같은 라인 동시 수령 두 건(합계 초과 불가) · 수령 vs 잔량 포기 · 수령 vs 라인 실행 · 적치 vs 취소. **40P01 없음 + 결과 정합** | 격리 DB · 커넥션 둘 (항목 7 교착 재현 방식) |
| 7 | 멱등 — 같은 키 재시도 = 회차 1개 | 통합 |
| 8 | **읽기 파리티** — 입고 대기 잔량 = VIEW `inbound_pending_qty` = 파이프라인 ①·전사; 헤더 도착예정일 = 목록 예정일 | 통합 |
| 9 | 커널 경계 — (a) `inbound/` 가 `procurement/`·`warehouse-transfer/` 를 import 하지 않는다 · (b) 입고가 조달 테이블에 쓰지 않는다 · (c) `/inbound/cancel` 이 `source ≠ direct` 거절 | (a) import 방향 arch 스펙 — 선례 `replenishment-boundary.arch.spec.ts:27-55` 의 `moduleSpecifiers` · (b) `inventory-write-boundary.arch.spec.ts` 의 `PO_FORBIDDEN` 을 `purchaseOrders` 에서 **`purchaseOrderLines`·`purchaseOrderReceiptLines` 까지** 넓힌다(지금은 헤더만 잡는다) · (c) 통합 |
| 10 | PR-A 동작 보존 — 기존 간편·전수·개별·멱등·당일 취소 스펙이 **수정 없이** 통과 | 기존 스펙 |
| 11 | 라우트 표면 | `inventory-scope-coverage.spec.ts` |
| 12 | 스토어프론트 동기화 SQL 이 실제 DB 에서 돈다 (컬럼 삭제로 조용히 깨지는 부류) | 통합에서 SQL 1회 실행 |
| 13 | 백필 — **옛 모델 시드가 든 `dev_core`** 에 사전 확인 쿼리 P1~P3 → PR-B 마이그레이션 적용 → §11 PR-C 확인 쿼리 3종 0행. 그리고 **⓪ 가드가 실제로 멈추는지** — 격리 DB 에 한 발주·SKU 품목 둘을 심고 migrate 가 `RAISE EXCEPTION` 으로 실패함을 본다 | 수동 + 쿼리 |
| 14 | admin-web 입고 진행 문구 · 버튼 노출 조건 · 관문 표(서버와 같은 4×2) · `canCancel` 이 `receivedQty` 로 부분 입고를 거른다 | `line-execution-model.spec.ts` (순수 `.ts`) |
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
  유지. 기각 대안은 §2 표. (2026-09-14 확인: 마지막 번호 0038, 0039 는 비어 있다. 중복 전력 0027×3·0028×2 가 있으니
  착수 시 `ls docs/adr` 로 재확인.)
- **ADR-0032** — 대체된 결정 1·4 에 표시.
- **`CONTEXT.md`(용어집)** — `CONTEXT.md:72` 의 「입고 계획 … 한 발주에 계획은 하나뿐이다」 정의를 폐지하고 _Avoid_ 줄의
  「한 발주에 입고 계획을 둘 만들기」를 걷어낸다. 새로 정의할 용어: **입고예정**(= 남은 수량이 있는 실발주 라인) ·
  **회차**(한 번의 입고 기록, 커널 소유) · **입고 커널** · **잔량 포기** · **수령 취소**. 발주 `received` 의 뜻에
  「더 받을 것이 없다」를 덧붙인다(§5.2). `docs/agents/domain.md:5` 의 「CONTEXT.md·docs/adr 가 아직 없다」는 문장도 낡았으니
  같이 고친다.
- **#724 본문** — `items → plan → PO` 문장은 닫는 조건 2(「`received` 가 파생된다」 한 줄)가 아니라 **§4 「항목 7 —
  `received` 파생」 절**과 작업 순서 표 4번 행에 있다. 그 둘을 이 모델로 교정한다.
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

## 15. 설계 당시 확인하지 못한 사실과 후속 확인

- **라이브 행 수** — 설계 세션에는 라이브 읽기가 거절되어 측정하지 못했다. 이후 2026-09-14 23:55 KST PR-B 적용
  기록에서 destination 계획 135건·품목 1,775건 삭제, source 계획 182건·품목 2,533건과 발주 182건·라인 2,533건
  보존, §11 PR-C 정합성 3종 0행을 확인했다. 이는 그 시점의 증거이며 PR-C 적용 직전 재검사와 최신 source/전체 DB
  복구 지점을 대신하지 않는다. 당시 destination ZIP은 삭제한 destination 행의 백업일 뿐 source/전체 DB 백업이 아니다.
  옛 셀메이트 CSV import 코드 경로는 확인했지만 보존된 개별 행의 정확한 출처는 확정하지 않았다.
- **간편·전수·개별입고의 라이브 사용 여부** — 모른다. PR-A 를 따로 떼는 이유다.
