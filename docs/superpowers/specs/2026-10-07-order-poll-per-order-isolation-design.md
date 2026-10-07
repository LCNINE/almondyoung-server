# 주문 수집의 주문 단위 격리 — 한 주문의 실패가 채널을 멈추지 않는다 (#1016 1번 행)

트래킹: #1016 1번 행. 이 행의 원래 문구는 «주문 적재(enqueue) 실패»만 말하지만, 이 스펙은 범위를 **수집 전 구간**
(조회·번역·주문 적재·lifecycle 적재)으로 넓힌다(§3 D1). 앞선 작업: 5번 행 스펙 `2026-10-05-channel-order-change-sync-design.md`
(즉시 끌어오기 `syncOrder`), 정체 보드 스펙 `2026-10-06-order-stall-board-design.md`(0단계 = 수집 격리).

## 1. 배경 — 주문 하나가 채널 수집을 영구히 멈춘다

`OrderPollerOrchestrator.poll()`(`apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.ts`)은
채널마다 `try/catch` 하나로 감싼 루프에서 주문·식별 실패·lifecycle 항목을 시각 순으로 처리한다. 항목 하나가 throw 하면:

1. 루프가 통째로 빠져나가 `recordSyncFailure` 만 남고 **워터마크가 저장되지 않는다**
2. 다음 5분 주기가 같은 `lastSyncAt` 에서 다시 조회하고, 같은 정렬로 **같은 항목에서 다시 죽는다**
3. 그 항목보다 앞선 주문은 건마다 자기 트랜잭션으로 커밋돼 다음 주기에 dedupe 되지만, **뒤의 주문은 한 건도 수집되지 않는다**

throw 의 대표 원인은 계약 위반이다. `StreamPublisher.enqueue` 는 적재 시점에 zod 로 검증하고(`validateOnPublish`, 기본 true —
`libs/events/src/publishers/stream-publisher.service.ts` `buildEventEnvelope`), 실패하면 적재 트랜잭션을 죽인다.
**이런 실패는 코드를 고치기 전엔 재시도로 풀리지 않는다.** #1016 2번 행(네이버 `+09:00` 이 `z.string().datetime()` 을
통과하지 못함)이 정확히 이 경로로 1번을 일으킨다.

같은 계열의 구멍이 수집 앞단에 둘 더 있다:

- **네이버 단건 조회 실패**는 로그만 남기고 건너뛴다(`naver-order.source.ts` `fetchOrdersInWindow` 의 주문별 catch).
  같은 창의 다른 주문이 워터마크를 그 주문의 변경 시각 뒤로 밀면, 2분 lookback 을 넘는 순간 **그 주문은 조용히 사라진다.**
- **번역기 throw** 는 `TranslatingOrderProvider.fetchOrders` 의 스냅샷 루프를 통째로 죽여 1번과 똑같이 채널을 멈춘다.

## 2. 목표와 성공 기준

1. 한 주문이 수집 어느 단계에서 실패해도 **같은 주기의 다른 주문은 전부 수집되고 워터마크가 전진한다**
2. 실패한 주문은 **잃지 않는다** — `order_collection_failures` 에 행으로 남고, 되살리면 주문과 그 lifecycle(취소·환불)이 모두 반영된다
3. 일시 오류는 **사람 손 없이** 풀린다 — 자동 재시도에 상한(4회)을 두고, 넘은 것만 사람 몫이 된다
4. 사람 몫인 실패는 정체 보드 0단계와 사이드바 배지에 **같은 숫자로** 보인다
5. 실패 기록 자체가 불가능하면(DB 장애) 지금처럼 주기 전체를 실패시키고 **워터마크를 멈춘다**
6. `npm run type-check` 0 · `npx jest` 0 · admin-web `tsc --noEmit` 0

## 3. 결정 (사용자 결정 2026-10-07)

| # | 질문 | 결정 | 기각한 안과 이유 |
| --- | --- | --- | --- |
| D1 | 범위 | **수집 전 구간을 주문 단위로 격리**: 조회·번역·주문 적재·lifecycle 적재 | 적재 단계만: 네이버 조회 실패의 조용한 유실과 번역기 throw 의 채널 정지가 남는다. 같은 장치로 닫히므로 나눌 이유가 없다 |
| D2 | 되살리는 주체 | **상한 있는 자동 재시도 → 소진되면 사람 몫** | 수동만: 네이버 일시 오류(5xx·429)마다 사람 일이 생기고 보드 0단계가 저절로 풀릴 행으로 찬다 / 상한 없는 자동: 계약 위반이 매 주기 조용히 실패하며 아무도 모른다 — 지금의 «조용히 갇힘»으로 되돌아간다 |
| D3 | 구조 | **기존 루프에 주문 단위 격리를 끼우고, 재시도는 같은 크론의 채널 주기 끝에 둔다** | 폴링 항목을 주문별로 묶어 재구성: 전역 시각 정렬과 워터마크 hold(`holdWatermark`·격리 주문의 lifecycle) 를 다시 짜야 한다 — 868줄 파일의 가장 민감한 부분이라 회귀 위험이 크고, 얻는 것(주문 단위가 구조로 보임)은 «이번 주기 실패 주문 집합»으로 거의 다 얻는다 |
| D4 | 워터마크 | **실패를 기록했으면 지나간다. 기록하지 못했으면 멈춘다** | 실패 항목 앞에 워터마크를 붙잡기: 네이버는 닫힌 창 `[since, since+24h]` 으로 조회하므로 붙잡은 지 24시간 뒤부터 새 주문이 창 밖으로 밀려 결국 다시 멈춘다 |
| D5 | 되살리는 길 | **`syncOrder` 의 처리부 하나** — 자동 재시도·수동 replay·즉시 끌어오기가 같이 쓴다 | 실패한 항목(lifecycle payload 등)을 저장해 두고 재생: lifecycle 은 스냅샷에서 다시 만들어지므로 저장할 필요가 없고, 저장본은 채널의 현재 상태와 갈린다 |

## 4. 실패 기록 모델

### 4.1 새 사유 하나

`order_collection_failures` 에 reason `order_collection_processing_failed` 를 더한다
(`channel-order-provider.interface.ts` 의 `OrderCollectionFailureReason` 유니온, 상수 `ORDER_COLLECTION_PROCESSING_FAILED`).
유니크 키가 `(channel, external_order_id, reason)` 이므로 **한 주문의 처리 실패는 항상 한 행**이다 — 어느 단계에서 실패하든
같은 주문이면 같은 행에 쌓인다. 같은 주문에 식별 실패 행이 따로 열려 있을 수 있다(사유가 다르다).

### 4.2 컬럼 셋 (전부 추가형 — expand)

| 컬럼 | 타입 | 뜻 |
| --- | --- | --- |
| `attempt_count` | `integer not null default 0` | 지금까지 실패한 횟수. 처리 실패 사유만 쓴다 — 다른 사유 행은 0 으로 남는다 |
| `failed_stage` | `varchar(30) null` | 마지막으로 실패한 단계: `fetch` · `translate` · `enqueue_order` · `enqueue_lifecycle` |
| `last_error` | `text null` | 마지막 에러 메시지 |

기존 `error_message` 는 **종결 사유**를 적는 칸이다(`close()` 가 쓴다). 실패 원인과 섞지 않는다.

### 4.3 `raw_order` 에 담는 것

`raw_order` 는 NOT NULL 이다. 처리 실패 행에는 «실패한 그 입력»을 담는다:

| 단계 | `raw_order` |
| --- | --- |
| `fetch` | `{}` — 원본을 받지 못했다 |
| `translate` | 번역하려던 스냅샷 |
| `enqueue_order` | zod 가 거부한 `createPayload`(신규) 또는 `OrderModified` payload(수집된 주문) |
| `enqueue_lifecycle` | `{ eventType, eventKey, payload }` |

적재 실패의 원인(예: 2번 행의 `+09:00`)이 행 안에서 바로 보이게 하려는 것이다. 되살릴 때는 이 값을 쓰지 않는다(D5).

### 4.4 상태 전이

- **실패할 때마다** `OrderCollectionFailureService.recordProcessingFailure(channel, failure, tx?)` 가 같은 행을 upsert 한다:
  `attempt_count = attempt_count + 1`, `failed_stage`·`last_error`·`raw_order`·`source_updated_at` 갱신, `status = 'quarantined'`,
  `updated_at = now`. 기존 `recordFailure` 처럼 초기화하지 않고 **횟수를 누적한다** — 계속 바뀌는 주문도 결국 소진된다.
  종결된 행(`replayed`·`closed_*`)이 다시 실패하면 새 사건이므로 `attempt_count = 1` 로 다시 연다
  (`CASE WHEN status = 'quarantined' THEN attempt_count + 1 ELSE 1 END`). 이어서 세면 한 번 소진됐다 풀린 주문이 다음 실패에서
  자동 재시도 없이 곧바로 사람 몫이 된다.
- **어느 경로로든 성공하면**(다음 폴링 §5.4, 자동 재시도 §6, 수동 replay §6.5) `replayed` 로 닫는다(`markReplayed`).
- 되살리다 보니 종결 주문이거나 식별 실패로 바뀌었으면 §6.3 의 규칙으로 닫는다.

### 4.5 상한

상수 `PROCESSING_FAILURE_MAX_ATTEMPTS = 4` — 최초 실패 1회 + 자동 재시도 3회. 주기가 5분이고 재시도는 주기당 1회(§6.2)이므로
**소진까지 최소 15분**이다. `attempt_count >= 4` 인 열린 행이 **사람 몫**이다. 수동 replay 는 횟수와 무관하게 언제든 된다.

## 5. 폴링 루프

### 5.1 provider 는 실패를 삼키지 않고 올린다

`FetchOrdersResult` 에 `processingFailures?: OrderProcessingFailureItem[]` 를 더한다.

```ts
export interface OrderProcessingFailureItem {
  externalOrderId: string;
  sourceUpdatedAt: string;
  stage: 'fetch' | 'translate';
  error: string;
  input: Record<string, unknown>;
}
```

- **네이버 조회 실패** — `NaverOrderSource.fetchOrdersInWindow` 의 주문별 catch 가 로그만 남기지 않고 실패를 결과에 싣는다
  (`WindowedFetchResult` 에 `fetchFailures: { externalOrderId, changedAt, error }[]`). `TranslatingOrderProvider` 가 이를
  `stage: 'fetch'`, `sourceUpdatedAt = changedAt` 으로 옮긴다. 이 시각은 네이버가 알려 준 변경 시각이라 워터마크 근거로 쓸 수 있다.
- **번역기 throw** — `TranslatingOrderProvider.fetchOrders` 가 스냅샷마다 `translate` 를 감싸 `stage: 'translate'` 로 올린다.
  `sourceUpdatedAt` 은 스냅샷의 변경 시각이다.

`completedWindowEnd` 를 «실패가 있으면 null» 로 내는 기존 규칙은 그대로 둔다. 실패가 항목으로 올라오면 `orderedItems` 가
비지 않으므로 그 필드는 어차피 쓰이지 않는다.

### 5.2 오케스트레이터 루프

`OrderedPollItem` 에 `{ kind: 'processing_failure'; item: OrderProcessingFailureItem }` 를 더한다. 정렬 우선순위는
order(0) < failure(1) < processing_failure(2) < lifecycle(3) — 같은 시각이면 주문이 lifecycle 보다 먼저라는 기존 순서를 지킨다.

루프에 셋을 더한다:

1. **이번 주기의 실패 주문 집합 `failedExternalOrderIds`.** 항목을 처리하기 전에 그 주문이 집합에 있으면 **건너뛰고 워터마크를
   전진시킨다.** 그 주문은 실패 행이 있고, 되살릴 때 주문과 lifecycle 을 통째로 다시 가져오므로 잃지 않는다.
   이게 없으면 주문 항목이 실패한 같은 주기에 그 주문의 lifecycle 항목이 매핑을 못 찾고, `quarantinedExternalOrderIds` 에도
   없으므로 «종결»로 판정돼 `resolveOrphanedQuarantine` 이 **방금 만든 실패 행을 `closed_lifecycle` 로 닫는다.**
2. **처리 실패 항목·주문 처리·lifecycle 처리를 감싼다.** `processing_failure` 항목은 그대로, `processOrderItem` /
   `processLifecycleItem` 이 throw 하면 `enqueue_order` / `enqueue_lifecycle` 로 `recordProcessingFailure` 를 부르고,
   집합에 넣고, 워터마크를 전진시킨다. 적재 트랜잭션은 이미 롤백됐으므로 해시 선점(`claimChanged`·`claimFirstSeen`)도 함께 풀려
   있다 — 되살릴 때 처음부터 다시 발행된다.
3. **기록 자체가 실패하면 다시 던진다.** `recordProcessingFailure` 가 throw 하면 바깥 catch 로 가서 지금처럼 주기 전체가
   실패하고 워터마크는 그대로다(D4, 목표 5).

식별 실패 갈래(`recordFailure`)는 감싸지 않는다 — 그 갈래가 throw 하는 건 DB 장애뿐이고, 그때 멈추는 게 맞다.

### 5.3 실패 로그

항목 실패마다 `logger.warn` 으로 채널·주문 id·단계·에러를 남긴다. 주기 끝 요약 로그에 `processingFailed` 건수를 더한다.

### 5.4 다음 폴링이 성공하면 저절로 닫힌다

주기 시작 때 이번 항목들의 주문 id 로 **열린 처리 실패 행을 한 번에 조회한다**(`findOpenProcessingFailures(channel, ids)` —
`findCollectedOrders` 와 같은 모양). 주기가 끝났을 때, 그중 이번 주기에 항목이 하나 이상 성공적으로 처리됐고
`failedExternalOrderIds` 에 없는 주문의 행을 `replayed` 로 닫는다(매핑이 있으면 `replayedWmsOrderId` 를 싣는다).

이 경로는 «다음 폴링이 우연히 그 주문을 다시 가져온» 경우만 다룬다. 채널은 주문을 다시 내보낼 때 그 주문의 lifecycle 도
함께 내보내므로(lifecycle 은 스냅샷에서 파생된다) 주문 항목의 성공은 그 주문 전체의 성공이다. 나머지는 §6 이 맡는다.

### 5.5 `resolveOrphanedQuarantine` 은 열린 행을 전부 닫는다

지금은 그 주문의 열린 행을 **하나만** 닫는다(`findOpenByExternalOrderId` 의 `limit(1)`). 식별 실패 행과 처리 실패 행이 함께
열려 있으면 하나가 고아로 남는다. 종결된 주문은 어느 사유로도 수집할 수 없으므로 열린 행을 전부 `closed_lifecycle` 로 닫는다
(`findAllOpenByExternalOrderId` 를 더하고 `resolveOrphanedQuarantine` 만 그걸 쓴다 — `closeOpenQuarantineAsCollected` 는 사유를
지정해 하나만 찾으므로 그대로 둔다).

### 5.6 바꾸지 않는 것

- **워터마크 규칙** — `advanceWatermark`·`holdWatermark`·조용한 창 전진은 그대로다. 실패 항목은 기록된 항목이므로 일반 항목처럼
  전진에 참여한다.
- **`syncOrder`**(HTTP·명령 입구)는 지금처럼 호출자에게 throw 한다. 사람이나 명령이 직접 부른 것이라 실패를 바로 보는 게 맞다.
- **`ingestProvider`**(데모)는 그대로다.

## 6. 자동 재시도

### 6.1 언제

채널마다 본 루프가 끝나고 `recordSyncComplete` 로 워터마크를 확정한 **뒤**, 채널 `try` 블록 안에서 자기 `try/catch` 로 감싼
`retryProcessingFailures(provider, cycleStartedAt)` 를 부른다. 재시도가 터져도 그 채널의 sync 상태가 «실패»로 바뀌지 않는다. 새 크론을 만들지 않는다 — `@CronOnce('order-poll')` 의
주기당 선점과 비활성 채널 게이트를 그대로 물려받는다. 비활성 채널은 주기 전체를 건너뛰므로 재시도도 쉬고 행은 기다린다.
본 루프가 throw 한 주기에는 재시도가 돌지 않는다 — 그때는 대개 DB 장애라 재시도도 실패 기록을 못 한다.

### 6.2 무엇을

`OrderCollectionFailureService.findRetryableProcessingFailures(channel, cycleStartedAt, limit)`:

- `channel` 일치, `reason = 'order_collection_processing_failed'`, `status = 'quarantined'`
- `attempt_count < 4`
- **`updated_at < cycleStartedAt`** — 이번 주기에 방금 실패한 행을 몇 초 뒤에 또 시도해 한 주기에 횟수를 다 써 버리는 걸 막는다.
  이 조건이 «주기당 1회»와 «소진까지 최소 15분»을 보장한다.
- `updated_at` 오래된 순, **채널당 주기마다 최대 20건**(`PROCESSING_FAILURE_RETRY_BATCH = 20`). 네이버 API 호출량과 주기 길이의 상한이다.

`cycleStartedAt` 은 그 채널 처리를 시작할 때 잡은 `new Date()` 다. `updated_at` 은 `defaultNow()`·`new Date()` 로 쓰는 tz 없는
timestamp 이므로 같은 기준으로 비교된다.

### 6.3 어떻게 — `syncOrder` 의 처리부 하나

지금 `syncOrder` 안의 «`syncFetched` + lifecycle 루프»를 내부 메서드 `processSyncFetch(provider, fetched, options)` 로 뽑는다.
`syncOrder`·자동 재시도·수동 replay(§6.5) 셋이 이걸 부른다 — **같은 주문을 되살리는 길이 하나다.**

재시도 한 건(`retryProcessingFailure(provider, row)`): provider 가 syncable 이 아니면 건너뛴다(행은 그대로, 지금 provider 는
medusa·naver 둘 다 syncable 이다). `provider.fetchOrderForSync(externalOrderId)` 후 결과에 따라:

| 결과 | 행 처리 | replay 응답 status |
| --- | --- | --- |
| `created` · `emitted` · `unchanged`, lifecycle 모두 성공 | `replayed` 로 닫음 | `replayed`(발행 있음) / `already_processed`(없음) |
| `not_eligible` (종결돼 수집 대상 아님) | `closed_lifecycle` 로 닫음 | `closed_terminal` |
| `identification_failed` (식별 실패로 바뀜 — `processSyncFetch` 가 식별 격리 행을 기록) | `replayed` 로 닫고 `error_message` 에 «식별 실패 격리로 넘어감» | `moved_to_identification_quarantine` |
| `fetchOrderForSync` 가 `null` | `recordProcessingFailure(stage: 'fetch', error: 'not found')` | `still_quarantined` |
| 어느 단계든 throw | `recordProcessingFailure` (단계는 throw 지점: 조회 `fetch`, 번역 `translate`, 주문 `enqueue_order`, lifecycle `enqueue_lifecycle`) | `still_quarantined` |

**«못 찾음»을 바로 닫지 않는다.** 한 번 실패한 주문이 채널에서 사라지는 건 드물고 일시 오류일 수도 있다. 실패 1회로 세고,
소진되면 사람이 판단한다. 결제완료 전이라 못 찾은 주문이면 결제완료로 바뀌는 순간 다음 폴링이 다시 가져온다.

throw 지점을 단계로 구분하려면 `processSyncFetch` 가 단계를 실어 던져야 한다 — 단계와 원인을 담는 내부 에러
`OrderProcessingStageError { stage, cause }` 로 감싸 던지고, 재시도·루프가 이걸 풀어 기록한다. `syncOrder` 의 호출자에게는
원인 에러를 그대로 다시 던진다(바깥 계약 불변).

### 6.4 소진 로그

`recordProcessingFailure` 가 `attempt_count` 를 **정확히 4로 만든 그 한 번만** `logger.error` 로 채널·주문 id·단계·에러를 남긴다.
upsert 의 `returning()` 으로 새 횟수를 받아 판정한다. 매 주기 반복해서 찍지 않는다.

### 6.5 수동 replay

`replayFailure(id)` 가 reason 이 처리 실패면 §6.3 의 `retryProcessingFailure` 를 **상한을 무시하고 한 번** 부르고 그 결과를
돌려준다. 실패하면 횟수만 늘고 사람 몫으로 남는다. 2번 행을 고쳐 배포한 뒤 운영자가 소진된 행을 누르면 바로 수집된다.
응답 status 유니온에 `moved_to_identification_quarantine` 을 더한다.

### 6.6 겹쳐 돌아도 안전하다

자동 재시도·수동 replay·폴링이 같은 주문을 동시에 처리해도 해시 선점이 같은 트랜잭션 안에서 검사와 기록을 한 문장으로 하므로
(#599) 이벤트는 한 번만 나간다. 최악은 `attempt_count` 가 1 더 오르는 것이다.

## 7. 화면·보드

### 7.1 «사람 몫»의 정의는 서버 한 곳

`summarizeQuarantined` 가 **처리 실패 사유이면서 `attempt_count < 4` 인 행을 빼고** 센다. `oldestCreatedAt` 도 같은 집합에서 구한다.
정체 보드 0단계는 이미 이 요약을 쓰므로(정체 보드 스펙 D9) 자동 재시도 중인 행은 보드에 뜨지 않는다.

### 7.2 사이드바 배지도 같은 요약을 쓴다

`QuarantineMenuBadge` 는 지금 목록 API(`status=quarantined`, 상한 200)의 건수를 센다. 그대로 두면 **보드는 0인데 배지는 빨간**
엇갈림이 생긴다. 배지를 요약 엔드포인트(`GET adapter/order-collection-failures/summary`)로 옮긴다 — 정의가 하나로 맞고
«200+» 상한도 사라진다. `formatQuarantineCount` 가 쓰이지 않게 되면 지운다.

### 7.3 격리 목록 화면 (`/mall/channel-listings`)

- `guidance.ts` 의 `QuarantineReason`·`REASON_LABELS` 에 `order_collection_processing_failed: '수집 처리 실패'` 를 더한다
- 단계 라벨 `stageLabel(stage)`: `fetch` 조회 실패 · `translate` 변환 실패 · `enqueue_order` 주문 적재 실패 · `enqueue_lifecycle` 취소·환불 적재 실패
- 이 사유의 행에는 단계와 마지막 에러를 보여 준다. 재시도 중(`attempt_count < 4`)이면 «자동 재시도 중 (n/4)» 를 붙인다
  (`retryProgressLabel(attemptCount)` — 4 이상이면 null)
- replay 버튼은 재시도 중에도 열어 둔다(§4.5). `canReplay` 는 바뀌지 않는다
- `REPLAY_MESSAGES` 에 `moved_to_identification_quarantine: '상품 식별 실패로 넘어갔습니다. 식별 실패 격리 행에서 조치하세요.'`
- 컨트롤러의 `@ApiQuery` reason enum 과 `buildReplayPath` 에 새 사유를 더한다

admin-web 은 컴포넌트 테스트를 두지 않으므로 위 판정은 `guidance.ts` 순수 함수로 두고 `guidance.spec.ts` 로 지킨다.

## 8. 배포

한 PR 이다. 마이그레이션은 컬럼 추가뿐인 expand 단계라 **`migrate → deploy`** 순서다 — 새 코드가 새 컬럼을 쓰기 전에 컬럼이
있어야 한다. 옛 task 는 새 컬럼을 무시하므로 rolling 중에도 안전하다. 새 reason 값은 varchar 라 DB 제약 변경이 없다.
admin-web 은 새 필드가 없는 옛 응답도 그대로 그린다(사유 라벨은 모르는 값이면 원문을 보여 준다).

## 9. 테스트

### 9.1 오케스트레이터 유닛 (`order-poller.orchestrator.spec.ts`)

1. 같은 주기에 A·B(독)·C 주문 — B 의 `enqueue` 가 throw 해도 **A·C 가 적재되고**, B 는 `enqueue_order` 로 기록되고, 워터마크가 C 까지 전진한다
2. lifecycle 적재가 throw 해도 같은 결과(`enqueue_lifecycle`)
3. 주문 항목이 실패한 주문의 같은 주기 lifecycle 항목은 건너뛰고, **`resolveOrphanedQuarantine` 이 불리지 않는다**
4. `recordProcessingFailure` 가 throw 하면 `recordSyncFailure` 가 불리고 `recordSyncComplete` 는 불리지 않는다(워터마크 불변)
5. provider 가 올린 `processing_failure` 항목(`fetch`·`translate`)이 기록되고 워터마크 근거가 된다
6. 열린 처리 실패 행이 있는 주문이 이번 주기에 성공하면 `replayed` 로 닫힌다. 실패하면 닫히지 않는다
7. 재시도: `updated_at >= cycleStartedAt` 인 행은 고르지 않는다 / 결과별 닫힘·누적(§6.3 표의 다섯 줄) / 본 루프가 throw 한 주기엔 돌지 않는다
8. `resolveOrphanedQuarantine` 이 열린 행 둘을 모두 닫는다
9. 수동 replay 가 처리 실패 행에서 상한을 무시한다

### 9.2 provider 유닛

- `naver-order.source.spec.ts`: 단건 조회 실패가 `fetchFailures` 로 올라온다(지금은 로그만 확인)
- `translating-order.provider.spec.ts`: 번역 throw 가 `stage: 'translate'` 로 올라오고 다른 스냅샷은 번역된다

### 9.3 DB 통합 (`describeIfDb` 가드)

`order-collection-failure-*.integration.spec.ts` 옆에: upsert 할 때 `attempt_count` 가 누적되고, 종결 행은 `1` 로 다시 열린다 /
`summarizeQuarantined` 가 재시도 중 행을 빼고 소진 행은 센다 / `findRetryableProcessingFailures` 의 네 조건.

### 9.4 2번 행 재현 회귀

outbox mock 의 `enqueue` 가 **실제 계약 스키마**(`ORDER_STREAM` 의 `OrderCreated` 스키마)로 payload 를 파싱하게 하고, 시각 필드가
`+09:00` 인 주문 하나를 섞는다. 그 주문만 `enqueue_order` 로 격리되고 `raw_order` 에 그 값이 남으며, 채널의 나머지 주문은 적재된다.

### 9.5 admin-web

`guidance.spec.ts`: 새 사유 라벨, `stageLabel`, `retryProgressLabel`(3 → «자동 재시도 중 (3/4)», 4 → null), 새 replay 메시지.

## 10. 하지 않는 것

- **2번 행(네이버 `+09:00`) 자체를 고치지 않는다.** 이 스펙 뒤에 2번 주문은 채널을 멈추지 않고 그 주문만 소진·격리된다. 2번을
  고쳐 배포하면 운영자가 replay 하거나, 그 주문이 다시 바뀔 때 폴링이 닫는다
- **일괄 replay** 를 만들지 않는다. 2번 배포 뒤 소진 행이 많으면 그때 다시 본다
- **재시도 간격을 늘려 가는 backoff** 를 두지 않는다. 주기(5분)가 곧 간격이다
- **outbox `FAILED` 재발행**(7번 행)·**core DLQ 재처리**(8번 행)는 이 행이 아니다 — 이 스펙은 outbox 에 들어가기 **전**의 실패만 다룬다
