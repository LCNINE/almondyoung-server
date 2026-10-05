# 수집 뒤 채널 변경 — 대기 변경 닫기와 옛 격리 종결 (#1016 6번 행)

트래킹: #1016 6번 행. 앞선 작업: 5번 행 스펙 `docs/superpowers/specs/2026-10-05-channel-order-change-sync-design.md`
(이하 «5번 스펙»). 관련: #1016 35번 행(채널 먼저 취소·수정 — 이 스펙이 놓는 명령 스트림을 쓴다).

## 1. 배경 — 5번 행이 6번 행의 모양을 바꿨다

6번 행은 «격리 행을 닫을 수단이 없다(처리완료·무시, 무엇이 바뀌었는지 표시). 상품 metadata 만 바뀌어도 격리되는 오탐 포함»으로
적혔다. 5번 행(`144647ffb`·`4f303e3ab`, 10-06 라이브)이 수집 뒤 변경을 격리 대신 core diff 로 보내면서 넷 중 하나는 풀리고,
하나는 이미 있고, 둘이 남았다.

| 6번 행의 항목 | 지금 | 근거 |
| --- | --- | --- |
| 옛 격리 행 닫기 | **남음.** `collected_order_modification_not_accepted` 격리 행은 더 생기지 않지만, 있던 행은 `quarantined` 그대로다. 이 사유는 replay 도 안 된다(`not_replayable`). 격리 목록과 메뉴 배지가 이 행들로 차서 진짜 격리(식별 실패)를 가린다 | `order-poller.orchestrator.ts`(이 사유를 쓰는 곳 없음, replay 분기만 남음), `quarantine-menu-badge.tsx` |
| 새 «반영 대기 변경» 닫기 | **남음.** core `sales_order_amendments` 의 `origin = channel`·`status = pending` 행은 채널이 core 와 같아져 `superseded` 되거나 판매주문이 취소돼 목록에서 빠질 때만 사라진다. 사람이 손으로 맞췄거나 «어긋난 채 둔다»고 정한 것을 남길 칸이 없다 | `sales-order-amendments.service.ts` `recordChannelAmendment`, `pending-changes-table/index.tsx` |
| 무엇이 바뀌었는지 표시 | **있음(새 행).** 대기 목록이 델타 요약과 막힌 사유를 보여 준다. 옛 격리 행은 새 스냅샷(`raw_order`)만 있어 보여 줄 수 없지만 일괄 종결하므로(§3 D1) 필요 없다 | `sales-order-amendments.shape.ts` `summarizeDelta`·`blockerLabel` |
| PIM 식별만 바뀐 오탐 | **풀림.** 해시는 여전히 우리 쪽 식별을 포함해 바뀌지만 core diff 는 식별을 보지 않아 델타 0 → 기록 없음(5번 스펙 성공 기준 4) | `channel-order-diff.ts`, `channel-order-diff.spec.ts` |

10-05 라이브 실측(#1016 «라이브 실측»): 옛 격리 `quarantined` 3,004 = 판매주문 `shipped` 2,888 · `cancelled` 80 · `pending` 29 ·
`delivered` 4 · 판매주문 없음 2 · `confirmed` 1. 5번 행 백필 판단(10-06)이 pending·confirmed 30건을 «반영할 실물 없음»으로 확인했다.

## 2. 목표와 성공 기준

1. 옛 `collected_order_modification_not_accepted` 격리 행이 하나도 `quarantined` 로 남지 않는다 — 격리 목록·배지에서 사라진다
2. 운영자가 «반영 대기 변경» 행을 **무시**(어긋난 채 둔다)로 닫을 수 있고, 누가·언제·메모가 남는다
3. 운영자가 «반영 대기 변경» 행에 **다시 확인**을 걸 수 있다 — 채널에서 그 주문을 다시 끌어와 core 와 다시 비교한다.
   맞춰졌으면 지금 규칙대로 `superseded` 로 사라지고, 아직 다르면 남는다
4. 무시한 차이와 **똑같은 차이**로는 pending 이 다시 생기지 않는다. 새 차이가 섞이면 다시 생긴다
5. core 는 channel-adapter 를 직접 부르지 않는다 — «다시 확인»은 명령 스트림으로 간다(§3 D2)
6. `npm run type-check` 에러 0 · `npx jest` 실패 0 · admin-web `tsc --noEmit` 0

## 3. 결정 (사용자 결정 2026-10-06)

| # | 질문 | 결정 | 기각한 안과 이유 |
| --- | --- | --- | --- |
| D1 | 옛 격리 행 | **일괄 종결.** 새 상태 `closed_obsolete` 로 스크립트가 한 번에 닫는다 | 행별 닫기 버튼: 3,004건을 하나씩 누를 수 없고, 이 사유는 다시 생기지 않는다 / 둘 다: 쓰일 일 없는 버튼 |
| D2 | core 가 채널 재확인을 어떻게 요청하나 | **명령 스트림 `channel-orders.commands.v1` 의 `ResyncChannelOrder`.** core 는 «채널 주문을 다룰 줄 아는 누군가»에게 요청할 뿐 그게 channel-adapter 인지 모른다 | core → channel-adapter HTTP: channel-adapter 는 «외부 세계의 일을 이벤트로 번역하는» 자리이고 core 는 그와 독립적으로 돈다는 원칙을 처음으로 깬다. 지금 core 에는 channel-adapter HTTP 클라이언트가 없다 / `*.events.*` 토픽: 이건 사실이 아니라 실행자가 하나인 요청이다 |
| D3 | 토픽 이름 | **역할 이름**(`channel-orders`). 명령 이름은 명령형 | `channel-adapter.commands.v1`: core 가 서비스 이름을 알게 된다. 기존 `wallet.commands.v1`(받는 쪽 이름)·`ugc.commands.v1`(보내는 쪽 이름)은 기준이 서로 다르다 / `…Requested` 과거형: 명령과 사실의 구별이 흐려진다 |
| D4 | 닫는 방법 | **«무시» + «다시 확인».** 무시 = `dismissed`. 다시 확인 = 명령 + 요청 시각 표시 | «처리완료» + «무시»(확인 없음): 실제로 안 맞췄는데 처리완료로 닫힌 행을 아무도 못 잡는다 / «무시» 하나: 사람이 맞춘 주문은 다음 채널 이벤트까지 남는다 |
| D5 | 다시 확인의 실패 | **돌려주지 않는다.** 화면은 «확인 요청 n분 전»만 보여 주고, 오래 그대로면 사람이 알아챈다 | 결과 이벤트: 결과 경로가 하나 더 생긴다. 실패가 돈과 걸리는 35번 행에서 필요해지면 붙인다 |
| D6 | 무시한 변경이 다시 올 때 | **똑같은 차이면 다시 띄우지 않는다.** 그 판매주문의 가장 최근 무시 행과 델타 지문을 비교한다(§6) | 매번 다시 띄움: PIM 변경만으로 해시가 바뀌어 무시가 무의미해진다 / 주문 단위 음소거: 나중의 진짜 새 변경(송장 뒤 배송지 변경 등)까지 숨긴다 |

## 4. 옛 격리 행 일괄 종결 (channel-adapter)

### 4.1 상태

`order_collection_failures.status` 는 varchar 라 스키마 변경이 없다. `OrderCollectionFailureStatus`(`apps/channel-adapter/src/types.ts`)와
`schema.ts` 의 상태 주석에 `closed_obsolete` 를 더한다:

> `closed_obsolete`: 이 격리를 만든 경로가 사라졌다. 지금은 `collected_order_modification_not_accepted` 뿐이다 —
> 수집 뒤 변경은 #1016 5번 행부터 core diff 로 간다. 할 일이 남아 있지 않다.

replay(`replayFailure`)·`buildReplayPath` 는 이미 «`quarantined` 가 아니면 종결»로 판정하므로 새 상태를 따로 다룰 필요가 없다.
격리 화면과 배지는 `status = quarantined` 만 세므로(`useQuarantinedFailures`) 닫는 것만으로 사라진다 — 필터를 바꾸지 않는다.

### 4.2 스크립트

`scripts/ops/1016-close-obsolete-modification-quarantines.ts`. 5번 행 백필 스크립트와 같은 꼴:

- `sst shell` 안에서 channel_adapter DB 에 붙는다
- 기본은 dry-run — 대상 수만 센다(채널별)
- `--apply` 일 때 한 문장으로 닫는다:
  `UPDATE order_collection_failures SET status = 'closed_obsolete', updated_at = now()
   WHERE reason = 'collected_order_modification_not_accepted' AND status = 'quarantined'`
- 바뀐 행 수를 출력한다. 다시 돌리면 0 이다(멱등)

마이그레이션에 넣지 않는다 — 라이브 데이터를 바꾸는 일이라 수를 먼저 보고 사람이 실행한다.

## 5. amendment 닫기 (core)

### 5.1 칸

`sales_order_amendments`(`inventory.schema.ts`)에 더한다. 전부 nullable 추가 → `migrate → deploy`.

| 칸 | 값 | 비고 |
| --- | --- | --- |
| `status` | 기존 `applied`·`pending`·`superseded` 에 **`dismissed`** | `sales_order_amendments_status_check` 를 넓힌다(DROP + ADD). 넓히기라 옛 코드와 충돌하지 않는다 |
| `dismissed_at` | timestamp | |
| `dismissed_by` | uuid | 사용자 id. `created_by` 와 같은 타입 |
| `dismiss_note` | text | 선택 |
| `resync_requested_at` | timestamp | 마지막 «다시 확인» 시각 |

`AmendmentStatus` 타입·`ListSalesOrderAmendmentsQueryDto` 의 `status` enum·응답 DTO 에 새 값과 칸을 싣는다.

### 5.2 무시

`POST /sales-order-amendments/:id/dismiss` · 본문 `{ note?: string }`

- 행을 잠그고(`FOR UPDATE`) `origin = channel`·`status = pending` 이 아니면 `ConflictError`(409). 없으면 `NotFoundError`
- `status = dismissed`, `dismissed_at = now()`, `dismissed_by = 사용자`, `dismiss_note = note`
- 같은 판매주문의 `opened_amendment` 링크 metadata 는 고치지 않는다(생성 시점 기록이다)

무시된 행은 `superseded` 대상이 아니다(`recordChannelAmendment` 의 superseded 갱신은 `status = pending` 만 본다 — 지금 그대로).
무시 행은 §6 의 «무시 기준»으로 남는다.

### 5.3 다시 확인

`POST /sales-order-amendments/:id/resync`

- 행을 잠그고 `origin = channel`·`status = pending` 이 아니면 409
- 한 트랜잭션에서: `resync_requested_at = now()` + `ResyncChannelOrder` 를 outbox 에 enqueue
- 채널 키는 행의 `metadata.salesChannel`·`metadata.externalOrderId`(5번 행이 채움)에서 읽는다. 없으면 `Error`(500 — 채널 행이면 반드시 있다)
- 반복 요청을 막지 않는다. 시각만 갱신되고 명령이 한 번 더 간다(소비자가 멱등, §7.3)

두 엔드포인트의 인증·권한은 같은 컨트롤러의 기존 엔드포인트(`GET /sales-order-amendments`)와 같게 둔다.

> **계획 단계 수정(2026-10-06):** 무시·다시 확인은 `SalesOrderAmendmentsService` 가 아니라 `channel-order-change/channel-amendment-actions.service.ts` 의
> `ChannelAmendmentActionsService` 에 둔다 — 기존 서비스 생성자를 쓰는 통합 스펙이 10곳이고, 운영자 경로와 책임이 다르다.
> 명령의 `aggregateId` 는 채널 키다.

## 6. 무시 억제 (core)

### 6.1 지문

`channel-order-change/` 에 순수 함수 `deltaFingerprint(delta: RecordedChannelDelta | ChannelDelta): string`:

- `outcome`·`blockers` 를 뺀 델타를, 키를 정렬한 JSON 문자열로 만든다
- 같은 차이 = 같은 지문. 막힌 사유는 지문 밖이다 — 무시는 «이 차이를 받아들인다»는 뜻이라 그 사이 송장이 발급됐다고 다시 물을 이유가 없다

> **계획 단계 수정(2026-10-06):** 지문은 값이 `undefined` 인 키를 없는 키로 본다 — jsonb 왕복이 그 키를 버리므로, 기록 전후의 같은 차이가 다른 지문이 되지 않게 한다.

### 6.2 판정

`ChannelOrderChangeManager.handle` 에서 `settle` 이 끝난 뒤, `recordChannelAmendment` 직전에:

1. reader 가 그 판매주문의 **가장 최근 `dismissed` 채널 행**(`dismissed_at` 최신)의 `deltas` 를 읽는다. 없으면 억제 없음
2. 그 행의 델타 중 `outcome = pending` 인 것들의 지문 집합을 만든다
3. 이번 기록 델타 중 `outcome = pending` 인 것이 **전부** 그 집합 안에 있으면, pending 델타를 기록에서 뺀다
   - 반영된 델타가 남으면 `applied` 행이 된다
   - 아무것도 안 남으면 행을 쓰지 않는다(실질 차이 0 과 같은 처리 — 이전 pending 행은 `superseded_by_id = null` 로 superseded)
4. 하나라도 새 pending 델타가 있으면 억제하지 않는다 — 이번 이벤트의 델타 전부를 담은 새 pending 행이 생긴다

판정 자체는 순수 함수(`suppressDismissed(recorded, dismissedDeltas)`)로 두고 manager 는 읽기·호출만 한다.

«가장 최근 무시 행» 하나만 보는 이유: 운영자가 새 pending 행(옛 무시 차이 + 새 차이)을 다시 무시하면 그 행이 옛 차이까지 담는다.
여러 무시 행의 합집합을 보면 운영자가 나중에 «이건 이제 신경 쓴다»고 할 길이 없어진다(무시 취소는 범위 밖이지만 막아 두지 않는다).

> **계획 단계 수정(2026-10-06):** «가장 최근 무시 행»은 `dismissed_at DESC NULLS LAST, id DESC` 로 고른다.

### 6.3 순서와 동시성

판정은 `lockEffectiveOrder` 가 잡은 판매주문 잠금 아래에서 일어난다. 무시(§5.2)는 amendment 행만 잠그므로, 무시와 같은 주문의
`OrderModified` 처리가 겹치면 두 순서가 다 가능하다:

- 무시가 먼저 커밋 → 이벤트가 그 무시를 보고 억제
- 이벤트가 먼저 커밋 → 무시하려던 행이 `superseded` 가 되어 무시가 409. 화면은 목록을 다시 불러 새 행을 보여 준다

둘 다 결과가 맞다. 추가 잠금을 두지 않는다.

## 7. 명령 스트림

### 7.1 계약

`packages/event-contracts/streams/channel-orders-command.stream.ts`(신규), `index.ts` 에서 export(레지스트리가 export 를 모은다):

```ts
export const CHANNEL_ORDERS_COMMAND_STREAM = stream({
  topic: 'channel-orders.commands.v1',
  partitions: 3,
  aggregateType: 'ChannelOrder',
  events: {
    ResyncChannelOrder: event<'ResyncChannelOrder', ResyncChannelOrderPayload>('ResyncChannelOrder', ResyncChannelOrderSchema),
  },
});

interface ResyncChannelOrderPayload {
  salesChannel: string;      // 'medusa' | 'naver' … — 문자열로 두고 소비자가 지원 여부를 판정한다
  externalOrderId: string;
  requestedAt: string;       // ISO 8601
}
```

- 파티션 키: `${salesChannel}:${externalOrderId}` — 같은 주문의 명령(나중의 35번 행 취소 요청 포함)이 순서대로 처리된다
- 토픽은 선언만 하면 기동 때 `bootstrapKafkaTopics` 가 만든다(DLQ 포함)
- 파일 머리 주석에 «명령 스트림: 실행자가 하나인 요청. 토픽 이름은 서비스가 아니라 역할» 원칙과 D3 를 적는다

### 7.2 발행 (core)

`SalesOrderAmendmentsService` 에 `@InjectPublisher(CHANNEL_ORDERS_COMMAND_STREAM)`. 발행 스트림 선언은 `CORE_ORDER_STREAM` 이 있는
`fulfillment.module.ts` 의 `publishes` 목록에 더한다(그 선언이 기동 때 토픽도 만든다).

> **계획 단계 수정(2026-10-06):** outbox 행의 `payload` 칸은 봉투(envelope)라 명령 본문은 `payload.payload` 에 있다 — 통합 테스트가 그 모양으로 단언한다.

### 7.3 소비 (channel-adapter)

`apps/channel-adapter/src/consumers/channel-orders-command.consumer.ts`(신규):

- `@On(CHANNEL_ORDERS_COMMAND_STREAM, 'ResyncChannelOrder')` → `OrderPollerOrchestrator.syncOrder(channel, externalOrderId, { force: true })`.
  5번 행의 HTTP 입구와 같은 메서드다
- 지원 채널(`medusa`·`naver`)이 아니면, 그리고 `syncOrder` 결과가 무엇이든(`channel_inactive`·`not_found`·`not_eligible`·`identification_failed` 포함) **로그만 남기고 정상 종료**한다
  (D5 — 재시도해도 결과가 같다). 예상 밖 예외(채널 API 5xx·네트워크)는 던져서 기존 재시도 → DLQ 를 탄다
- 멱등: 같은 명령을 두 번 받아도 같은 스냅샷이 두 번 가고, core 가 두 번째를 실질 차이 0 으로 버린다(5번 스펙 §9.1)
- `adapter.module.ts` 의 `controllers` 에 등록한다. **빠뜨리면 구독이 조용히 안 된다** — 테스트로 지킨다(§10)
- `SYNCABLE_CHANNELS` 를 컨트롤러와 공유하도록 한 곳으로 옮긴다

## 8. 화면 (admin-web)

- **«반영 대기 변경» 목록**(`pending-changes-table`): 행마다 [다시 확인]·[무시]
  - [무시]: 메모 입력 하나(선택)가 있는 확인창 → `dismiss` → 목록 다시 불러오기
  - [다시 확인]: 바로 `resync` → 행에 «확인 요청 n분 전»(`resync_requested_at`) 표시. 응답 409 면 목록을 다시 불러온다(그 사이 superseded)
- **주문 상세 변경 기록**: `dismissed` 행을 «무시됨 · 누가 · 메모»로 보여 준다
- 상태 문구·시각 문구는 `sales-order-amendments.shape.ts` 의 순수 함수로(admin-web 은 컴포넌트 테스트를 못 한다). 설명 문구는 더하지 않는다
- 격리 화면 `guidance.ts` 의 `QuarantineStatus` 에 `closed_obsolete` 를 더한다(종결 상태 표시용)

> **계획 단계 수정(2026-10-06):** 주문 상세의 무시 표시는 «무시됨 · 날짜 · 메모»다. `dismissed_by` 는 저장만 하고 이름 조회는 하지 않는다.

## 9. 변경 지점

| 곳 | 변경 |
| --- | --- |
| `packages/event-contracts/streams/channel-orders-command.stream.ts`·`index.ts` | §7.1 |
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` + 마이그레이션 | §5.1 |
| `apps/core/src/modules/sales-order/services/sales-order-amendments.service.ts` | `dismiss`·`requestResync`, 발행자 주입 |
| `apps/core/src/modules/sales-order/controllers/sales-order-amendments.controller.ts`·DTO | 두 엔드포인트, `status` enum, 응답 칸 |
| `apps/core/src/modules/sales-order/channel-order-change/` | `deltaFingerprint`·`suppressDismissed`(순수), reader 의 최근 무시 행 조회, manager 호출 |
| `apps/core/src/modules/fulfillment/fulfillment.module.ts` | `publishes` 에 §7.1 |
| `apps/channel-adapter/src/consumers/channel-orders-command.consumer.ts`·`adapter.module.ts` | §7.3 |
| `apps/channel-adapter/src/types.ts`·`schema.ts`(주석) | `closed_obsolete` |
| `apps/channel-adapter/CLAUDE.md` | 명령 스트림 소비 한 줄(«core 는 직접 부르지 않는다 — 요청은 `channel-orders.commands.v1`») |
| `apps/admin-web` | §8 |
| `scripts/ops/1016-close-obsolete-modification-quarantines.ts` | §4.2 |

## 10. 테스트

- **지문·억제 순수 함수**(표 테스트): 같은 델타 → 같은 지문 · 막힌 사유만 다름 → 같은 지문 · 값이 다름 → 다른 지문 ·
  pending 전부 무시됨 → pending 0 · 하나 새것 → 전부 남음 · 반영 델타는 억제 대상 아님 · 무시 행 없음 → 그대로
- **core 서비스 단위**: `dismiss`·`resync` 가 `pending`/`channel` 이 아니면 409 · resync 가 시각 갱신과 enqueue 를 같은 tx 에서
- **core 통합**(`describeIfDb`):
  - 범위 밖 변경 → pending 1 → 무시 → 같은 스냅샷 재수신 → pending 0, 무시 행 그대로
  - 같은 상태에서 새 범위 밖 차이가 섞인 스냅샷 → pending 1(델타 둘)
  - 무시 뒤 주소 변경(자동 반영 가능) + 옛 차이 → applied 행 1, pending 0
- **channel-adapter**: 소비자가 `syncOrder(…, { force: true })` 를 부른다 · `channel_inactive`·미지원 채널은 던지지 않는다 ·
  예상 밖 예외는 던진다 · `adapter.module` 의 `controllers` 에 등록돼 있다
- **event-contracts**: 레지스트리에 토픽이 한 번 등록된다(기존 `registry.spec.ts`)
- **admin-web**: 상태·시각 문구 순수 함수
- **스크립트**: 대상 필터(사유·상태) 단위 테스트

> **계획 단계 수정(2026-10-06):** 스크립트는 분기 없는 고정 조건이라 단위 테스트를 두지 않고 dry-run 출력으로 확인한다(위 «스크립트» 항목 대체).

## 11. PR 과 배포

**PR 하나.** §5~§8 을 함께 낸다 — 나누면 버튼은 있는데 명령을 받는 소비자가 없는 틈이 생긴다. §4.2 스크립트도 같은 PR.

- 마이그레이션은 추가·넓히기뿐 → **`migrate → deploy`**
- 한 SST 스택이라 core 와 channel-adapter 의 배포 순서를 못 정한다. 새 core 가 먼저 뜨면 그 사이 «다시 확인» 명령은 토픽에 쌓였다가
  새 channel-adapter 가 뜨면 소비된다(토픽은 발행 쪽 `publishes` 선언으로도 기동 때 만들어진다) — 유실 없음
- 배포 뒤: 스크립트 dry-run 으로 수 확인(3,004 근처 기대) → 사람이 `--apply`

## 12. 범위 밖

- **운영자 amendment(`origin = operator`) 닫기:** 그 행을 만드는 화면이 없다
- **무시 취소(되돌리기):** 쓰는 곳이 없다. §6.2 가 막아 두지는 않는다
- **다시 확인의 결과 이벤트:** D5. 35번 행에서 필요해지면
- **채널 먼저 취소·수정:** 35번 행. 이 스펙의 명령 스트림에 `CancelChannelOrder` 등으로 더한다
- **5번 HTTP 입구(`POST /adapter/orders/:channel/:externalOrderId/sync`)의 운명:** 백필 스크립트가 쓰므로 둔다. 35번 행이 명령으로
  가면 호출자가 남지 않을 수 있다 — 그때 정한다
