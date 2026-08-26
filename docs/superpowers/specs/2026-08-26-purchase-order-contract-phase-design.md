# 발주 계약 정리 — contract phase (#724 항목 9의 3단계)

> 합의된 3단계 중 마지막. 1단계(크론 제거)·2단계(라인 생명주기 도입)는 머지·배포됐다.
> 이 문서는 **무엇을 왜 그렇게 좁히는가**를 정하고, 실행 순서는 계획서가 맡는다.

## 1. 문제

2단계가 **라인을 진실로** 만들었다. 실행 순간의 수량·단가·도착예정일은 라인이 소유하고,
헤더 `status` 는 라인에서 파생된다(`refreshHeaderStatus`). 그런데 그 이전 모델의 계약이
세 군데 그대로 남아 있다.

| 남은 계약 | 지금 무슨 일이 벌어지나 |
|---|---|
| `PUT /:id/status` 가 `confirmed` 를 받는다 | 상태 쓰기로 **위장한 일괄 라인 실행**. `received → confirmed` 역방향도 열려 있다 |
| `purchase_orders.expected_arrival` | 라인 ETA 와 두 벌. 헤더가 확정 시점에 덮어써지고, 라인은 각자 값을 갖는다 |
| `inbound_plans.expected_date` | 아이템 예정일과 두 벌. 계획 날짜는 **첫 생성에서 고정되고 갱신되지 않는다**(2단계가 의도적으로 그렇게 뒀다) |

세 번째가 가장 조용하고 나쁘다. `GET /inbound/plans/items` 는 Swagger 요약이
*"헤더 무시, 아이템 기준"* 이라고 적혀 있는데 **실제로는 날짜 표시·기간 필터·정렬을 전부
계획 헤더 컬럼으로 한다**(`inbound.service.ts:784,799-805`). 아이템이 각자 예정일을 갖게 된
지금, 이 목록은 틀린 날짜로 거른다.

## 2. 결정

| # | 질문 | 결정 |
|---|---|---|
| A | `PUT /:id/status` 의 운명 | **`received` 전용으로 좁힌다.** `confirmed`/`created` 수동 설정은 409 |
| B | 헤더 `expected_arrival` 격하 모양 | **생성 입력을 라인 ETA 로 팬아웃**하고, 응답은 라인 min 파생 |
| C | `inbound_plans.expected_date` 강등 폭 | **컬럼까지 제거.** 응답 필드는 `MIN(items)` 파생으로 유지 |
| D | 파괴적 마이그레이션 분할 | **백필 + DROP 을 이 PR 한 벌에.** expand-contract 분할을 의도적으로 비탄다 |

D 의 근거: 이 도메인은 **실사용 중이 아니다**(사용자 판단). 2단계 배포 후 발주 API 는 라이브에서
한 번도 호출되지 않았고(CloudWatch — 부팅 시 라우트 등록 로그뿐), 아래 §6 이 세는 대로
바뀌는 계약의 **제품 코드 호출자가 전부 0곳**이다. CLAUDE.md 의 2~3 PR 분할은 옛 태스크가
새 스키마를 만나는 사고를 막으려는 규율인데, 만날 트래픽이 없다.

## 3. 범위

**들어가는 것**

- `PUT /:id/status` 를 종결 전용으로 좁히고 전이 가드를 신설
- 일괄 확정 블록 삭제 (`updatePurchaseOrderStatus` 안의 라인 실행 루프)
- 발주 생성 2경로의 도착예정일을 라인으로 팬아웃
- 헤더 응답 `expectedArrival` 을 라인 min 파생으로
- `inbound_plans.expected_date` 제거 + 읽는 쪽 3곳 아이템 기준 전환
- 백필 2건 · 인덱스 재정의 2건 · `DROP COLUMN` 2건 (마이그레이션 1개 파일)

**안 들어가는 것**

- PO 수준 `cancelled` 신설, 입고 완료 → `received` **자동** 전이 → 항목 7
- 일괄 실행 전용 엔드포인트 → §7 참조 (지금은 만들지 않는다)
- `audit_status` 컬럼 drop → #735 가 남긴 별도 PR
- `procurement/` 모듈 분리 → 항목 5
- 목록 조회의 N+1 → 항목 8

## 4. `PUT /:id/status` → 종결 전용

### 4.1 계약

```
PUT /purchase-orders/:id/status
  body: { status: 'received' }          // 'created'·'confirmed' 는 400 (DTO 거부)
  → 409 if 현재 status !== 'confirmed'
```

`UpdatePurchaseOrderStatusDto` 에서 `expectedArrival` 을 뺀다. 확정 경로가 사라지면 그 값을
받아 쓸 곳이 없다.

### 4.2 허용 전이

| 현재 | `received` 요청 | 왜 |
|---|---|---|
| `created` | **409** | 아직 `requested` 인 라인이 남았다. 발주하지 않은 물건이 입고될 수는 없다 |
| `confirmed` | **200** | 전 라인이 `ordered`/`unavailable` 로 종결됐다 |
| `received` | **409** | 종결은 한 번뿐. 역방향 전이 차단이 여기서 같이 처리된다 |

전 라인이 `unavailable` 인 발주도 헤더는 `confirmed` 로 파생되므로 `received` 로 갈 수 있다.
아무것도 안 들어온 발주를 종결하는 셈이라 어색하지만 해롭지 않다 — 계획도 아이템도 없다.

### 4.3 삭제되는 코드

`purchase-order.service.ts:176-256` 의 확정 분기 전체:

- 헤더 ETA 정규화(`headerExpectedDate`)와 `expected_arrival` 쓰기
- `requestedLines` 조회 → `ensurePlanForPurchaseOrder` 선확보 → `executeLineOrder` 루프
- 그 블록에 딸린 주석 (이중 계상 사고 이력은 이 문서와 스펙이 승계한다)

`refreshHeaderStatus` 의 `header.status === 'received'` 조기 반환은 **유지한다**. 종결된 발주에
뒤늦은 라인 쓰기가 닿아도 상태가 되돌아가지 않게 하는 방어선이고, `orderLine` /
`markLineUnavailable` 의 `received` 409 가드(`:392`, `:503`)와 한 세트다.

## 5. 헤더 `expected_arrival` — 팬아웃하고 파생시킨다

### 5.1 쓰기: 생성 시점에 라인으로 내린다

`createPurchaseOrder`(`:52`)·`createPurchaseOrderFromCart`(`:121`) 가 받는
`expectedArrival` 을 헤더 컬럼 대신 **각 라인의 `expected_arrival`** 에 심는다. 2단계 백필이
헤더→라인으로 물려준 것과 같은 논리의 연장이다. 입력 DTO 는 이미
`IsCalendarDateConstraint` 를 쓰므로 검증은 손대지 않는다.

의미가 "발주서의 도착예정일" 에서 **"모든 라인의 기본 도착예정일"** 로 바뀐다. 라인을 실제로
발주할 때 다른 날짜를 넣으면 그 라인만 갱신된다(`executeLineOrder` 의
`dto.expectedArrival ?? line.expectedArrival`, `:344`).

### 5.2 읽기: 라인 min 파생

`PurchaseOrderResponse.expectedArrival` 은 **`MIN(라인 expected_arrival)`** 으로 채운다.
타입은 `Date | null` 을 유지한다 — admin-web 목록 컬럼이 그렇게 읽는다.

라인 컬럼은 `date` + `mode:'string'` 이라 `'YYYY-MM-DD'` 다. 뒤에 `T00:00:00.000Z` 를 붙여
UTC 자정으로 올린다. 문자열을 그대로 `new Date()` 에 넣어도 같은 결과지만, 명시적으로 적어
"오프셋 없는 날짜" 라는 성질에 기대는 코드임을 남긴다.

`getPurchaseOrderById`(`:583`)와 `getPurchaseOrders`(`:677`)는 이미 라인을 손에 쥐고 응답을
조립하므로, 공용 헬퍼 하나로 두 곳을 덮는다.

## 6. `inbound_plans.expected_date` — 제거

### 6.1 쓰기 쪽

- `ensurePlanForPurchaseOrder(poId, expectedDate, tx)` 의 두 번째 인자를 없앤다. 헤더 날짜를
  계획에 seed 하던 `:750` 도 같이 사라진다. 계획의 예정일은 이제 **아이템만** 갖는다.
- `CreateInboundPlanDto.expectedDate` 를 제거한다. 이 필드의 `@IsDateString()` 은 발주→입고
  경로에 하나 남아 있던 느슨한 날짜 검증인데(`'2026'` 도 통과한다), 필드째 사라지므로
  교정할 것이 없다.

### 6.2 읽는 쪽 3곳

| 위치 | 지금 | 바뀐 뒤 |
|---|---|---|
| `getInboundPending` (`:336`, `:424`) | `plans.expected_date` | 이미 함께 읽는 `itemsData` 에서 **`MIN(item.expectedDate)`** |
| `listInboundPlanItems` (`:784`, `:799-805`) | 표시·필터·정렬 모두 계획 컬럼 | 전부 **아이템 컬럼**. `new Date(startDate)` / `setHours(23,59,59,999)` 도 같이 사라진다 — `date` 컬럼끼리는 문자열 비교로 충분하고, 저 코드는 러너 TZ 에 의존하는 부류였다(#724 발견 ⑪ 과 같은 계열) |
| `inbound-pipeline.reader.ts:80` | `MIN(COALESCE(items, plans::date))` | `MIN(items.expected_date)` |

`InboundPendingResponse.expectedDate` 는 `Date | null` 을 유지한다 — 물류팀 Tauri 앱
(`native/warehouse-app/src/domains/inbound/`)과 admin-web 입고 대기 목록이 이 필드를 읽는다.
**출처만 바뀌고 계약은 그대로**라 양쪽 다 손댈 것이 없다.

`GET /inbound/plans/items` 응답의 `expectedDate` 는 계획의 `Date` 에서 아이템의
`'YYYY-MM-DD'` 문자열로 바뀐다 — 이건 계약 변경이지만 **제품 코드 호출자가 0곳**이다.

### 6.3 호출자 실측 (2026-08-26)

| 표면 | 제품 코드 호출자 |
|---|---|
| `PUT /purchase-orders/:id/status` | **0곳** (통합 스펙 14곳만) |
| `POST /inbound/plans` | **0곳** (`ensurePlanForPurchaseOrder` 내부 호출만) |
| `GET /inbound/plans/items` | **0곳** |
| `GET /inbound/pending` | admin-web + Tauri 앱 — **계약 유지되므로 안전** |
| `GET /purchase-orders`, `GET /:id` | admin-web — **계약 유지되므로 안전** |

## 7. 회수되는 능력 — 일괄 확정

`PUT /:id/status → confirmed` 는 "아직 실행 안 된 라인을 전부 지금 발주한 것으로 친다" 는
일괄 경로였다. 이걸 막으면 **발주서 하나를 한 번에 확정하는 수단이 사라진다.** 라인이 N개면
실행도 N번이고, admin-web 에는 일괄 버튼이 없다(#739 가 만든 것은 라인 단위 다이얼로그 2개).

**사용자가 소멸을 승인했다** (2026-08-26). 근거는 이 기능이 실사용 중이 아니라는 것.

되살릴 필요가 생기면 상태 쓰기가 아니라 **전용 엔드포인트**가 맞다:

```
POST /purchase-orders/:id/lines/order-all
  → requested 인 라인을 전부 요청 수량 그대로 실행
```

지금 만들지 않는다. 쓰는 사람이 없는 채로 두 번째 실행 경로를 유지하는 것이 애초의 문제였다.

## 8. 마이그레이션 (1개 파일)

2단계 파일(`20260825010019_add-purchase-order-line-lifecycle.sql`)과 같은 관행 —
`drizzle-kit generate` 결과에 백필 `UPDATE` 를 `--> statement-breakpoint` 로 **앞에** 덧붙인다.

순서가 중요하다. 백필 → 인덱스 → DROP.

1. **백필** `inbound_plan_items.expected_date` ← `inbound_plans.expected_date::date`
   (아이템이 `NULL` 인 것만. 계획 날짜가 `NULL` 이면 그대로 `NULL`)
2. **백필** `purchase_order_lines.expected_arrival` ← `purchase_orders.expected_arrival::date`
   (2단계 백필 이후 생긴 행 대비 재실행. 멱등하다)
3. **인덱스** `idx_inbound_plans_wh_date` **삭제** — `(warehouse_id, expected_date)` 였고,
   창고 접두는 `idx_inbound_plans_warehouse_type_status` 가 이미 덮는다
4. **인덱스** `idx_inbound_plans_destination` 을 `(destination_warehouse_id)` 단독으로 재생성
5. **인덱스** `idx_inbound_plan_items_expected_date` 신설 — 아이템 기준 기간 필터가 쓴다
6. `ALTER TABLE inbound_plans DROP COLUMN expected_date`
7. `ALTER TABLE purchase_orders DROP COLUMN expected_arrival`

## 9. 검증

**게이트 (0 이 기준선)**

- `npm run type-check`
- `npx jest --maxWorkers=2`
- `cd apps/admin-web && npx tsc --noEmit` — 루트 type-check 는 admin-web 을 제외한다

**통합 스펙 — 이 작업의 실질 비용**

`updatePurchaseOrderStatus(CONFIRMED)` 를 부르는 14곳이
`purchase-order-single-plan.integration.spec.ts` 와
`purchase-order-line-execution.integration.spec.ts` 에 흩어져 있다. 단순 치환이 아니다 —
"일괄 확정도 라인 실행과 **같은 경로**를 지난다" 를 고정하던 스펙들은 지키던 성질 자체가
사라지므로 재작성해야 한다. 특히:

- **살려야 할 것**: "해외 발주는 계획 하나" 불변식(`purchase-order-single-plan`), 재확정이
  아이템을 늘리지 않는다는 성질 → 이제 "라인 재실행 409" 가 같은 것을 지킨다
- **새로 고정할 것**: 전이 가드 3종(§4.2), 생성 ETA 팬아웃, 헤더 min 파생,
  아이템 기준 기간 필터

러너: `npm run test:core:integration:local` (5432 compose. 워크트리에서는
`COMPOSE_PROJECT_NAME=almondyoung-server` 필수)

**수동 확인**

이 도메인은 실사용 중이 아니므로 라이브 스모크를 전제하지 않는다. 다만 `sst deploy` 이후
`GET /inbound/pending` 이 `expectedDate` 를 여전히 채우는지(=Tauri 앱 계약)만 한 번 본다.

## 10. 배포

마이그레이션이 파괴적이므로 **`deploy → migrate`** 다 (contract phase). expand 순서와 반대라는
점을 계획서가 다시 적는다. 옛 태스크가 `DROP COLUMN` 을 만나는 사고를 막는 순서다.

## 11. 이슈 처리

`#724` 현황판의 항목 9 를 🟩 로, "3단계 미착수" 표를 갱신한다. 항목 7(종결·취소 상태)이
`received` 자동 전이를 이어받는다는 것을 의존 관계 절에 적는다.
