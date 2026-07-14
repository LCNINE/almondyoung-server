# DLQ 관측 메트릭 — DLQHandler Prometheus 카운터

> 물류 백엔드 정상화 스프린트 현황판(`docs/logistics-backend-hardening-2026-07.md`) §5 잔여 우선순위 ① "DLQ 토픽 알림 확인" 후속.
> 작업 13(컨슈머 포이즌 분류)·이벤트 재시도 인터셉터 재설계가 실패 모드를 "시끄러운 파티션 정체 → 조용한 DLQ 적재 + offset commit"으로 바꾸면서 전제로 남긴 운영 과제. 브레인스토밍(2026-07-13)으로 확정.

## 1. 배경 — 검증된 사실 (2026-07-13, 소스 조사)

DLQ로 떨어진 메시지에 대한 **알림·메트릭이 코드·인프라 어디에도 없다.** 계층별 실측:

| 계층 | 상태 | 근거 |
|---|---|---|
| 앱 알림 | ❌ 주석 처리 | `DLQHandler.sendToDLQ`의 알림 발송 블록이 통째 `// TODO`(`dlq-handler.service.ts:120-123`). `sendAlert` 메서드는 정의조차 없고, `shouldAlert`(`:220-235`)는 이 주석 블록에서만 참조 = dead |
| 메트릭 | ❌ 미등록 | DLQ/kafka/lag 관련 Prometheus 메트릭이 리포 전체 0건. Core `MetricsService`엔 `wms_*` 도메인·대사 게이지만 있고 DLQ 지표 없음 |
| 브로커 메트릭 | ❌ 미스크레이프 | 프로덕션 Kafka = Redpanda 1-노드 EC2(PLAINTEXT). Alloy는 Core `/metrics`만 스크레이프 — Redpanda 토픽 depth/consumer-lag(:9644)는 스크레이프 대상 아님 |
| DLQ 소비/보존 | ❌ TODO | `.dlq` 토픽을 구독하는 컨슈머 0. `reprocessDLQ`/`resolveDLQ`의 DB 저장도 `// TODO`(`:117-118, :188-189, :213-214`) → DLQ가 사실상 메시지 무덤 |
| 로그 | 🟨 존재·무알림 | `logger.warn('📤 Message sent to DLQ …')`(`:108`)는 Alloy OTLP → Grafana Cloud Loki로 전달됨. 검색은 되나 이 로그에 걸린 알림 규칙이 리포에 없음 |
| 알림 규칙 파일 | ❌ 없음 | Grafana 알림/대시보드 정의(json/yaml) 리포 0건 — Grafana Cloud UI 외부 관리(코드로 배제 불가) |

**관측 파이프라인**(현행): DLQ 이벤트 → `warn` 로그 → Alloy(OTLP) → Grafana Cloud Loki. 메트릭 경로는 DLQ 지표 자체가 없어 단절.

**DLQ 실행 경로**(작업 13 이후): `EventRetryInterceptor.handleFinalFailure` → `sendToDLQ` → `DLQHandler.sendToDLQ`(`event-retry.interceptor.ts:172,199`). DLQ 토픽은 부트스트랩이 멱등 자동 생성(`topic-bootstrap.service.ts:34`, `includeDLQ` 기본 true).

**메트릭 인프라**(재사용 대상): Core `MetricsService`(`apps/core/src/modules/inventory/shared/services/metrics.service.ts`)는 **prom-client 전역 `register`**에 `wms_*` 메트릭을 등록하고, `@Public()` `/metrics` 컨트롤러가 `register.metrics()` 텍스트를 서빙. `prom-client ^15.1.3`은 **루트 의존성** — `libs/events`에서 직접 사용 가능.

**커버리지 제약**(핵심): `/metrics` 엔드포인트가 있는 앱은 core·notification 둘뿐이고, **Alloy가 스크레이프하는 앱은 Core 하나**(`config.alloy`의 `prometheus.scrape "core"`). 컨슈머를 돌리는 앱은 다수(core/notification/wallet/analytics/ugc/channel-adapter/membership/search)지만, prom-client 전역 `register`는 프로세스 단위라 **Core 프로세스에서 발생한 DLQ만 실관측**된다.

## 2. 결정 (브레인스토밍, 2026-07-13)

| 쟁점 | 결정 | 근거 |
|---|---|---|
| 관측 커버리지 | **Core 우선 MVP** | 코드는 `libs/events`에 심어 전 컨슈머 균일 배포되지만, 실관측은 Alloy가 스크레이프하는 Core로 한정. 작업 13이 이 게이트를 남긴 계기 자체가 Core `OrderEventsConsumer`(주문/환불/재고 = 최고가치 경로)라 커버리지 정합. non-Core 확장은 인프라 변경(각 앱 `/metrics` + Alloy 스크레이프 타겟)이라 별도 |
| 신호 형태 | **메트릭**(Loki 로그 알림 아님) | Grafana Cloud에서 대사 게이지와 동일 방식으로 알림 가능. 기존 prom-client 패턴 재사용 |
| 메트릭 타입 | **Counter** 2종 | DLQ 적재는 단조 누적 이벤트 → 알림은 `increase(...[range]) > 0` |
| 전송 실패 추적 | **별도 카운터 포함** | "DLQ 쓰기 자체 실패 → offset 미커밋 → 무한 재전달"의 치명 케이스에 직접 알림. 증가 지점 명확·비용 미미 |
| 이름 접두 | **`events_`** | DLQHandler는 `@app/events` 공유 인프라 — WMS 도메인 전용 `wms_`보다 의미상 정확. 기존 `wms_` 대시보드 패밀리와 별개 계열 |
| dead code | **`shouldAlert` + 알림 TODO 주석 제거** | 메트릭이 그 의도를 대체 — 작동 경로 옆 "TODO: 알림"은 오도(스프린트 절제 판례: 작업 4/5/9) |

## 3. 설계

### 3.1 메트릭 정의 (`libs/events/src/dlq/dlq.metrics.ts` 신규)

prom-client 전역 `register`에 **모듈 스코프 싱글턴**으로 정의. DLQHandler는 `EventsModule`에서 2곳(`events.module.ts:109`, `:255`)에서 프로바이드되므로, 인스턴스 필드로 두면 두 번째 생성 시 전역 `register` 중복 등록 예외가 난다 — 모듈 스코프 싱글턴이면 인스턴스 수와 무관하게 1회 등록.

```
events_dlq_messages_total       Counter  labelNames: [topic, consumer, error]
events_dlq_send_failures_total  Counter  labelNames: [topic, consumer]
```

- `topic` = 원본 토픽(`params.originalTopic`, 예 `orders.events.v1`) — 스트림 수만큼 bounded.
- `consumer` = 핸들러/컨슈머명(`params.context.consumer`) — bounded.
- `error` = **예외 클래스명만**(`params.error.name`, 예 `NotFoundException`) — `error.message`는 카디널리티 폭발이라 **금지**. Grafana Cloud active-series 비용 안전.

### 3.2 증가 지점 (`dlq-handler.service.ts` 수정)

`sendToDLQ` 내부, 시그니처·envelope 포맷 무변경:

- `await firstValueFrom(this.kafkaClient.emit(...))` **성공 직후**(현행 `:106` 이후):
  `dlqMessagesTotal.inc({ topic: params.originalTopic, consumer: params.context.consumer, error: params.error.name })`
- `catch` 블록(emit 실패, 현행 `:124` — rethrow **직전**):
  `dlqSendFailuresTotal.inc({ topic: params.originalTopic, consumer: params.context.consumer })`

생성자·팩토리는 손대지 않는다 — DLQHandler가 싱글턴 카운터를 import만 하고, `EventsModule` 배선 무변경.

### 3.3 dead code 절제

- `DLQHandler.shouldAlert` private 메서드(`:220-235`) 삭제.
- `sendToDLQ` 내 `// TODO: 중요한 에러는 알림 발송 …` 주석 블록(`:120-123`) 삭제.
- **존치**: DB 저장 TODO(`:117-118, :213-214`)·`reprocessDLQ`/`resolveDLQ` — 별개 관심사(DLQ 재처리 파이프라인), 본 작업 무관.

## 4. 검증 / 테스트

- **유닛**(`libs/events`, `ledger-drift-metric.spec.ts` 패턴 미러 — `register.metrics()` 텍스트 단언):
  - mocked kafkaClient resolve → `events_dlq_messages_total{topic="…",consumer="…",error="…"} 1` 존재, `warn` 로그 경로 유지.
  - mocked kafkaClient reject → `events_dlq_send_failures_total{…} 1` 존재 **+ 원 에러 rethrow**(`DLQHandler.sendToDLQ`는 raw 에러를 던짐 — `DlqDeliveryError` 래핑은 인터셉터 소관).
  - 테스트 격리: 전역 `register` 공유이므로 `beforeEach`에서 해당 카운터 `reset()`(또는 `register.resetMetrics()`)로 이전 테스트 누적 제거.
- **공통 규약**(스프린트 핸드오프 §281): `nest build core` exit 0 · arch 경계 spec(`inventory-write-boundary.arch.spec.ts`) PASS · 변경 파일 신규 eslint error 0 · 삭제 심볼(`shouldAlert`) 전역 참조 0. 스키마 무변경이라 dev DB 의존 ⏸ 없음. 통합 spec 없음(신규 전부 유닛).

## 5. 불가침 / 비목표

- **불가침**: `DLQHandler.sendToDLQ` 시그니처·DLQ 메시지 envelope 포맷·`getDLQTopicName` 명명 규칙 무변경(ops 재구동 도구 호환). `EventRetryInterceptor`·`EventsModule` 배선 무변경. Core `MetricsService`/`/metrics` 컨트롤러 무변경(전역 register 공유라 자동 노출).
- **비목표**:
  - **Grafana Cloud 알림 규칙 생성** — 리포 밖 UI 작업(운영자). §6에 권장 PromQL 명시. 이 작업은 알림의 **in-repo 절반(메트릭 방출)**만 제공.
  - **non-Core 앱 커버리지 확장** — 각 컨슈머 앱에 `/metrics` 컨트롤러 추가 + Alloy 스크레이프 타겟(+service discovery 주소)·Grafana Cloud active-series 비용 증가. known gap으로 §7 문서화, 필요 시 별도.
  - **DLQ 소비/재처리·DB 저장** — 기존 TODO 존치.
  - **Redpanda 브로커 메트릭 스크레이프**(:9644) — 앱 무관 균일 대안이나 platform SST 변경이라 별도.

## 6. 부수 (본 PR 동반)

- **현황판 갱신**: §5 잔여 우선순위 ①의 "DLQ 토픽 알림 확인"을 실상(알림 전무 → 본 작업으로 메트릭 방출 제공, Grafana 알림 규칙은 운영자 후속)에 맞게 정정 + 본 작업 블록 추가.
- **권장 알림 PromQL**(스펙에 기록, 운영자가 Grafana Cloud에 설정):
  - warn: `sum(increase(events_dlq_messages_total[10m])) by (topic, consumer) > 0`
  - critical: `sum(increase(events_dlq_send_failures_total[5m])) > 0`

## 7. 리스크

- **Core-only 관측 갭**: notification/wallet 등 non-Core 컨슈머의 DLQ는 메트릭이 방출되나 Alloy 미스크레이프라 Grafana Cloud에 안 나타남. 게이트의 동기가 된 Core 주문/환불 컨슈머는 커버됨. 확장 경로(각 앱 `/metrics` + Alloy 타겟)를 문서로 남겨 "커버 완료"로 오독되지 않게 한다.
- **카디널리티**: `error` 라벨을 클래스명으로 한정, `topic`·`consumer` 모두 bounded → active-series 안전. message 사용 시 폭발하므로 규칙 준수.
- **전역 register 중복 등록**: 모듈 스코프 싱글턴으로 회피(§3.1). Jest는 파일별 모듈 격리라 테스트 재등록 예외 없음.
