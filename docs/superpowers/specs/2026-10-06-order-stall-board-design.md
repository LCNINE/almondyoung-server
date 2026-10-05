# 정체 보드 — 주문 진행 투영과 admin-web 허브 (#1016 «정체 보드» 묶음)

트래킹: #1016 «## 묶음»의 **정체 보드**. 이 스펙이 만드는 보드 첫 버전으로 13번 행이 닫히고, 같은 묶음의 나머지 행(7·8·19·20·22·26·27·28·32)은
이 보드에 탐지·조치를 하나씩 더해 닫는다. **재판정** 묶음의 리컨실러는 이 스펙의 판정기(§4)를 그대로 읽는다.

목업: `docs/superpowers/specs/2026-10-06-order-stall-board-mockup.html` (브라우저로 열면 동작한다. 숫자는 예시)

## 1. 배경

#1016 의 B 행(출구 없음) 대부분은 «갇힌 것을 볼 곳이 없다»는 같은 모양이다. 행마다 화면을 따로 만들면 화면이 열 개 생기고,
어느 단계에 무엇이 쌓였는지 한눈에 보는 곳은 여전히 없다.

볼 곳을 만들려고 보니 «이 상태에 언제 들어왔나»를 믿을 수 있는 칸이 적다(2026-10-06 코드 조사):

- 상태 이력 테이블이 없다.
- `updated_at`·`last_updated` 는 상태 아닌 변경에도 갱신된다(`shipment-recall.service.ts`, `shipment-dispatch.service.ts`).
- 진입 시각 칸이 아예 없는 상태가 있다: 상자 `canceled`·`recovery_required`·`in_transit`, 송장 `registered`·`used`·`abandoned`,
  작업 항목 `withdrawing`·`short_pick_recovery`.
- `sales_orders.status` 의 `shipped`·`delivered` 는 코드상 DEAD 값인데(`inventory.schema.ts` `orderStatusEnum` 주석), 라이브에서는
  셀메이트 스크립트(`scripts/sellmate/mark-shipped-from-csv.ts`)가 쓴다. 출고 진실은 FO·상자에서 도출해야 한다(ADR-0017).

## 2. 목표와 성공 기준

1. admin-web 한 화면에서 0~8단계와 취소·반품·교환의 **진행 중 주문 수**, **갇힌 주문 수**, **최장 체류**를 본다
2. 단계를 누르면 그 단계의 세부 상태별 건수와 주문 목록이 나오고, 목록은 **체류 긴 순**이 기본이다
3. 라이브 07-16 부터 쌓인 매칭 대기 주문이 첫 배포 날부터 «갇힘»으로 보인다(진입 시각 추정, §5.3)
4. 셀메이트가 출고한 주문은 진행 중에서 빠진다
5. 판정이 멈추면 화면이 그 사실을 보여 준다(§8.1)
6. 판정 규칙에 맞지 않는 주문이 조용히 사라지지 않는다(§8.2)
7. `npm run type-check` 에러 0 · `npx jest` 실패 0 · admin-web `tsc --noEmit` 0

## 3. 결정 (사용자 결정 2026-10-06)

| # | 질문 | 결정 | 기각한 안과 이유 |
| --- | --- | --- | --- |
| D1 | 누가 무엇을 하려고 보나 | **주문 처리의 허브.** 위에서 흐름을 보고, 눌러서 처리하러 가는 출발점 | 운영자 작업 화면만: 흐름이 안 보인다 / 관제 화면만: 처리로 이어지지 않는다 |
| D2 | 무엇을 한 칸으로 세나 | **주문 하나 = 한 칸.** 주문을 «가장 뒤처진 단계»에 놓는다 | 단계별 개체(격리 행·backlog·FO·상자·송장): 단위가 달라 합계가 무의미하고 «주문이 어디 있나»에 답하지 못한다 / 둘 다: 첫 버전에 불필요 |
| D3 | 셀메이트 과도기 주문 | **판매주문이 `shipped`·`delivered` 면 «외부 출고»로 종료.** 컷오버하면 저절로 빈다 | core 상태 그대로: draft 상자에 묶인 수천 건이 진짜 갇힘을 덮는다 / 컷오버 이후 주문만: 지금 쌓이는 매칭 대기(13번)를 못 본다 |
| D4 | 단계·진입 시각을 어디서 계산하나 | **진행 투영 테이블 + 1분 주기 갱신.** 판정기가 리컨실러의 읽는 절반이 된다 | 조회 시 계산: 진입 시각을 `updated_at` 으로 어림해 갇힘이 부정확하고, 리컨실러가 SQL 을 따로 가져야 한다 / 모든 쓰기 지점에 이력 기록: 상태기계 열 개를 건드린다 |
| D5 | 갇힘을 무엇으로 재나 | **단계 체류 시간.** 세부 상태가 바뀌어도 시계를 되돌리지 않는다 | 세부 상태 체류: `failed → pending → failed` 처럼 돌기만 하는 주문(16번)이 매번 새것으로 보인다 |
| D6 | 갇힘 기준 | **단계별 상수 한 파일**(§6). 달력 시간 | 화면에서 편집: 아직 필요 없다 / 영업시간: 실제로 문제가 되면 |
| D7 | 목록 정렬 | **체류 긴 순이 기본**, 주문일 최신순 선택 가능 | — |
| D8 | 조치 버튼 | **첫 버전에 없다.** 행을 누르면 기존 화면으로 간다. 묶음의 각 행이 조치를 더한다 | 첫 버전에 조치까지: 행 10개의 일을 한 PR 에 묶는다 |
| D9 | 0단계(수집 격리) | **channel-adapter 의 요약을 admin-web 이 직접 부른다.** core 는 끼지 않는다 | core 가 모아서 준다: core 는 channel-adapter 를 부르지 않는다(#1016 6번 행 스펙 D2) |
| D10 | 7단계의 채널 출고 통지 실패(27번) | **첫 버전에서 뺀다.** 27번(«네이버 개통» 때)을 풀 때 D9 와 같은 방식으로 붙인다 | — |
| D11 | 권한 | **core 기본 전역 가드**(admin·master). 물류 역할이 필요해지면 스코프를 붙인다 | — |

## 4. 판정 — 주문의 «지금 단계»

판정 SQL 은 한 reader(`order-progress.reader.ts`)에만 있다. 리컨실러는 이 reader 를 읽는다.

### 4.1 단계 코드

| 코드 | 화면 이름 | 비고 |
| --- | --- | --- |
| (없음) | 0 수집 | 투영 밖. channel-adapter 격리(§7.3) |
| `accept` | 1 접수 | |
| `fo` | 2 FO 생성 | |
| `reserve` | 3 예약 | |
| `plan` | 4 계획 | |
| `waybill` | 5 송장 | |
| `pick` | 6 배치·피킹 | |
| `dispatch` | 7 발송 | |
| `track` | 8 추적 | |
| `cancel` | 취소 | |
| `return_exchange` | 반품·교환 | |
| `unclassified` | 분류 안 됨 | 0건이면 화면에서 숨김(§8.2) |

종료 결과(`outcome`): `delivered`(배송완료) · `external_shipped`(외부 출고) · `not_required`(출고 불필요) · `cancelled`(취소 종료).

단계·결과는 `varchar` + TS 유니온으로 둔다. pgEnum 은 값을 더할 때마다 마이그레이션이 필요하고, 같은 마이그 실행 안에서 새 값을 쓸 수 없다.

### 4.2 상자 하나의 단계

상자는 `shipment_lines → fulfillment_order_items → fulfillment_orders` 로 판매주문에 이어진다(선례: `sales-orders.service.ts` 일별
통계의 `units` CTE). `canceled`·`superseded` 상자는 세지 않는다.

| 조건 | 단계 | 세부 상태(`state`) |
| --- | --- | --- |
| `draft`, FO `created`·`partially_reserved` | `reserve` | FO 상태 |
| `draft`, FO `ready` | `plan` | `awaiting_plan` |
| `planned`, 활성 작업 항목 없음, 활성 송장이 `WAYBILL_DISPATCHABLE_STATUSES` 아님 | `waybill` | 송장 상태 또는 `none` |
| `planned`, 활성 작업 항목 없음, 송장 준비됨 | `pick` | `awaiting_batch` |
| 작업 항목 `queued`·`picking`·`ready_to_pack`·`packing`·`withdrawing`·`short_pick_recovery` | `pick` | 작업 항목 상태 |
| 작업 항목 `completed`, 상자는 아직 `planned` | `dispatch` | `awaiting_dispatch` |
| `shipped`·`in_transit`·`failed` | `track` | 상자 상태 |
| `delivered` | (끝) | |
| `recovery_required` 또는 `recovery_code` 있음 | 코드로 배정: `CONSOLIDATION_PENDING` → `pick`, `CANCEL_REPLAN_PENDING` → `cancel`, 그 밖 → `unclassified` | 복구 코드 |

직배 FO(`fulfillment_mode = 'drop_ship'`)는 상자 대신 `direct_ship_status` 로 판정한다: `pending` → `dispatch`, `forwarded` → `track`, `completed` → 끝.

«송장 준비됨»은 활성 송장 상태만 본다. 실제 발송 가능성 검사(`assertDispatchable`)는 매니페스트·수령인 지문도 비교하지만
수령인 지문은 코드에서 계산하므로 SQL 로 재현하지 않는다. 지문이 어긋난 송장의 상자는 `pick`/`awaiting_batch` 로 보이고,
배치 합류 때 `WAYBILL_STALE` 로 막힌다(«손대지 않는 것»에 있는 막힘).

### 4.3 주문 하나의 단계 (위에서부터 먼저 적용)

1. 판매주문 `status` 가 `shipped`·`delivered` → 종료 `external_shipped` (D3)
2. 판매주문 `status` 가 `cancelled`·`timeout`
   - 닫히지 않은 상자(`draft`·`planned`·`recovery_required`)가 있거나, 그 상자 라인에 `confirmed` 예약이 남았으면 → `cancel`
     (세부 상태: 복구 코드, 없으면 `open_shipment`·`open_reservation`)
   - 아니면 종료 `cancelled`
3. 열린 반품·교환 요청(상태가 `completed`·`rejected`·`cancelled` 가 아님)이 있으면 → `return_exchange` (세부 상태: 요청 상태)
4. backlog `not_required` → 종료 `not_required`
5. FO 가 없으면: backlog 없음 → `accept`(`no_backlog`) / backlog 가 `completed` 아님 → `fo`(backlog 상태)
6. 나머지는 상자(와 직배 FO)의 단계로 정한다
   - 상자 하나라도 `unclassified` → `unclassified`
   - 아니면 상자 하나라도 `cancel`(판매주문은 살아 있는 부분취소 재계획) → `cancel`
   - 아니면 **최솟값**(순서 `reserve < plan < waybill < pick < dispatch < track`). 전부 끝났으면 종료 `delivered`
7. 어느 규칙에도 걸리지 않으면(FO 는 있는데 세는 상자도 직배도 없음 등) → `unclassified`

## 5. 진행 투영

### 5.1 테이블 `order_progress` (core DB, `inventory.schema.ts`)

| 칸 | 타입 | 뜻 |
| --- | --- | --- |
| `sales_order_id` | uuid PK, FK `sales_orders` cascade | |
| `sales_channel` | 판매채널 enum | 필터용 사본 |
| `ordered_at` | timestamptz | 정렬용 사본(`order_date`) |
| `stage` | varchar(32), NULL 이면 종료 | §4.1 |
| `state` | varchar(64) | §4.2·§4.3 세부 상태 |
| `stage_entered_at` | timestamptz | 이 단계에 들어온 시각. 갇힘 판정은 이 칸만 본다 |
| `outcome` | varchar(32), NULL 이면 진행 중 | §4.1 |
| `closed_at` | timestamptz | |
| `evaluated_at` | timestamptz | 이 행을 마지막으로 판정한 시각 |

인덱스: `(stage, stage_entered_at) WHERE outcome IS NULL` 하나. 요약 집계, 단계별 목록의 체류순 정렬, 갇힘 필터를 모두 받는다.

### 5.2 갱신 — `@CronOnce('* * * * *', { name: 'order-progress-refresh' })`

대상은 세 부류다.

1. 진행 중인 행(`outcome IS NULL`)
2. 행이 없는 판매주문
3. 직전 성공 주기 뒤(`max(evaluated_at)`) 판매주문·반품·교환·취소 기록이 바뀐 주문(`updated_at`·`occurred_at` 비교). 배송완료 뒤 반품 신청처럼
   종료된 행이 다시 열리는 길이다

대상의 판정(§4)을 집합 SQL 한 번으로 계산해 upsert 한다. 원천 테이블은 읽기만 하고 잠그지 않는다. 읽는 사이 원천이 바뀌면
다음 주기가 바로잡는다.

upsert 규칙:

- `stage` 가 같으면 `stage_entered_at` 를 유지한다(`state` 만 바뀌어도 유지 — D5)
- `stage` 가 바뀌면 `stage_entered_at = now()`
- 종료로 바뀌면 `outcome`·`closed_at = now()`, `stage = NULL`. 종료에서 다시 열리면 `outcome`·`closed_at` 을 비우고 진입 시각은 `now()`
- `evaluated_at = now()` 는 대상 전부에

### 5.3 처음 넣을 때의 진입 시각 추정

새 행(첫 배포의 백필 포함)은 단계마다 원천 시각으로 추정한다. 첫 배포 날 매칭 대기 1천여 건이 «방금 들어옴»으로 보이지 않게 하기 위해서다.

| 단계 | 추정 시각 |
| --- | --- |
| `accept` | 판매주문 `created_at` |
| `fo` | backlog `created_at` |
| `reserve` | FO `created_at` |
| `plan` | 상자 `opened_at` |
| `waybill`·`pick`(`awaiting_batch`) | 상자 `planned_at` |
| `pick`(작업 중) | 작업 항목 `picker_claimed_at`, 없으면 상자 `planned_at` |
| `dispatch` | 작업 항목 `completed_at` |
| `track` | 상자 `shipped_at` |
| `cancel` | 마지막 `sales_order_cancellations.occurred_at` |
| `return_exchange` | 요청 `created_at` |
| `unclassified` | `now()` |

추정이 단계의 «가장 뒤처진 상자» 기준이라 실제보다 이르거나 늦을 수 있다. 그 뒤 단계가 바뀔 때는 관측 시각(오차 1분 안)을 쓴다.

### 5.4 코드 위치

`apps/core/src/modules/fulfillment/order-progress/`

- `order-progress.reader.ts` — §4 판정 SQL, 요약·목록 조회
- `order-progress.manager.ts` — upsert 규칙(§5.2)
- `order-progress.cron.ts` — `@CronOnce`
- `order-progress.thresholds.ts` — §6 상수와 `isStuck(stage, enteredAt, now)`
- `order-progress.service.ts` · `order-progress.controller.ts` — §7

판매주문·FO·상자·반품은 모두 `inventorySchema` 한 평면 스키마에 있어 cross-BC seam 이 아니다. `@InjectTypedDb<typeof inventorySchema>()`.

## 6. 갇힘 기준

`order-progress.thresholds.ts` 한 파일. 갇힘 = `now() - stage_entered_at > 기준`. 리컨실러도 이 파일을 읽는다.

| 단계 | 기준 | 근거 |
| --- | --- | --- |
| `accept` · `waybill` · `dispatch` · `cancel` | 1시간 | 기계가 몇 초~몇 분에 끝내는 단계 |
| `fo` · `plan` | 24시간 | 매칭·계획은 사람이 하루 안에 |
| `pick` | 12시간 | 당일 출고 |
| `reserve` | 72시간 | 재고 입고를 기다린다 |
| `track` | 5일 | 보통 1~3일. 14일 추적 창(28번 행)보다 먼저 |
| `return_exchange` | 7일 | 회수·검수에 사람 손 |
| `unclassified` | 0 | 있으면 전부 갇힘 |
| 0 수집 격리 | 0 | 격리 행은 전부 사람 일 |

갇힘은 «사람이 봐야 한다»는 표시이지 막힘이 틀렸다는 뜻이 아니다. 재고 부족 대기처럼 옳은 막힘도 기준을 넘기면 센다.

## 7. API

### 7.1 `GET /order-progress/summary` (core)

```ts
{
  evaluatedAt: string | null;          // 가장 최근 판정 시각(행들의 max(evaluated_at))
  stages: Array<{
    stage: Stage;                      // §4.1, 0단계 제외
    open: number;
    stuck: number;
    oldestEnteredAt: string | null;
    states: Array<{ state: string; open: number; stuck: number }>;
  }>;
}
```

집계는 서버가 끝낸다. 0건인 단계도 빠짐없이 보낸다(화면이 단계 목록을 따로 들지 않게).

### 7.2 `GET /order-progress/orders` (core)

쿼리: `stage`(필수) · `state` · `stuck=true` · `channel` · `sort=dwell|ordered`(기본 `dwell`) · `cursor` · `limit`(기본 50, 최대 200).

```ts
{
  items: Array<{
    salesOrderId: string;
    orderNo: string;                   // display_order_no ?? channel_order_id
    salesChannel: string;
    customerName: string | null;
    orderedAt: string;
    state: string;
    stageEnteredAt: string;
    stuck: boolean;
  }>;
  nextCursor: string | null;
}
```

`dwell` 정렬은 `stage_entered_at ASC, sales_order_id`, `ordered` 정렬은 `ordered_at DESC, sales_order_id` 키셋 커서.

### 7.3 `GET adapter/order-collection-failures/summary` (channel-adapter, 신설)

```ts
{ quarantined: number; oldestCreatedAt: string | null }
```

admin-web 은 격리 배지와 같은 경로(`/proxy/channel`)로 부른다. 지금 목록 엔드포인트는 상한 200건이라 건수로 쓸 수 없다.

## 8. 실패 처리

### 8.1 판정이 멈추면 보인다

크론이 실패하면 투영이 옛값으로 남아 «갇힌 게 없다»는 거짓 초록불이 된다. 화면의 «N초 전 갱신»은 `evaluatedAt` 으로 그리고,
**5분을 넘으면 빨간 경고로 바꾼다.** 실패한 주기는 다음 주기가 다시 시도한다.

### 8.2 규칙 밖은 버리지 않는다

§4 에 걸리지 않는 주문(모르는 복구 코드, 상자 없는 FO 등)은 `unclassified` 로 보낸다. 화면은 이 카드를 1건 이상일 때만 띠 끝에 보인다.
판정 SQL 의 빈틈을 조용히 삼키지 않기 위해서다.

## 9. 화면 (admin-web)

경로 `/order/stall-board`, 사이드바 «주문» 그룹. 구성은 목업을 따른다.

- **위쪽 띠**: 0~8단계 카드, 점선 오른쪽에 취소·반품·교환, (있으면) 분류 안 됨. 카드마다 진행 건수, 빨간 «갇힘 N»(0이면 숨김),
  «최장 체류». 갇힌 주문이 있는 카드는 위쪽에 빨간 선. 0건 단계는 흐리게. 설명·범례는 두지 않는다
- **아래 목록**: 선택한 단계의 세부 상태 칩(건수·갇힘 수), «갇힘만» 토글, 채널 필터, 정렬(체류 긴 순 / 주문일 최신순).
  기준을 넘긴 체류는 빨간 글씨
- **행을 누르면**: 주문 목록(`/order/history`)에서 그 주문으로 간다. 0단계 행·카드는 수집 격리 목록(`/mall/channel-listings`)으로 간다.
  주문 목록이 특정 주문을 열어 주는 쿼리를 지원하는지는 계획 단계에서 확인하고, 없으면 검색어로 넘긴다
- **갱신**: 60초마다 요약과 열린 목록을 다시 부른다

단계 이름·체류 표기·갇힘 색·갱신 경고 판정은 `.ts` 순수 함수로 둔다(컴포넌트 테스트를 쓸 수 없는 환경).

## 10. 테스트

1. **판정 SQL 통합 스펙** (`describeIfDb`, `--runInBand`): §4.3 규칙마다 시나리오 하나 — 외부 출고, 취소 뒤 남은 상자, 취소 뒤 남은 예약,
   배송완료 뒤 반품, 상자 둘 중 하나만 발송(최솟값), 직배, 복구 코드 둘(`CONSOLIDATION_PENDING`·모르는 코드), `not_required`, backlog 없음
2. **upsert 규칙** (통합): 단계 같고 상태만 바뀜 → 진입 시각 유지 / 단계 바뀜 → 갱신 / 종료 → 다시 열림
3. **단위**: 진입 시각 추정 매핑, `isStuck`, 커서 인코딩, channel-adapter 요약 서비스
4. **admin-web 순수 함수**: 체류 표기, 갇힘 표시, 5분 경고
5. **수동 스모크**: 로컬 E2E 환경에서 화면 배선(카드 → 목록 → 행 이동)

## 11. 배포

1. core·channel-adapter: 마이그 1건(테이블 + 인덱스, additive) → `db:migrate` → `sst deploy`
2. 첫 주기가 전 판매주문을 백필한다. 라이브에서 첫 주기 소요 시간을 한 번 확인한다(판매주문 수만 건 규모). 1분 안에 끝나지 않아도
   `@CronOnce` 가 주기당 한 번만 돌리므로 겹치지 않는다
3. admin-web 배포

## 12. 범위 밖

- 조치 버튼(D8) — 정체 보드 묶음의 각 행이 더한다
- 7단계 채널 출고 통지 실패(D10) — 27번 행
- 경보(알림 발송) — 보드가 쓰이는 걸 본 뒤
- 기준 시간 화면 편집·영업시간 계산(D6)
- 리컨실러(재판정 묶음) — 이 스펙의 reader 와 thresholds 를 읽는 별도 스펙
- core DLQ 를 보드에 올리는 것(8번 행) — DLQ 가 DB 에 남지 않는다. 8번 행이 먼저 남긴다
