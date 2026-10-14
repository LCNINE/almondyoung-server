# 이벤트 실패 출구 — outbox `FAILED` 와 컨슈머 실패를 앱 DB 에서 다시 넣고 종결한다 (#1016 7·8번)

트래킹: #1016 7번(outbox `FAILED` 를 다시 내보낼 수단이 없다)·8번(core DLQ 를 다시 처리할 수단이 없다).
두 행은 원래 «정체 보드» 묶음이었으나, 주문 단계의 정체가 아니라 **메시지 전달 계층**의 문제라 공용 기반(`@app/events`)에서 푼다(§3 D1).
주문이 사라진 결과를 주문 쪽에서 잡는 일(«채널엔 있는데 core 엔 없는 주문» 대사)은 #1016 에 새 행으로 따로 둔다.

## 1. 배경

### 1.1 발행 측 — outbox 는 7분 만에 굳고, 굳으면 출구가 없다

공용 디스패처(`libs/events/src/outbox/outbox-dispatcher.service.ts`)는 실패한 행을 `OUTBOX_RETRY_DELAYS_SECONDS = [10, 30, 60, 300]`
간격으로 `maxRetries`(기본 5)번 시도하고 `FAILED` 로 둔다. 합계 약 400초다 — **Kafka 가 7분 넘게 끊기면 그동안 적재된 행이 전부 굳는다.**
`FAILED` 를 되돌리는 코드는 어디에도 없다.

channel-adapter 에서는 이것이 주문 유실이다. 폴러는 outbox 적재와 같은 트랜잭션에서 주문 해시를 **먼저 선점**하므로
(`order-poller.orchestrator.ts` `claimChanged`), `OrderCreated` 행이 굳어도 다음 폴링은 «이미 넘긴 주문»으로 보고 다시 내지 않는다.

### 1.2 소비 측 — DLQ 는 원래 토픽 단위의 공용 토픽이다

컨슈머가 포기한 메시지는 `EventRetryInterceptor` 가 `<원래 토픽>.dlq` 로 발행하고 오프셋을 커밋한다. 이 토픽으로는 출구를 만들 수 없다.

1. **구독자별이 아니다.** 앱마다 컨슈머 그룹이 따로라 같은 토픽을 앱마다 전부 받는다(`orders.events.v1` 은 core·notification·analytics).
   그런데 DLQ 토픽은 원래 토픽당 하나라, `orders.events.v1.dlq` 에 core 의 실패와 notification 의 실패가 섞인다
2. **메시지 하나의 상태를 바꿀 수 없다.** `DLQMessage.status` 는 `pending` 으로 쓰인 뒤 바뀌지 않는다 — `reprocessDLQ`·`resolveDLQ` 의
   상태 갱신 자리는 `// TODO: DB 업데이트` 다. «안 푼 실패가 몇 건인가»에 답할 수 없다
3. **골라서 처리할 수 없다.** `drainAndReprocess` 는 소비 그룹 오프셋으로 토픽을 앞에서부터 통째로 비운다
4. **다시 넣을 곳이 원래 토픽뿐이다.** 원래 토픽에 재발행하면 **모든 구독자가 다시 받는다** — core 의 실패를 살리려다 notification 이
   주문 알림을 한 번 더 보낸다
5. **보존 기간이 지나면 사라진다.** DLQ 토픽은 브로커 기본 보존으로 만들어진다(`topic-bootstrap.service.ts`, 보존 설정 없음)

같은 이유로 **membership 의 `POST /admin/dlq/reprocess` 는 지금 라이브에서 위험하다.** `payments.events.v1.dlq` 를 통째로 비워
원래 토픽에 재발행하는데, 이 토픽은 membership·notification·channel-adapter 셋이 구독한다. admin-web 호출처는 0곳이다.

### 1.3 순서가 뒤집히면 조용히 틀린다

core 의 `OrderModified` 처리는 메시지 id 로 중복만 막고 스냅샷이 더 오래된 것인지는 보지 않는다(`channel-order-change.manager.ts`).
배송지 변경 ①이 실패해 빠져 있는 동안 ②가 반영되고, 나중에 ①을 다시 넣으면 **옛 배송지로 되돌아간다** — 배송지는 자동 반영 대상이라 아무도 모른다.
outbox 도 같다: 굳은 옛 이벤트를 다시 보내면 같은 주문의 더 새 이벤트보다 뒤에 도착한다.

### 1.4 순서 키는 Kafka 키가 아니라 `aggregateId` 다

channel-adapter 는 주문 이벤트의 Kafka 키(`partitionKey`)를 **채널 이름**으로 보낸다(`order-poller.orchestrator.ts` — `partitionKey: provider.channel`).
이 키로 보류하면 실패 하나가 그 채널의 주문 전부를 막는다. 주문 하나를 가리키는 건 `aggregateId` 이고, `OrderCreated`·`OrderModified`·`OrderCancelled`
가 같은 값(core 주문 id)을 쓴다. 기존 `strictPartitionOrdering` 옵션은 `partition_key` 기준이라 이 목적에 쓸 수 없다.

## 2. 목표와 성공 기준

1. core·channel-adapter 의 outbox `FAILED` 와 컨슈머 최종 실패를 **admin-web 에서 보고, 다시 넣고(보내고), 사유를 적어 종결**한다. DB 를 직접 만지지 않는다
2. 다시 넣기는 **실패한 그 컨슈머(그 핸들러)에만** 닿는다. 다른 구독자는 아무것도 받지 않는다
3. **같은 순서 키의 메시지 순서가 뒤집히지 않는다** — 실패가 남아 있는 동안 뒤 메시지는 처리되지 않고 보류된다(컨슈머·outbox 모두)
4. 2시간 안에 끝나는 일시 장애는 사람 없이 풀린다(outbox)
5. 실패 기록이 저장에 실패해도 메시지를 잃지 않는다
6. 안 푼 실패 건수가 메트릭으로 나온다
7. membership 의 원래 토픽 재발행 API 가 사라진다
8. `npm run type-check` 에러 0 · `npx jest` 실패 0 · admin-web `tsc --noEmit` 0

## 3. 결정 (사용자 결정 2026-10-15)

| # | 질문 | 결정 | 기각한 안과 이유 |
| --- | --- | --- | --- |
| D1 | 어디서 푸나 | **두 층으로 나눈다.** 7·8번은 `@app/events` 의 공용 출구(전달 계층). 주문 유실은 «채널엔 있는데 core 엔 없는 주문» 대사로 정체 보드에서(새 행) | outbox·DLQ 를 주문 보드에 띄운다: 보드의 단위(주문 하나 = 한 칸, 정체 보드 D2)와 메시지 단위가 다르고, 보드가 이벤트 계약마다 페이로드를 해석해야 하며, 메시지 실패가 아닌 원인으로 사라진 주문은 못 본다 |
| D2 | 컨슈머 실패를 어디에 두나 | **그 컨슈머 앱의 DB 테이블** | `.dlq` 토픽: 구독자별이 아니고 상태를 못 바꾸고 보존 기간이 있다(§1.2) / 구독자별 DLQ 토픽(`<토픽>__<그룹>__dlq`): 상태는 여전히 따로 저장해야 하고 admin API 가 오프셋을 뒤진다 |
| D3 | 어느 앱에서 켜나 | **core + channel-adapter.** 주문 경로의 양 끝. channel-adapter 의 DLQ 가 막히면 core 가 보낸 채널 취소 명령이 사라진다(표의 8번이 core 만 적은 것은 누락) | core 만: 위 누락 / 9개 앱 전부: 마이그 6~9건·배포 조율, 대부분 주문 경로와 무관 |
| D4 | 굳은 실패를 자동으로 다시 넣나 | **아니다. 대신 outbox 는 굳기 전 재시도를 약 2시간으로 늘린다.** 굳은 것은 outbox·컨슈머 모두 버튼으로만 푼다 | 버튼만(7분 그대로): 밤사이 장애가 아침까지 멈춘다 / 자동 재시도 추가: 일시·영구 실패를 가를 수 없어 상한 상태가 또 생기고, 자동으로 넣은 옛 메시지의 순서 문제를 아무도 안 본다 |
| D5 | 컨슈머 재시도도 늘리나 | **아니다.** 컨슈머 재시도는 그 자리에서 기다리는 방식이라 늘리면 같은 파티션(= 채널 전체)이 멈춘다 | — |
| D6 | 켜는 앱의 `.dlq` 토픽 발행 | **멈춘다. DB 에만 적는다.** 기록이 실패하면 오프셋을 커밋하지 않는다(지금 DLQ 발행 실패와 같은 의미) | DB + 토픽: 정본이 둘이 되고 토픽 쪽은 계속 섞인다 |
| D7 | membership `POST /admin/dlq/reprocess` | **지운다.** 유일한 호출자라 `DLQHandler.drainAndReprocess` 와, 그것만 부르던 `reprocessDLQ`·본문이 로그뿐인 `resolveDLQ` 도 지운다. `DLQHandler.sendToDLQ` 는 켜지 않은 앱이 계속 쓰므로 남는다. `scripts/events/consume-validation-readiness.ts` 의 `reprocessDLQ` 면제 항목도 함께 지운다 | 남긴다: 누르면 세 앱에 중복 처리 |
| D8 | 순서를 어떻게 지키나 | **같은 순서 키의 뒤 메시지도 보류한다**(컨슈머·outbox 모두). 다시 넣기는 순서 단위로 처음부터 차례로 | 다시 넣기만 순서대로 + 경고: §1.3 의 배송지 되돌림을 사람 눈에 맡긴다 |
| D9 | 순서 키 | **`aggregateId`** (outbox 는 `aggregate_id` 칸) | Kafka 키·`partition_key`: channel-adapter 는 채널 이름이라 채널 전체가 막힌다(§1.4) |

## 4. 구성

전부 `@app/events` 에 공용으로 두고, 앱이 켤 때만 동작한다. 켜지 않은 앱은 지금 동작 그대로다.

| 구성 요소 | 하는 일 | 절 |
| --- | --- | --- |
| 실패 기록 | 컨슈머 최종 실패를 `.dlq` 토픽 대신 앱 DB 에 적는다 | §6 |
| 보류 | 실패가 남은 순서 키의 뒤 메시지를 처리하지 않고 함께 적는다 | §6 |
| 다시 넣기·종결 | 앱 안에서 실제 소비 파이프라인에 다시 태운다 | §7 |
| outbox 출구 | 굳기 전 재시도를 늘리고, 굳은 행을 보류·다시 보내기·종결한다 | §8 |
| API·화면 | 두 앱이 같은 모양의 관리 API, admin-web «이벤트 실패» 페이지 | §9·§10 |

## 5. 저장소

### 5.1 `event.dead_letters` — 컨슈머 실패 (켜는 앱의 DB 에만)

스키마 파일은 `libs/events/src/dead-letter/dead-letter.schema.ts` 에 두고, **core·channel-adapter 의 `drizzle.config.ts` 에만** 넣는다.
outbox 스키마처럼 6개 앱에 물리지 않는다.

| 칸 | 뜻 |
| --- | --- |
| `id` | PK |
| `consumer_group` | 그 앱의 컨슈머 그룹(`startConsumer` 의 `groupId`) |
| `handler` | `클래스.메서드` — 같은 이벤트를 받는 핸들러가 둘 이상일 때 대상을 가른다 |
| `topic` | 원래 토픽 |
| `sequence_key` | 순서 키 = `envelope.source.aggregateId`. envelope 파싱 실패면 NULL |
| `message_id` | `envelope.messageId` (파싱 실패면 `topic:partition:offset`) |
| `event_type` | `envelope.messageType` (파싱 실패면 NULL) |
| `envelope` | jsonb. 파싱 실패면 `{ raw: "<원문 텍스트>" }` |
| `kafka_partition`·`kafka_offset` | 원래 위치(진단용) |
| `status` | `failed` · `held` · `redriven` · `discarded` (varchar + TS 유니온) |
| `error_name`·`error_message` | 마지막 실패 |
| `redrive_count` | 다시 넣은 횟수 |
| `first_failed_at`·`last_failed_at` | 처음·마지막 실패(또는 보류) 시각 |
| `resolved_at` | `redriven`·`discarded` 가 된 시각 |

- `failed` = 처리하다 실패했다(순서의 머리). `held` = 앞 실패 때문에 처리하지 않고 보관했다
- 유일 키 `(consumer_group, handler, message_id)` — Kafka 재전달로 행이 둘 생기지 않는다
- 부분 인덱스 `(consumer_group, topic, sequence_key, id) WHERE status IN ('failed','held')` — 보류 검사와 순서 조회가 탄다
- 순서는 `id` 순서다. 같은 순서 키의 메시지는 같은 파티션에서 차례로 소비되므로 적힌 순서가 소비 순서다

### 5.2 `event.failure_actions` — 사람이 한 조치 (켜는 앱의 DB 에만)

| 칸 | 뜻 |
| --- | --- |
| `id` | PK |
| `target_kind` | `dead_letter` · `outbox` |
| `target_id` | 대상 행 id |
| `action` | `redrive` · `discard` |
| `outcome` | `succeeded` · `failed` (다시 넣기 결과. 종결은 `succeeded`) |
| `actor` | JWT 의 사용자 id |
| `note` | 종결 사유(필수) · 다시 넣기 실패 오류 |
| `created_at` | |

### 5.3 outbox 테이블은 바꾸지 않는다

종결은 새 상태값 `DISCARDED` 로만 표시한다(`status` 는 varchar). `OutboxStatus` 유니온에 값을 더한다.
칸을 더하면 outbox 를 쓰는 6개 앱 전부에 마이그가 생기고 전부 `migrate → deploy` 를 지켜야 한다(outbox.schema.ts 머리 주석).

## 6. 소비 경로 — 실패 기록과 보류

기존 `EventRetryInterceptor`(마이크로서비스 스코프 전역, `buildConsumerInterceptors`)에 두 지점을 더한다. 켜지 않은 앱에서는 아무것도 바뀌지 않는다.

### 6.1 이벤트 종류 필터를 직접 확인한다

**이벤트 종류 필터(`EventTypeGuard`)는 클래스 레벨 인터셉터라 전역인 재시도 인터셉터보다 안쪽에서 돈다.** 즉 재시도 인터셉터는
같은 토픽의 **모든 핸들러**에 대해 돌고, 이벤트 종류가 다른 핸들러는 안쪽에서 조용히 `undefined` 로 끝난다.
그래서 보류 검사는 먼저 `EVENT_TYPE_FILTER` 메타데이터와 `envelope.messageType` 을 비교하고, **다르면 아무것도 하지 않고 통과**시킨다.
이 확인이 없으면 `OrderCreated` 가 실패한 주문의 `OrderCancelled` 를 `OrderCreated` 핸들러 이름으로 보류하는 식의 가짜 행이 생긴다.

### 6.2 핸들러 실행 전 — 보류 검사

1. 그 앱·그 토픽·그 순서 키에 `failed`·`held` 행이 있으면 핸들러를 부르지 않는다. 메시지를 `held` 로 적고(유일 키 충돌은 무시) 오프셋을 커밋한다
2. 검사와 기록은 **순서 키별 advisory lock**(`pg_advisory_xact_lock(hash(consumer_group, topic, sequence_key))`) 안의 한 트랜잭션이다.
   다시 넣기가 «이제 남은 게 없다»고 판정하는 순간(§7.4)과 겹쳐 아무도 깨우지 않는 `held` 가 생기는 경합을 막는다
3. 실시간 소비끼리는 경합이 없다 — 같은 순서 키는 같은 파티션에서 차례로 온다. 경합은 다시 넣기와 실시간 소비 사이에만 있다
4. 순서 키가 없는 메시지(파싱 실패)는 검사하지 않는다

### 6.3 최종 실패 시 — 실패 기록

1. 지금 `.dlq` 로 보내는 자리(`handleFinalFailure`)에서 대신 `failed` 행을 적는다. 재시도하지 않는 실패(스키마 위반·`nonRetryableErrors`)도 같다
2. **기록이 실패하면 `DlqDeliveryError` 를 던진다** — 오프셋 미커밋 → Kafka 재전달. 지금 DLQ 발행 실패와 같은 의미이고, DB 가 원인인 실패에서도 메시지를 잃지 않는다
3. envelope 파싱 실패: 순서 키 없이 원문 텍스트로 `failed` 를 적는다. **지금은 이 경우 `DlqDeliveryError` 로 끝없이 재전달된다** — 이 변경으로 함께 사라진다
4. `@DisableDLQ` 핸들러: 지금처럼 버린다
5. 요청-응답 메시지: 지금처럼 개입하지 않는다

### 6.4 다시 넣기로 들어온 메시지

헤더 `x-dead-letter-id`·`x-dead-letter-handler` 가 있으면(§7.2):

- 보류 검사를 건너뛴다
- `x-dead-letter-handler` 와 다른 핸들러는 아무것도 하지 않고 통과시킨다
- 재시도를 하지 않는다(한 번만 시도, §7.3)
- 실패하면 새 행을 만들지 않고 **그 행을 갱신**한다(`status = failed`, `redrive_count + 1`, 오류·`last_failed_at`)

### 6.5 메트릭

- `events_dlq_messages_total` 은 `failed` 를 적을 때 올린다 — 기존 대시보드가 그대로 돈다
- 새 게이지 `events_dead_letters{topic, status}` — 안 푼 `failed`·`held` 건수. outbox 의 `events_outbox_failed_rows` 와 짝이고 알림 규칙의 대상이다.
  수집은 outbox 메트릭 수집기(`outbox-metrics.collector.ts`)와 같은 방식으로 한다

### 6.6 켜는 방법

`EventsModule.startConsumer(app, { groupId, deadLetters: { enabled: true } })` 처럼 소비 시작 지점에서 켠다. 켜면 `.dlq` 토픽 발행 경로를 쓰지 않는다(D6).
DB 접근은 `@app/db` 의 `DbService` 를 앱이 넘긴다 — outbox 가 `OutboxWriter` port 로 DB 를 받는 것과 같은 모양으로, 라이브러리가 drizzle 인스턴스를 직접 만들지 않는다.

## 7. 다시 넣기와 종결

### 7.1 단위는 «순서»

순서 = 그 앱의 같은 (토픽, 순서 키)를 가진 `failed`·`held` 행들. 행 하나에서 눌러도 그 순서를 `id` 순서대로 처리하고, **하나라도 실패하면 거기서 멈춘다.**
멈춘 행이 새 머리 `failed` 가 된다. 순서 키가 없는 행(파싱 실패)은 그 행 하나가 순서다.

### 7.2 앱 안에서 실제 파이프라인에 태운다

1. 그 앱의 Kafka 마이크로서비스 서버에서 토픽의 핸들러를 꺼낸다(`getHandlerByPattern(topic)`). `startConsumer` 가 서버 참조를 보관한다
2. 저장한 envelope 로 **진짜 `KafkaContext`** 를 만든다 — `InMemoryServer.dispatch` 와 같은 방식(`KafkaParser` 로 파싱한 메시지, heartbeat 는 no-op,
   consumer·producer 는 호출되면 던지는 Proxy). 그래서 이벤트 종류 필터·스키마 검증·체인 추적·재시도 인터셉터가 운영과 똑같이 돈다
3. 헤더에 `x-dead-letter-id`·`x-dead-letter-handler` 를 싣는다(§6.4)
4. Kafka 를 거치지 않으므로 다른 구독자는 아무것도 받지 않는다

`InMemoryServer` 와 다시 넣기가 같은 «메시지 → KafkaContext» 조립을 쓰도록 그 부분을 함수 하나로 뽑는다.

### 7.3 한 번만 시도한다

다시 넣는 동안 그 순서 키의 lock 을 쥐므로, 실시간 소비가 같은 순서 키의 메시지를 받으면 기다리고 **같은 파티션(channel-adapter 주문이면 그 채널 전체)도 함께 멈춘다.**
파이프라인 재시도(최대 15초 간격 5번)를 돌면 1분쯤 막히므로 한 번만 시도한다. 다시 누르면 또 한 번 시도한다.

### 7.4 순서 처리 절차

```
try_lock(순서 키)   -- pg_try_advisory_xact_lock. 못 잡으면 409 «이미 진행 중»
loop:
  다음 행 = 그 순서의 가장 이른 failed/held
  없으면 → 끝
  dispatch(다음 행)
  행이 여전히 failed(§6.4 가 갱신) → 멈춤
  아니면 → 행을 redriven 으로
unlock
```

- «없으면 끝»을 lock 안에서 판정하므로, 실시간 소비는 그 전에 `held` 를 적었거나(→ 이 루프가 집는다) 그 뒤에 검사한다(→ 남은 게 없어 정상 처리한다)
- lock 은 DB 에 있으므로 ECS 태스크가 여럿이어도 같다. 실시간 소비(§6.2)는 기다리는 `pg_advisory_xact_lock`, 다시 넣기는 기다리지 않는 `try` 를 쓴다. 다시 넣는 동안 lock 을 쥔 트랜잭션은 열려 있고, 핸들러는 자기 트랜잭션(다른 연결)에서 돈다
- Kafka 재전달과의 관계: 기록은 됐는데 커밋 전에 죽어 같은 메시지가 다시 오면, 보류 검사가 그 순서의 `failed` 를 보고 `held` 를 적으려다 유일 키 충돌로 무시하고 커밋한다 — 행이 늘지 않는다
- 성공 판정: 디스패치가 끝난 뒤 행 상태를 다시 읽는다. §6.4 가 실패를 그 행에 적으므로, 여전히 `failed` 면 실패다

### 7.5 종결 — «이건 버리고 계속 간다»

- 사유 필수. 행을 `discarded` 로, `failure_actions` 에 누가·왜를 적는다
- **순서의 머리를 종결하면 뒤에 보류된 것을 이어서 다시 넣는다**(§7.4 를 그대로 탄다). 화면은 «뒤 N건이 이어서 처리됩니다»를 미리 보여 준다
- 머리가 아닌 `held` 도 종결할 수 있다(예: 낡은 `OrderModified` 를 건너뛸 때). 머리가 그대로라 아무것도 흐르지 않는다

### 7.6 전체 다시 넣기

장애 뒤 순서가 수십 개 쌓였을 때. 순서마다 머리의 `id` 순서로 §7.4 를 돌리고 «성공 N · 멈춤 M(오류 이름별)» 요약을 돌려준다. lock 을 못 잡은 순서는 건너뛰고 요약에 센다.

### 7.7 결과와 기록

결과는 요청에 바로 응답한다(처리 건수·멈춘 행·그 오류). 한 순서는 보통 몇 건이라 몇 초다. 다시 넣기·종결은 성공·실패와 무관하게 `failure_actions` 에 남긴다.

## 8. outbox 출구

### 8.1 `OutboxConfig` 에 앱별 설정

| 설정 | core·channel-adapter | 나머지 4개 앱 |
| --- | --- | --- |
| `retryDelaysSeconds` | `[10, 30, 60, 300, 900, 1800, 3600]` | 기본값 = 지금 `OUTBOX_RETRY_DELAYS_SECONDS` |
| `maxRetries` | 8 (합계 약 1시간 52분) | 기본값 5 |
| `sequenceByAggregate` | `true` | `false` |

간격표를 전역 상수 그대로 늘리지 않는 이유: wallet·ugc-service 는 `strictPartitionOrdering` 이 켜져 있어, 재시도 중인 행 하나가 그 파티션을 2시간 붙잡게 된다.

### 8.2 보류 — 디스패처 선택 조건

`sequenceByAggregate` 가 켜지면 `acquireEventBatch` 에 조건을 더한다: 같은 `(topic, aggregate_id)` 에 **더 이른** `PENDING`·`PROCESSING`·`FAILED` 행이 있으면 고르지 않는다.

- 비교는 `strictPartitionOrdering` 과 같은 `(created_at, id)` 사전식 — 같은 밀리초에 적재된 두 행이 서로를 막지 않는다
- 앞 행이 재시도 간격을 기다리는 동안 뒤 행도 기다린다. 앞 행이 굳으면 사람이 풀 때까지 기다린다. 다른 주문은 영향 없다
- `strictPartitionOrdering` 의 «`FAILED` 는 막지 않는다»와 반대 선택이다 — 그쪽은 파티션 전체가 죽지만, 이쪽은 주문 하나만 멈추고 화면에 보인다
- 새 인덱스는 두지 않는다. `PUBLISHED` 는 7일 뒤 지워지고(`cleanupOldEvents`), 조건은 미발행 상태만 보므로 기존 `outbox_status_idx (status, created_at)` 가 받는다.
  배포 전 라이브에서 `EXPLAIN ANALYZE` 로 확인한다(§11)

### 8.3 다시 보내기 — 그 자리에서 한 번

1. `FAILED → PROCESSING` CAS 선점. 다른 상태면 409
2. 디스패처의 발행 경로(`processEvent` 와 같은 `publishStoredEnvelope`, 검증 포함)로 한 번 보낸다
3. 성공 → `PUBLISHED`. 뒤에서 기다리던 같은 주문의 행은 디스패처가 다음 주기(5초)에 이어서 보낸다
4. 실패 → `FAILED` 로 되돌리고 오류만 갱신한다. `retry_count` 는 그대로 — 다시 2시간 재시도 일정에 태우지 않는다

`processEvent` 의 발행·상태 갱신을 디스패처와 다시 보내기가 함께 쓰도록 뽑는다.

### 8.4 종결

사유 필수. `FAILED → DISCARDED` CAS, `failure_actions` 기록. `DISCARDED` 는 보류 조건에 들지 않으므로 뒤 행은 다음 주기에 흐른다.

### 8.5 전체 다시 보내기

그 앱의 `FAILED` 를 `(created_at, id)` 순서로 §8.3 을 한 번씩 돌리고 요약을 돌려준다.

### 8.6 메트릭·정리

`events_outbox_failed_rows` 는 `FAILED` 만 센다 — 종결·성공하면 빠진다. `cleanupOldEvents` 는 `PUBLISHED` 만 지우므로 `DISCARDED` 는 남는다(양이 적고 기록으로 남는 편이 낫다).

## 9. API

라이브러리가 컨트롤러 모듈(`EventFailuresModule`)을 제공하고 경로 접두사는 앱이 정한다: core `/event-failures`, channel-adapter `/adapter/event-failures`.
가드는 각 앱의 기존 관리자 엔드포인트와 같다(core 기본 전역 가드 = admin·master, 정체 보드 D11 과 같음). 집계는 서버가 끝낸다.

| 메서드·경로 | 응답·동작 |
| --- | --- |
| `GET summary` | `{ deadLetters: { failed, held, oldestFailedAt }, outbox: { failed, oldestFailedAt } }` |
| `GET dead-letters?topic&cursor` | 순서 단위 목록: 머리 행(이벤트 종류·순서 키·처음 실패·오류 한 줄) + 뒤 `held` 건수. 머리 `first_failed_at` 오래된 순, 커서 페이지 |
| `GET dead-letters/:id` | envelope·오류 전문·같은 순서의 행들·조치 기록 |
| `POST dead-letters/:id/redrive` | 그 행이 속한 순서를 §7.4 로 처리 |
| `POST dead-letters/:id/discard` `{ reason }` | §7.5 |
| `POST dead-letters/redrive-all` | §7.6 |
| `GET outbox/failed?cursor` | `FAILED` 행 + 같은 `(topic, aggregate_id)` 뒤에서 기다리는 행 수 |
| `GET outbox/:id` | 페이로드·오류·조치 기록 |
| `POST outbox/:id/resend` | §8.3 |
| `POST outbox/:id/discard` `{ reason }` | §8.4 |
| `POST outbox/resend-all` | §8.5 |

## 10. 화면 (admin-web)

경로 `/system/event-failures`, 사이드바 «시스템» 그룹. 프록시는 core `/proxy/api`, channel-adapter `/proxy/channel`.

- 서비스 탭(core · channel-adapter), 탭 배지 = `summary` 의 안 푼 건수 합
- 탭 안에 «받다 실패»(dead letter, 순서 단위)와 «보내다 실패»(outbox) 두 목록
- 행: 이벤트 종류, 순서 키(주문 id), 처음 실패(체류 시간), 오류 한 줄, 뒤 보류 N. 펼치면 envelope·오류 전문·조치 기록
- 버튼: 다시 넣기(보내기)·종결. 종결은 사유 입력 + «뒤 N건이 이어서 처리됩니다». 전체 다시 넣기는 목록 머리에
- 실패 0건이면 빈 목록 한 줄만 둔다
- 표시 규칙(체류 표기·오류 한 줄 자르기·결과 요약 문장)은 `.ts` 순수 함수로 둔다(컴포넌트 테스트 불가 환경)

## 11. 배포

1. **배포 전 라이브 읽기 전용 확인**
   - core·channel-adapter 의 outbox `FAILED` 목록(id·토픽·이벤트·`aggregate_id`·시각·오류). **`sequenceByAggregate` 를 켜는 순간 옛 `FAILED` 가 같은 주문의 새 이벤트를 막기 시작한다** — 목록을 보고 배포 직후 화면에서 다시 보내거나 종결한다
   - §8.2 의 선택 조건을 `EXPLAIN ANALYZE` — 수백 ms 를 넘으면 `(topic, aggregate_id, created_at) WHERE status IN (...)` 부분 인덱스를 outbox 스키마에 더한다(6개 앱 마이그, 인덱스라 배포 순서 무관)
   - 기존 `orders.events.v1.dlq` 등 core·channel-adapter 가 쓰던 DLQ 토픽에 남은 메시지 건수(옮기지 않는다 — §13)
2. core·channel-adapter `db:migrate`(새 테이블 둘, 추가만) → `sst deploy`. 새 코드가 그 테이블에 쓰므로 **`migrate → deploy`**
3. membership 배포(API 삭제). 라이브러리 변경은 다른 앱에도 실리지만 기본값이 지금 동작이라 안전하다 — 켜지 않은 앱은 계속 `.dlq` 로 보낸다
4. admin-web 배포
5. Grafana 알림 규칙: `events_outbox_failed_rows > 0`, `events_dead_letters{status="failed"} > 0`

## 12. 테스트

1. **통합**(`describeIfDb`, 전용 명령은 `--runInBand`, 실제 DB)
   - 최종 실패 → `failed` 기록, 같은 순서 키 뒤 메시지 → `held`, 다른 순서 키는 정상 처리
   - 다시 넣기: 순서대로 처리, 중간 실패에서 멈춤·그 행 갱신(새 행 없음)
   - 종결: 머리 종결 → 뒤 이어서 처리 / 머리 아닌 `held` 종결 → 흐르지 않음
   - lock 경합: 다시 넣기의 «없으면 끝» 판정과 실시간 보류가 겹쳐도 `held` 가 남지 않는다
   - outbox 선택 조건: 앞 `PENDING`(간격 대기)·`FAILED` 가 뒤 행을 막고, 다른 `aggregate_id` 는 막지 않고, `DISCARDED` 는 막지 않는다. 같은 `created_at` 동률
   - 다시 보내기 CAS(동시 두 번 → 하나만), 실패 시 `retry_count` 유지
2. **인메모리 왕복**(`InMemoryServer`)
   - 이벤트 종류가 다른 핸들러는 보류 검사를 하지 않는다(§6.1)
   - 기록 실패 → `DlqDeliveryError`(미커밋), 파싱 실패 → 키 없는 `failed`, `@DisableDLQ` → 기록 없음
   - 다시 넣기 헤더: 한 번만 시도, 대상 핸들러만, 보류 검사 건너뜀
   - 켜지 않은 앱 설정에서는 지금처럼 `.dlq` 로 보낸다
3. **단위**: 앱별 재시도 간격 계산, 순서 키 추출, 요약 집계
4. **기존 가드**: 새 라우트가 `npx jest scripts/security` 를 통과한다. 크론 가드(`cron-once-guard.spec.ts`)는 새 크론이 없으므로 영향 없음
5. **admin-web 순수 함수**
6. **게이트**: `npm run type-check` 0 · `npx jest` 실패 0 · admin-web `tsc --noEmit` 0

## 13. 범위 밖

- 나머지 7개 앱에서 켜기 — 앱마다 `drizzle.config.ts` 에 스키마 추가 + 마이그 + `startConsumer` 옵션
- 즉시 발행(`publishEvent`)하는 앱의 발행 실패 — outbox 가 없어 이 장치로 못 잡는다
- 주문 계층 대사(«채널엔 있는데 core 엔 없는 주문») — #1016 새 행
- 굳은 뒤 자동 재시도(D4)
- 기존 `.dlq` 토픽에 남은 메시지를 테이블로 옮기기 — 배포 전에 건수만 본다(§11)
