# 주문 리컨실러 — 재판정 묶음의 틀과 12번 행 (#1016 «재판정» 묶음)

트래킹: #1016 «## 묶음»의 **재판정**. 이 스펙이 리컨실러 틀을 만들고 12번 행을 닫는다. 같은 묶음의 나머지 행(11·16·18·25·29·30)은
이 틀에 **규칙 파일 하나 + 레지스트리 한 줄 + 테스트**를 더해 닫는다. 이 스펙의 결정은 그 행들이 모두 따르는 표준이다.

**§11(2026-10-08 추가)** 이 틀의 후보 단위를 «주문»에서 «재판정 대상(주문·상자)»으로 넓힌다. 상자를 다루는 행(18·25·30)과
종료된 주문을 보는 행(29)은 §11 의 모양을 따른다. 틀이 바뀌는 시점은 §11.6 이 정한다.

선행 스펙: `docs/superpowers/specs/2026-10-06-order-stall-board-design.md` — 리컨실러는 그 판정기(`order_progress`)를 읽는다(보드 스펙 D4).

## 1. 배경

### 1.1 12번 행

`changeMatchingStrategy`(`PATCH /matchings/:id/strategy`, `product-matching.service.ts`)에 결함이 둘 있다.

1. **깨우는 신호가 빠졌다.** 같은 서비스의 다른 해소 경로(resolve·void 해소·legacy 해소)와 매칭 upsert 는 모두
   `fulfillmentBacklog.wakeBacklogsWaitingForVariant()` 를 부르는데 이 경로만 안 부른다. 이 경로로 매칭을 바꾸면 그 variant 를
   기다리던 `awaiting_matching` backlog 가 영영 잠든다.
2. **불변식을 깨는 상태를 쓴다.** void → variant 전환은 옛 전략의 `delete()` 와 `strategy` 갱신만 하고 링크를 만들지 않아
   «`matched` + `variant` + 링크 0개» 행을 남긴다. `variant → variant` 요청은 옛 전략의 `delete()` 가 링크를 지운 뒤 같은 값을 다시 쓴다.

같은 상태를 만드는 길이 하나 더 있다: 매칭 upsert(`PUT /matchings/:variantId`)에 빈 `links: []` 를 보내면 기존 링크를 지우고
`matched + variant` 로 남긴다(`product-sku-mapping.service.spec.ts` «removes existing SKU links when an existing matching is saved with empty links»).

### 1.2 «링크 0개 매칭»은 숨은 미매칭이다

- 판매: 판매 가능 사유가 `MATCHING_LINK_MISSING` 이고, `packages/domain-types/medusa-inventory-projection.ts` 의 `NON_STOCK_GATED_REASONS`
  에 있어 `MATCHING_PENDING` 과 똑같이 «재고 무관 판매»로 나간다.
- 출고: FO 생성이 쓸 수 있는 매칭으로 보지 않아(`FulfillmentsService` 의 `getPhysicalSkuLinks`) backlog 가 `awaiting_matching` 으로 간다.
- 화면: 상태가 `matched` 라 어드민 매칭 작업 목록에 나오지 않는다. **운영자가 고칠 기회가 없다.**

### 1.3 셀메이트로 출고된 주문에 FO 가 뒤늦게 생긴다 (2026-10-08 라이브 실측)

FO 생성 워커(`fulfillment-order-creation-backlog.worker.ts`)와 `FulfillmentsService.create` 는 판매주문 `cancelled` 만 막는다.
셀메이트 과도기에는 `scripts/sellmate/mark-shipped-from-csv.ts` 가 `sales_orders.status` 만 `shipped` 로 올리고 backlog 는 건드리지 않아,
이미 나간 주문의 backlog 가 `awaiting_matching` 으로 남는다. 그 backlog 를 누가 깨우면 FO·확정 예약·draft 상자가 생긴다.

10-08 core 라이브(READ ONLY):

| 항목 | 값 |
| --- | --- |
| backlog 생성 1일 뒤 만들어진 FO(전부 판매주문 `shipped`) | 8월 108 · 9월 32 · 10월 3 |
| 판매주문 `shipped`·`delivered` 에 걸린 확정 예약 | 551건 / 5,336개 |
| 그중 FO 가 셀메이트 출고 표시 «뒤»에 생긴 몫 | 270건 / 3,883개 |
| `awaiting_matching` backlog | 판매주문 `shipped` 1,079 · `pending` 6 · `cancelled` 1 |
| 12번 규칙 후보(기다리는 variant 가 지금 전부 쓸 수 있게 매칭됨) | **113건 — 전부 판매주문 `shipped`**, `pending` 0 |
| «`matched` + `variant` + 링크 0개» 매칭 | 20건(08-06 ~ 09-22), 열린 주문 0 |

**backlog 테이블에서 후보를 고르는 리컨실러는 첫 주기에 이미 나간 주문 113건에 FO 를 만든다.** 이 스펙의 틀이 후보 선택을
규칙에서 빼앗고(§4.3), 도메인 가드를 선행시키는(§5.1) 이유다.

이미 생긴 FO·예약의 청소와 일일 상자 종결(런북 Ⓒ)의 기준 문제는 #923 §E 가 맡는다(10-08 #923 본문에 기록).

## 2. 목표와 성공 기준

1. `changeMatchingStrategy` 로 매칭이 바뀌어도 기다리던 주문이 리컨실러에 의해 깨어난다
2. 링크 0개 매칭을 만드는 길이 없다. 라이브의 기존 20건은 매칭 작업 목록에 다시 나타난다
3. 어떤 경로로 깨우든 셀메이트로 출고된 주문에는 FO 가 생기지 않는다
4. 리컨실러가 판단과 도메인의 엇갈림으로 무한히 반복하지 않고, 포기한 주문은 정체 보드에 보인다
5. 다음 재판정 행을 닫는 일은 규칙 파일 하나 + 레지스트리 한 줄 + 테스트다. 틀은 고치지 않는다
6. `npm run type-check` 에러 0 · `npx jest` 실패 0 · admin-web `tsc --noEmit` 0

## 3. 결정 (사용자 결정 2026-10-08)

| # | 질문 | 결정 | 기각한 안과 이유 |
| --- | --- | --- | --- |
| D1 | 셀메이트로 출고된 주문을 어디서 막나 | **도메인에서 막고, 리컨실러 후보도 투영에서 고른다. 라이브 실측도 한다** | 리컨실러 후보 선택에서만: 기존 깨우기 경로(운영자 매칭 해소)의 위험이 남는다 |
| D2 | 이미 생긴 FO·예약 청소 | **이 스펙 밖.** #923 §E | 일회성 스크립트·리컨실러 규칙: 예약을 푸는 기준 자체(런북 Ⓒ vs Ⓑ)가 틀려 있어 그쪽에서 고쳐야 한다. 재고를 자동으로 푸는 규칙이 첫 표준 사례가 되면 안 된다 |
| D3 | 셀메이트 주문을 모두 출고로 볼까 | **아니다.** 풀 대상은 «예약»이고 주문 «상태»는 셀메이트 출고 CSV 가 증거일 때만 올린다 | 하루 끝 일괄 완료: 안 나간 주문을 `shipped` 로 쓰는 거짓 기록 |
| D4 | 리컨실러와 명령의 경계 | **신호 누락은 리컨실러만 고친다. 불변식 위반은 명령에서 거절한다.** 12번의 `wake` 를 명령에 더하지 않는다 | 둘 다 명령에서 고치고 리컨실러는 안전망: 같은 결과로 가는 길이 둘이 되고 리컨실러가 일하는지 라이브에서 알 수 없다. `fo` 갇힘 기준이 24시간이라 1~2분 지연은 문제가 아니다 |
| D5 | 새 규칙을 라이브에 올릴 때 | **관찰 모드로 먼저, 검토 뒤 PR 로 실행 모드.** 모드는 코드에 둔다 | 바로 실행: 후보 선택이 틀리면 피해가 사람보다 빨리 커진다 / DB 설정: 설정 장치가 필요하고 변경 이력이 git 밖에 남는다 |
| D6 | 몇 번 시도하나 | **1·4·16·64·256분 간격 5회 → 포기 표시 → 정체 보드.** 포기 뒤에도 1024분마다 다시 시도하되 표시는 유지 | 상한 없음: 무한 반복 / 포기를 로그로만: 보드에서 사람 차례임을 모른다 / 1024분을 6번째 시도로: 결정적 원인은 기다려도 안 풀리고, 사람에게 늦게 알린다 |
| D7 | 기존 링크 0개 매칭 20건 | **일회성 스크립트로 `pending` 으로 되돌린다** | 그대로: 계속 화면에서 안 보인다 / 리컨실러 탐지 규칙: 매칭 단위라 주문 단위인 보드와 맞지 않는다 |
| D8 | 틀의 모양 | **작업 하나 + 규칙 레지스트리. 후보 선택은 틀이 한다** | 보드 갱신 작업 안에: 규칙 하나가 느리면 보드 갱신이 멈추고 «5분 경고»가 리컨실러 문제로 울린다 / 규칙마다 크론: 시도·포기·관찰을 규칙마다 다시 구현해 표준이 갈라진다 |
| D9 | 빈 링크 upsert | **`pending` 으로 내린다** | 400 거절: 운영자가 «매칭 해제»할 다른 길을 찾아야 한다 |
| D10 | 출고 주문 backlog 1,079건 일괄 종결 | **이 스펙 밖.** 셀메이트 주문 정리(#923)에서 정한다 | — |

## 4. 리컨실러 틀

### 4.1 위치

`apps/core/src/modules/fulfillment/order-reconcile/`

| 파일 | 역할 |
| --- | --- |
| `order-reconcile.rule.ts` | 규칙 인터페이스(§4.2) |
| `order-reconcile.registry.ts` | 규칙 배열. 행을 닫을 때 한 줄을 더한다 |
| `order-reconcile.runner.ts` | 한 바퀴(§4.3) |
| `order-reconcile.state.ts` | 다음 확인 시각·포기·리셋 전이 순수 함수(§4.5) |
| `order-reconcile.repository.ts` | `order_reconcile_state` 읽기·쓰기 |
| `order-reconcile.job.ts` | `@CronOnce('* * * * *', { name: 'order-reconcile' })` |
| `rules/wake-awaiting-matching.rule.ts` | 12번 규칙(§5.4) |

판매주문·backlog·투영은 모두 `inventorySchema` 한 평면 스키마에 있어 cross-BC seam 이 아니다. `@InjectTypedDb<typeof inventorySchema>()`.

### 4.2 규칙 인터페이스

```ts
interface OrderReconcileRule {
  name: string;                    // 시도 기록의 키. 바꾸면 기록이 끊긴다
  row: number;                     // #1016 행 번호
  mode: 'observe' | 'act';
  situation: { stage: OrderProgressStage; states: string[] };   // 투영에서 볼 칸
  fingerprint(salesOrderId: string, tx: DbTx): Promise<string>; // 상황 지문(§4.5)
  check(salesOrderId: string, tx: DbTx): Promise<boolean>;      // 원천 재확인. false = 지금은 할 일 없음(실패 아님)
  act(salesOrderId: string, tx: DbTx): Promise<void>;           // 도메인 함수 호출만
}
```

### 4.3 한 바퀴

1. **후보는 틀이 고른다.** 규칙마다 `order_progress` 의 진행 중 행(`outcome IS NULL`) 중 `stage`·`state` 가 규칙의 `situation` 과 같고,
   `order_reconcile_state` 행이 없거나 `next_check_at <= now` 인 것. `stage_entered_at` 오래된 순, **규칙당 주기마다 최대 50건**
2. **상황을 떠난 주문의 행을 지운다.** 규칙마다 한 문장: 그 규칙의 행 중 투영이 더 이상 진행 중 + 그 `situation` 이 아닌 주문. 이것이 «해결됨»이다.
   단 마지막 결과가 `acted`·`error` 이고 `updated_at` 이 10분(`DEPARTURE_GRACE_MIN`) 안인 행은 남긴다 — 깨운 backlog 가 10~20초
   `pending`·`processing` 에 머무는 순간을 투영이 잡아도 «떠남»으로 보지 않아야 깨움→되돌아옴 반복이 포기에 닿는다.
   바퀴의 맨 앞에서는 등록되지 않은(이름을 바꿨거나 뺀) 규칙의 행도 지운다 — 다시 볼 규칙이 없으니 «자동 멈춤»이 영원히 남는다
3. **후보 하나 = 트랜잭션 하나.** `fingerprint` → `check` → (실행 모드이고 check 가 true 면) `act` → 상태 기록. 예외가 나면 롤백하고 별도
   트랜잭션에 `error` 결과만 기록한 뒤 다음 후보로 간다. 한 주문의 실패가 다른 주문을 막지 않는다(#1016 1번 행의 교훈)
4. 규칙 하나가 통째로 예외를 내면(후보 조회 실패 등) 그 규칙만 건너뛰고 다음 규칙으로 간다
5. **겹침**: `CronOnce` 주기당 클러스터 1회 + 프로세스 안 실행 중 플래그(`OrderProgressRefreshJob` 과 같은 꼴). 앞 실행이 1분을 넘기면 다음 틱을 건너뛴다
6. **로그**: 바퀴마다 규칙별 `acted / would_act / not_needed / error / gave_up` 건수 한 줄. 관찰 모드의 «했을 일»은 그 주문을 처음 볼 때만 한 줄

### 4.4 원칙 (모든 규칙이 따른다)

1. **규칙은 후보 SQL 을 쓰지 않는다.** 투영에서 고르는 건 틀의 일이다. 투영은 셀메이트 출고(`external_shipped`)·취소 등 종료된 주문을
   이미 빼 두었다 — §1.3 의 113건이 이 원칙으로 막힌다
2. **`check` 는 도메인이 쓰는 판정 함수를 그대로 쓴다.** 규칙이 자기 판정을 따로 가지면 도메인과 엇갈려 포기만 쌓인다
3. **`act` 는 도메인 함수만 부른다.** 상태를 직접 쓰지 않는다. 그 도메인 함수는 CAS·잠금으로 동시 호출에 이미 안전해야 한다
4. **투영은 최대 1분 늦다.** 그 틈은 `check` 가 원천을 다시 읽어 막는다
5. **일시적 막힘은 `check` 가 걸러 `not_needed` 로 만든다.** 정비 모드처럼 몇 시간 이어질 수 있는 막힘을 시도로 세면 포기가 잘못 찍힌다
6. **도메인 가드가 최종 방어선이다.** 리컨실러는 정상 경로와 같은 함수를 부르므로, 그 함수가 잘못된 전이를 거절하지 않으면 리컨실러가 그 구멍을 자동으로 키운다

### 4.5 상태 기록 — 테이블 `order_reconcile_state` (core DB, `inventory.schema.ts`)

행 하나 = «규칙 × 주문»의 재판정 상태.

| 칸 | 타입 | 뜻 |
| --- | --- | --- |
| `rule` | varchar(64) | PK 1 |
| `sales_order_id` | uuid | PK 2, FK `sales_orders` cascade |
| `tracking_row` | integer | #1016 행 번호. 정체 보드가 리컨실러 모듈 없이 «자동 멈춤 · #12» 를 그리게 행에 둔다 |
| `fingerprint` | text | 마지막으로 본 상황 지문 |
| `mode` | varchar(16) | 마지막 기록 때의 모드 |
| `attempts` | integer | 실행 모드에서 `act` 한 횟수. 오류도 1회 |
| `last_result` | varchar(16) | `acted` · `would_act` · `not_needed` · `error` |
| `last_error` | text | 앞 1,000자 |
| `next_check_at` | timestamptz | 다음에 볼 시각 |
| `gave_up_at` | timestamptz | NULL 이면 진행 중 |
| `first_seen_at` · `updated_at` | timestamptz | |

인덱스: `(rule, next_check_at)`, 그리고 정체 보드가 «포기한 주문»만 찾는 부분 인덱스 `idx_order_reconcile_state_gave_up`
(`sales_order_id` `WHERE gave_up_at IS NOT NULL`). `rule`·`last_result` 는 `varchar` + TS 유니온(보드 스펙 §4.1 과 같은 이유 — pgEnum 은 값마다 마이그).

**다음 확인 시각** (순수 함수 `nextReconcileState(이전, 결과, 지문, now)` 하나가 정한다):

| 결과 | 다음 확인 | 횟수 |
| --- | --- | --- |
| `acted` · `error` (n번째) | n = 1·2·3·4·5 → 1·4·16·64·256분 뒤 | +1 |
| 다섯 번 시도 뒤 다시 와서 `check` 가 true | `act` 하지 않고 `gave_up_at = now`, 1024분 뒤 | 그대로 |
| 포기 상태에서 다시 와서 `check` 가 true | `act` 를 한 번 하고(결과 기록) 1024분 뒤. `gave_up_at` 유지 | 그대로 |
| `not_needed` | 10분 뒤. 포기 상태였으면 `gave_up_at` 유지(떠나거나 지문이 바뀌어야 풀린다) | 그대로 |
| `would_act`(관찰) | 10분 뒤 | 그대로, 포기 없음 |

예외(`fingerprint`·`check`·`act` 어디서 났든)도 같은 상한을 따른다 — 다섯 번 뒤에 또 예외면 `gave_up_at = now` 로 포기하고 그 예외를
`last_error` 로 남긴다. 예외 기록의 지문은 이번 바퀴에 구한 지문이고, 구하기 전에 던졌을 때만 이전 지문(처음이면 빈 문자열)을 쓴다.

첫 시도부터 포기까지 약 5시간 41분으로 `fo` 갇힘 기준 24시간보다 짧다. `not_needed`·`would_act` 를 기록하는 이유는 주기당 상한
때문이다 — 기록하지 않으면 늘 같은 오래된 50건만 보고 새 주문이 굶는다.

**리셋:**

- 주문이 상황을 떠나면 행을 지운다(§4.3-2). 깨웠다가 1분 안에 같은 상태로 돌아온 경우는 투영이 보지 못하므로 떠남이 아니고 횟수가 쌓인다 — 무한 반복을 잡으려면 이게 맞다.
  투영이 깨운 직후의 `pending` 을 잡더라도 `acted`·`error` 뒤 10분 유예 동안은 지우지 않으므로 마찬가지로 횟수가 쌓인다
- `fingerprint` 가 바뀌면 `attempts = 0`, `gave_up_at = NULL`. 운영자가 원인을 손보면 다시 다섯 번 시도한다
- 관찰 → 실행으로 바뀌면 `mode = 'observe'` 였던 행은 횟수 0 에서 시작한다

«투영의 (단계, 세부 상태)가 바뀌면 리셋»은 쓰지 않는다 — 1분 해상도로는 깨우기 뒤 되돌아온 것을 «바뀜»으로 볼 수 없다.

## 5. 12번 행

### 5.1 도메인 가드 — 셀메이트로 출고된 주문에는 FO 를 만들지 않는다

`FulfillmentsService.create` 안, 판매주문을 `FOR UPDATE` 로 잠그고 `cancelled` 를 검사하는 자리에서 판매주문이 `shipped`·`delivered` 면
**FO 없이 반환**한다(로그 한 줄). 잠금 아래에서 검사해야 «판정 직후 셀메이트 스크립트가 돈» 틈까지 막힌다.

워커는 이미 «`create` 가 FO 없이 돌아오면 backlog 를 `not_required` 로 닫는다»(디지털 전용 주문과 같은 길)라 워커는 고치지 않는다.
`create` 를 부르는 곳은 워커와 `POST /fulfillments` 컨트롤러다(나머지는 테스트 픽스처). admin-web 의 수동 생성은 `salesOrderId` 없는
단독 FO(`createStandalone`, items 기반)라 가드에 닿지 않고, 컨트롤러에 `salesOrderId` 를 넘긴 호출이 오면 같은 가드가 걸려 FO 없이 돌아온다. 컷오버 뒤에는 core 가 판매주문을 `shipped` 로 쓰지 않으므로(ADR-0017)
이 가드는 저절로 할 일이 없어진다.

### 5.2 공유 판정 `isFulfillableMatching`

`FulfillmentsService` 의 `isVoidMatching`·`getPhysicalSkuLinks` 를 product-matching 쪽 순수 함수로 꺼낸다:
`matched + void`, 또는 `matched + variant + 링크 1개 이상`. 동작을 바꾸지 않는 리팩터이고, FO 생성과 12번 규칙이 같이 쓴다(§4.4-2).

### 5.3 주문 하나만 깨우는 도메인 함수

backlog 서비스에 `requeueAwaitingMatching(salesOrderId, tx)` 를 더한다. `status = 'awaiting_matching'` 인 그 주문의 행만 `pending` 으로
(CAS, `wakeBacklogsWaitingForVariant` 와 같은 칸 초기화), 정비 모드 게이트도 같다. 기존 `wakeBacklogsWaitingForVariant` 는 variant 단위라
그 variant 를 기다리는 **모든** 주문을 깨워, 주문 단위로 횟수를 세는 리컨실러가 쓰면 자기 대상 밖을 건드린다.

### 5.4 규칙 `wake-awaiting-matching`

| 항목 | 내용 |
| --- | --- |
| `row` / `mode` | 12 / `observe` (첫 배포) → `act` (§7 전환 PR, 2026-10-09) |
| `situation` | `fo` / `awaiting_matching` (투영의 `fo` 단계 세부 상태 = backlog 상태, 보드 스펙 §4.3-5) |
| `fingerprint` | backlog `waiting_variant_ids`(정렬) + 각 variant 매칭의 상태·전략·링크(skuId:수량). `updated_at` 은 upsert 가 올리지 않아 쓰지 않는다 |
| `check` | ① 정비 모드면 false ② backlog 가 아직 `awaiting_matching` ③ `waiting_variant_ids` 가 비어 있지 않고 **전부** `isFulfillableMatching` |
| `act` | `requeueAwaitingMatching(salesOrderId, tx)` |

라이브 예상(10-08 기준): 관찰 첫 주의 `would_act` 는 거의 0건이다(§1.3 의 113건은 투영에서 빠지고 진행 중 6건은 아직 미매칭).
관찰이 증명하는 건 «엉뚱한 주문을 고르지 않는다»까지이고, «제대로 깨운다»는 통합 테스트(§8)가 증명한다.

### 5.5 매칭 명령 — 링크 0개를 만드는 길을 막는다

1. **`PATCH /matchings/:id/strategy` 는 `void` 로 바꾸는 것만 받는다.** `variant` 요청은 `BadRequestError`(`@app/shared`):
   «variant 전략은 SKU 연결과 함께 매칭 저장(`PUT /matchings/:variantId`)으로 한다». `variant → variant` 가 링크를 지우던 결함도 함께 사라진다.
   variant → void 는 그대로(링크 삭제 + `void`) — 깨우기는 리컨실러 몫이다(D4)
2. **매칭 upsert 에 빈 `links: []` 로 기존 링크를 지우면 `pending` 으로 내린다**(`status = 'pending'`, `strategy = NULL`, `isResolved = false`).
   판매 사유는 `MATCHING_LINK_MISSING` → `MATCHING_PENDING` 으로 바뀌지만 둘 다 «재고 무관 판매»라 스토어프론트는 그대로다.
   위 스펙(«removes existing SKU links …»)은 이 동작으로 바꾼다. 정책만 저장하는 경로(`isPolicyOnlySave`)는 그대로다

### 5.6 admin-web 매칭 편집 창

`features/matching/variants/components/editor-dialog` 와 `features/matching/products/components/variant-editor-dialog`
(`VariantMatchingPanel` — 매칭 상품 표와 판매상품 상세의 variants 탭이 쓴다) 는 링크 저장(upsert)과 전략 변경을 `Promise.all` 로 동시에 보내
void → variant + 링크 추가에서 경합한다(뒤쪽은 core 가 variant 전략 변경을 거절한 뒤로 저장이 돼도 늘 실패 토스트를 띄운다). 고친 뒤:

- **variant 로**: upsert 하나만(upsert 가 `variant` 를 직접 쓴다). 링크가 비면 화면에서 막는다
- **void 로**: 전략 변경 → 정책 저장 순서로
- 우선순위 변경은 지금처럼 따로
- **매칭이 아직 없는 variant**(products 쪽 패널만): 링크가 붙으면 upsert 하나(매칭을 만든다), 정책만 바뀌면 variant 재고 정책
  경로(`PUT /matchings/variants/:variantId/stock-policy`). 바꿀 매칭이 없으니 전략·우선순위는 보내지 않는다
- `pending` 매칭의 화면 기본값 `variant` 는 전략 변경으로 치지 않는다 — 정책만 바꾸면 링크 없는 upsert(정책만 저장)
- 실패하면 창(패널)을 닫지 않는다 — 앞 단계가 저장됐어도 실패 토스트를 띄우고 다시 저장할 수 있게 둔다

이 판단은 `.ts` 순수 함수 `planMatchingSave(현재, 편집본)` 로 두고 테스트한다(admin-web 은 컴포넌트 테스트를 쓸 수 없다).
`features/order/matching/.../InventoryMatchingDialog.tsx` 는 `void` 로만 전략을 바꾸므로 고치지 않는다.

### 5.7 기존 20건 — 일회성 스크립트

`scripts/ops/1016-row12-demote-zero-link-matchings.ts` — 기본 dry-run, `--apply` 일 때만 쓴다. `UPDATE` 의 WHERE 에서 조건
(`matched + variant + 링크 없음`)을 다시 걸어 그 사이 링크가 붙은 행은 건드리지 않는다. 바꾼 variant id 를 파일로 남기고 기존
`recalc-sellable` 러너(`docs/runbooks/selmate-stock-pipeline.md` Ⓐ)로 판매 가능 수량 이벤트를 다시 발행한다.

## 6. 정체 보드 — «자동 멈춤» 표시

- `GET /order-progress/summary`: 단계·세부 상태마다 `gaveUp`(포기 행이 하나라도 있는 주문 수)
- `GET /order-progress/orders`: 주문마다 `gaveUp: Array<{ rule: string; row: number; since: string; lastError: string | null }>`
- 화면: 0건이면 아무것도 안 보인다. 1건 이상이면 단계 카드에 «자동 멈춤 N», 목록 행에 «자동 멈춤 · #12» 배지, 배지 위에 마지막 오류
- 필터·«다시 시도» 버튼은 없다. 체류 긴 순 정렬이 이미 위로 올리고, 재시도는 1024분 주기가 맡는다
- 화면 판단(배지 문구·표시 여부)은 `.ts` 순수 함수. admin-web 응답 shape 는 `gaveUp` 이 없어도 동작해야 한다(§9 배포 순서)

## 7. 관찰 → 실행 전환

1. 배포 후 관찰 기간 동안 아래로 «했을 일»을 본다
2. 거짓 양성(이미 처리됐거나 깨우면 안 되는 주문) 0건이면 규칙의 `mode` 를 `'act'` 로 바꾸는 PR
3. #1016 운영 작업 체크박스에 «12번 관찰 → 실행 전환»을 둔다

```sql
SELECT s.rule, s.sales_order_id, s.last_result, s.fingerprint, s.updated_at,
       p.stage, p.state, p.stage_entered_at, so.status AS so_status,
       b.status AS backlog_status, b.waiting_variant_ids
  FROM order_reconcile_state s
  JOIN order_progress p ON p.sales_order_id = s.sales_order_id
  JOIN sales_orders so ON so.id = s.sales_order_id
  LEFT JOIN fulfillment_order_creation_backlogs b ON b.sales_order_id = s.sales_order_id
 WHERE s.rule = 'wake-awaiting-matching' AND s.last_result = 'would_act'
 ORDER BY s.updated_at DESC;
```

## 8. 테스트

1. **단위** `nextReconcileState`: §4.5 의 표 전부 — 시도 1~5 간격, 포기 전이, 포기 뒤 1024분, `not_needed`·`would_act`, 지문 변경 리셋, 관찰→실행
2. **틀 통합** (`describeIfDb`, `--runInBand`), 가짜 규칙으로:
   - backlog 는 `awaiting_matching` 인데 투영이 `external_shipped` 인 주문을 **고르지 않는다**
   - 한 후보의 `act` 예외가 다른 후보를 막지 않고, 실패 행에 `error` 가 남는다
   - 관찰 모드는 `act` 를 부르지 않는다
   - 상황을 떠난 주문의 행이 지워진다
   - 주기당 상한 50, `next_check_at` 이 안 된 행은 건너뛴다
3. **12번 규칙 통합**: 기다리던 variant 가 모두 매칭됨 → `pending` 으로 깨움 / 하나라도 미매칭 → `not_needed` / 정비 모드 → `not_needed` /
   링크 0개 매칭을 기다림 → `not_needed` / 포기 뒤 매칭 수정 → 지문 리셋으로 다시 시도
4. **가드 통합**: 판매주문 `shipped` 인 backlog 를 깨워 워커를 돌리면 FO 없이 `not_required`, 예약·상자 0
5. **매칭**: `variant` 전략 변경 거절, `variant → variant` 거절, 빈 링크 upsert → `pending`(기존 스펙 교체), `isFulfillableMatching` 표
6. **admin-web 순수 함수**: `planMatchingSave`, 보드 응답 shape(`gaveUp` 없는 응답 포함)

## 9. 배포

1. 마이그 1건(`order_reconcile_state` 테이블 + 인덱스, additive) — expand 라 **`db:migrate` → `sst deploy`**
2. core 와 admin-web 은 한 스택이라 배포 순서를 정할 수 없다. 어느 순서로 떠도 깨지지 않게 만든다:
   보드 화면은 `gaveUp` 이 없어도 동작하고, 새 편집 창은 옛 core 에도 upsert 만 보낸다. 옛 편집 창이 새 core 를 만나는 틈에는
   전략 변경 요청 하나가 400 토스트를 띄울 수 있다(데이터는 upsert 가 이미 저장)
3. 배포 후 §5.7 스크립트 dry-run → `--apply` → `recalc-sellable`
4. 관찰 기간 → §7 → 실행 모드 PR

## 10. 범위 밖

- 재판정 묶음의 나머지 행(11·16·18·25·29·30). 상자 대상과 종료된 주문을 받는 틀의 모양은 §11 이 정한다
- 리컨실러 자체가 멈췄을 때의 화면 표시 — 지금은 보드의 갇힘 건수가 늘어나는 것으로 간접적으로 보인다
- 이미 생긴 FO·예약·draft 상자 청소, 일일 상자 종결(Ⓒ)의 기준 — #923 §E
- 셀메이트로 출고된 주문의 `awaiting_matching` backlog 일괄 종결 — #923
- 정체 보드의 «다시 시도» 버튼

## 11. 재판정 대상 일반화 — 주문에서 «주문·상자»로 (2026-10-08 추가)

### 11.1 배경

§4 의 틀은 후보 하나 = 판매주문 하나다. 규칙 interface 가 `salesOrderId` 만 받고(`order-reconcile.rule.ts`), 후보는
`order_progress` 에서 고르는데 그 투영은 주문마다 «가장 뒤처진 단위» 하나만 남긴다(`order-progress.judge-sql.ts` 의 `rep`).
12번은 주문 단위의 일이라 맞았지만, 남은 재판정 행은 대상이 다르다.

| 대상 | 행 | 지금 틀에서 생기는 일 |
| --- | --- | --- |
| 주문 | 11 · 12 · 16 | 맞는다 |
| 상자 | 18 · 25 · 30 | 형제 상자가 더 뒤처진 단계에 있으면 가려져 후보가 안 된다. 합포장 상자는 걸친 주문 수만큼 규칙이 돈다 |
| 끝난 주문 | 29 | 후보 조건 `outcome IS NULL` 에 걸려 후보조차 안 된다 |

그리고 «투영은 최대 1분 늦다»(§4.4-4)를 막는 것이 규칙마다의 `check` 다. 12번의 `check` 는 매칭·backlog 만 다시 읽고 판정 SQL 의
우선순위(채널 취소 요청·외부 출고·반품·교환)는 다시 보지 않는다. 12번이 안전한 것은 FO 생성 도메인 가드(§5.1) 덕이다.
`OrderProgressReader.judge()` 는 이 재판정을 위해 있지만 운영 코드에서 부르는 곳이 없다.

### 11.2 결정 (사용자 결정 2026-10-08)

| # | 질문 | 결정 | 기각한 안과 이유 |
| --- | --- | --- | --- |
| D11 | 언제·얼마나 만드나 | **설계는 지금 확정한다. 상자 종류 구현은 첫 상자 행과 같은 PR 에 넣는다** | 틀만 단독 PR: 쓰는 규칙이 없는 seam 이라 모양을 추측한다 / 규칙마다 `check` 안에서 주문→상자 우회: 우회가 행마다 쌓이고 나중에 틀을 바꾸면 규칙을 같이 고친다 |
| D12 | 실행 직전 재확인 | **틀이 savepoint 안에서 대상을 실시간 판정하고, 규칙의 칸을 벗어났으면 `not_needed`** 로 넘긴다. `check`·도메인 가드(§4.4-6)는 그대로 | 규칙마다 `check` 책임: 판정 SQL 의 우선순위를 규칙 작성자가 매번 다시 구현해야 한다 |
| D13 | `act` 가 할 일이 없었을 때 | **`act` 는 `'acted' \| 'noop'` 을 돌려준다. `noop` 은 `not_needed` 로 기록하고 횟수를 올리지 않는다** | `void`: 사람이 먼저 처리한 주문도 `acted` 로 기록되고 시도 횟수가 오른다 |
| D14 | 대상 종류 | **주문 · 상자 둘.** 끝난 주문은 주문 종류의 다른 칸(D19)이다 | FO 를 셋째 종류로: 판매주문과 0..1 : 0..1 이라 따로 둘 이유가 약하다 / 열린 문자열: 오타가 조용한 무작동이 된다 / 예약: 30번도 실제 대상은 `CANCEL_REPLAN_PENDING` 상자이고 예약은 그 처리에서 따라 풀린다 |
| D15 | 상자 후보의 출처 | **판정 SQL 을 «상자별 결과»와 «주문으로 접기» 둘로 나누고, 틀이 매 바퀴 상자별 결과를 실시간으로 돌려 후보를 고른다.** 상자 투영 테이블은 두지 않는다 | 상자 투영 테이블: 판정의 저장 사본이 하나 더 생기고 1분 지연이 따라온다 / 규칙별 후보 SQL: §4.4-1 위반 |
| D16 | 상자의 주문이 주문 단위 예외 상태일 때 | **틀이 고정 목록으로 뺀다.** 상자에 라인이 있는 주문 중 하나라도 주문 판정이 «채널 취소 요청 중 · 외부 출고 · 반품·교환»이면 후보가 아니다. 취소된 주문(`cancel_open`·`cancelled`)은 30번이 다뤄야 하므로 통과한다 | 규칙마다 허용 상태 선언: 하나가 빠뜨리면 셀메이트 출고 주문을 건드린다(D1 의 교훈) / 빼지 않음: 도메인 가드만으로는 «건드리면 안 되는 주문»을 다 표현하지 못한다 |
| D17 | 상자 규칙의 시도 기록 | **새 테이블 `shipment_reconcile_state`** (상자 FK cascade). 저장소가 종류별 테이블을 고른다 | `order_reconcile_state` 를 `(rule, subject_kind, subject_id)` 로 일반화: PK 변경이라 expand-contract 로 PR 이 여러 개가 되고 FK 를 잃는다 |
| D18 | 상자 규칙의 포기 표시 | **그 상자에 라인이 있는 주문마다 «자동 멈춤 · #행» 배지.** 합포장이면 여러 주문에 같이 뜬다 | 보드에 상자 목록: 운영자는 주문으로 찾아온다 |
| D19 | 끝난 주문을 보는 규칙(29번) | **`situation` 이 단계 대신 종료 결과(`delivered`)를 지정할 수 있다. 틀은 최근 N일 안에 끝난 주문만 훑는다.** N 은 29번에서 정한다 | 29번 때 결정: 그 행이 틀을 다시 연다 |
| D20 | 첫 상자 행 | **25번(`CONSOLIDATION_PENDING` 재개)** | 30번: 재고 예약을 푸는 규칙이 첫 상자 사례가 된다(D2 와 같은 이유). 주문 하나짜리 상자는 이미 주문 단위(`cancel_open`)로 보인다 / 18번: B 분류라 자동 계획이 맞는지부터 정책 판단이 필요하다 |

### 11.3 규칙 interface

```ts
type ReconcileSubject = 'order' | 'shipment';

interface ReconcileRule<K extends ReconcileSubject> {
  readonly name: string;
  readonly row: number;
  readonly mode: ReconcileMode;
  readonly subject: K;
  readonly situation: K extends 'order'
    ? { stage: OrderProgressStage; states: readonly OrderProgressState[] } // 진행 중
      | { outcome: 'delivered' }                                           // 끝난 주문(D19)
    : { stage: ShipmentStage; states: readonly ShipmentState[] };        // 상자별 판정 결과
  fingerprint(id: string, tx: DbTx): Promise<string>;
  check(id: string, tx: DbTx): Promise<boolean>;
  act(id: string, tx: DbTx): Promise<'acted' | 'noop'>;
}
```

- 단계·세부 상태 어휘는 TS union 이다(`OrderProgressState`·`ShipmentStage`·`ShipmentState`). 지금 `states` 가 `string[]` 이라
  오타가 «영원히 후보 없음»이 되고, `deleteDeparted` 가 그 규칙의 행을 조용히 지운다
- 규칙 작성자가 아는 것은 대상 종류 · 칸 · `fingerprint` · `check` · `act` 뿐이다. 후보 선택 · 주문 단위 예외 제외(D16) ·
  실행 직전 재판정(D12) · 시도·포기 기록(종류별 테이블)은 틀이 진다

### 11.4 한 바퀴의 변화 (§4.3 에 더한다)

1. **후보**: 주문 규칙은 지금처럼 `order_progress` 에서(종료 결과 칸이면 D19 의 기간 안 종료 행에서). 상자 규칙은 바퀴마다 상자별
   판정을 한 번 돌려(진행 중 주문 범위, 같은 바퀴의 상자 규칙끼리 공유) `(stage, state)` 가 칸에 맞고 D16 제외에 걸리지 않는 상자를 고른다.
   합포장 상자는 상자 하나로 한 번만 나온다. 정렬은 단계 진입 추정 시각 오래된 순, 규칙당 주기마다 최대 50건(§4.3-1 과 같다)
2. **떠남**: 상자 규칙의 행 중 상자가 더 이상 칸에 없거나 D16 제외에 걸린 것을 지운다. 10분 유예(`DEPARTURE_GRACE_MIN`)는 같다
3. **재판정 게이트(D12)**: savepoint 안에서 `fingerprint` 전에 대상을 실시간 판정한다. 주문은 `judge([id])`, 상자는 그 상자에 라인이 있는
   주문들을 범위로 한 상자별 판정에서 그 상자를 찾는다. 칸을 벗어났거나 D16 제외면 `not_needed`. 게이트의 «칸 안인가» 판단은
   순수 함수로 떼어 유닛 테스트한다.
   칸 밖이면 바퀴 요약에 `gated` 로 따로 센다(매분 0 이 아니면 투영 갱신이 늦거나 멈춘 것). 상태 행은 **직전 결과가 `acted`·`error` 이고
   떠남 유예(`DEPARTURE_GRACE_MIN`) 안일 때만 쓰지 않는다** — 그 행을 `not_needed` 로 덮으면 유예가 풀려 «깨움→되돌아옴» 횟수가 리셋된다.
   그 밖에는 이전 지문으로 `not_needed` 를 기록해 10분 물러나게 한다 — 안 쓰면 투영 갱신이 멈췄을 때 같은 후보가 매분 맨 앞 50칸을
   차지해 뒤의 주문이 굶는다. 판단은 순수 함수 `shouldRecordGateOut`(유예 정의는 `deleteDeparted` 와 같다) (사용자 결정 2026-10-08)
4. **`act` 결과(D13)**: `noop` 은 `not_needed` 와 같이 기록한다(10분 뒤, 횟수 그대로)

### 11.5 판정 SQL 분리 (D15)

`judgedRowsSql` 의 `units` 까지를 «상자별 결과»로 꺼낸다. 칸은 `sales_order_id · shipment_id · stage · state · est` 에
그 주문의 주문 판정(`decided.rule`)을 더한 것이다. 기존 «주문으로 접기»(`rep` 부터)는 그 결과를 읽는다 — 판정 정의는 한 벌로 남는다.
직배(`fulfillment_mode = 'drop_ship'`) 단위는 상자가 없으므로 상자 후보가 아니다.

### 11.6 순서

1. **틀 보강 PR** (마이그 없음): D12 재판정 게이트, D13 `act` 결과, 어휘 TS union. 12번 규칙도 `'acted' | 'noop'` 을 돌려준다
   (`requeueAwaitingMatching` 의 CAS 결과). 게이트 판단 순수 함수 유닛 테스트
2. **12번 실행 모드 전환 PR** (§7). 1번 뒤라 관찰 기록도 게이트를 통과한 것만 남는다
3. **25번 PR**: §11.5 분리, 상자 종류, `shipment_reconcile_state`(additive — **`db:migrate` → `sst deploy`**), 25번 규칙(관찰 모드, D5),
   보드 배지(D18). admin-web 은 상자 규칙 배지가 없어도 동작해야 한다(§9-2 와 같은 이유)

§2 의 성공 기준 5(«틀은 고치지 않는다»)는 3번에서 한 번 깨진다. 그 뒤 상자 행(18·30)과 29번은 다시 규칙 파일 하나 + 등록 한 줄이다
(29번은 D19 의 기간 N 을 정하는 것까지).

### 11.7 범위 밖

- 판정 SQL 을 CI 에서 돌리는 것 — core 통합 스펙(`describeIfDb`)을 CI 에서 돌리는 job 이 없다. #1033
- 16번(backlog `failed` 상한)의 재시도 장치 중복 — backlog 자체 백오프와 리컨실러 백오프 중 하나만 상한을 가진다. 그 행에서 정한다
