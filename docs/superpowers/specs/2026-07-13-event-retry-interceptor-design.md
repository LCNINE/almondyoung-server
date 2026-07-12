# 이벤트 컨슈머 재시도/DLQ — 필터 → 인터셉터 재설계

> 물류 백엔드 정상화 스프린트 현황판(`docs/logistics-backend-hardening-2026-07.md`) 작업 13 fast-follow.
> 이슈 #507 검토 중 발견된 상위 결함(필터 크래시)을 브레인스토밍(2026-07-13)으로 확정한 재설계.

## 1. 배경 — 검증된 사실 (2026-07-13, 소스+런타임 프로브)

`EventsExceptionFilter`(`libs/events/src/filters/events-exception.filter.ts`)는 프로덕션 RPC 에러 경로에서 **첫 판단 지점(:51)에서 즉시 크래시**한다. 검증 체인 (전부 설치본 `@nestjs/microservices` v11.1.17 기준):

1. `@OnEvent` = `EventPattern` 래퍼(`libs/events/src/consumers/decorators.ts:77`) → 컨슈머는 표준 Nest RPC 경로를 탄다.
2. 핸들러 에러 시 `RpcProxy.handleError`가 `new ExecutionContextHost(args)`로 host 생성 — **handler 인자 기본값 `null`, `setHandler` 호출 없음** → `host.getHandler()`는 항상 `null`.
3. 필터 `:48`의 가드는 **메서드 존재 여부만** 확인(`(host as any).getHandler ? ...() : fallback`) — 메서드는 항상 존재하므로 fallback 미발동, `handler = null`.
4. `:51` `reflector.get(RETRY_POLICY_METADATA, null)` → reflect-metadata가 non-object 타깃 거부 → **TypeError** (런타임 프로브로 재현 확인).
5. rejected promise가 `RpcExceptionsHandler.invokeCustomFilters` → `ServerKafka.handleEvent`의 `await` → kafkajs `eachMessage` reject → **offset 미커밋 → 무한 재전달**. 재시도·분류·DLQ·commit 코드는 전부 `:51` 아래라 도달 불가.

**함의**:
- `@RetryPolicy` 메타데이터를 전혀 못 읽음 — `nonRetryableErrors` 포함 전부 무시.
- 작업 13 P1-1/P1-2의 포이즌 분류(즉시 DLQ)는 프로덕션에서 **미작동** — 현황판 ✅ 표기와 달리 여전히 크래시→재전달. 유닛은 부착 wiring만 검증(`order-events.consumer.spec.ts:418`)해 잠복.
- **이슈 #507**(`:112`가 pure 함수 `updateRetryContext` 반환값 폐기 → `attemptNumber` 0 고정 → 무한 루프)도 실재하나, `:51` 크래시에 가려진 두 번째 증상 — `:112`만 고쳐도 프로덕션은 안 고쳐짐. #507 본문의 "P1-1/P1-2 핵심 경로는 영향 없음" 판단도 상위 결함으로 무효.
- `retryHandler`(`:161`)도 handler=null이라 항상 `'Cannot retry handler'` throw — **필터로는 재시도 자체가 불가능**.

**구조적 원인**: 예외 필터는 `ArgumentsHost`만 받아 (a) 핸들러 메타데이터를 읽을 수 없고(null) (b) 핸들러 재실행 수단(`next.handle()`)이 없다. 둘 다 되는 도구는 인터셉터 — 같은 Kafka 경로의 `EventTypeGuard`(`libs/events/src/guards/event-type.guard.ts:21`)가 인터셉터로 `reflector.get(..., context.getHandler())`를 프로덕션에서 이미 성공적으로 수행 중(살아있는 증거).

## 2. 결정 (브레인스토밍, 2026-07-13)

| 쟁점 | 결정 | 근거 |
|---|---|---|
| 재시도 의미론 | **in-process 재시도 유지** (현행 계약: retryable → backoff 재시도 후 DLQ, nonRetryable → 즉시 DLQ) | 작업 13 의도를 최소 변경으로 실작동시킴. retry topic(non-blocking)은 인프라 확장이라 이번 범위 과잉 |
| 부착 전략 | **`APP_INTERCEPTOR` 전역 등록** (EventsModule `forRoot`/`forConsumerModule` 양쪽) | 미부착 사고(작업 13 근본 원인) 원천 차단. 과거 "전역 enhancer가 타 컨텍스트 침범" 사고는 첫 줄 컨텍스트 가드로 방어 — `WalletAuthGuard`(`wallet.module.ts:162`)·`HttpIdempotencyInterceptor:21`·`SchemaValidationInterceptor`가 확립한 리포 패턴 |
| 기존 필터 | **완전 제거** (클래스 + `@UseFilters` 8곳 + export) | 인터셉터 전담 후 필터 도달 에러는 인터셉터 자체 버그/DLQ 실패 재던짐뿐이고 Nest 기본 로깅이 커버. 지금 형태는 안전망이 아니라 크래시 지점 |
| 테스트 깊이 | **유닛 + 실배선 인프로세스** | 이번 잠복의 교훈: wiring-only 유닛은 Nest가 실제로 만드는 실행 경로를 못 봄. 브로커 없이 실플럼빙 검증 |

## 3. 설계

### 3.1 `EventRetryInterceptor` (신규)

`libs/events/src/interceptors/event-retry.interceptor.ts`. 처리 순서:

1. **컨텍스트 가드** (전역 등록 안전장치):
   - `context.getType() !== 'rpc'` → `next.handle()` 통과 (HTTP/WS 무개입).
   - `switchToRpc().getContext()`가 `KafkaContext` instanceof 아니면 통과 (미래 transport 방어).
   - request-response 메시지(`KafkaHeaders.CORRELATION_ID` + `REPLY_TOPIC` 헤더 존재) → 통과 — 에러를 삼키면 요청자가 빈 응답을 받으므로 이벤트 스타일에만 적용. 현 컨슈머는 전부 이벤트.
2. **정책 조회**: `reflector.get(RETRY_POLICY_METADATA, context.getHandler())` — 인터셉터의 `getHandler()`는 실핸들러 반환. `DISABLE_DLQ_METADATA` 존중, `SchemaValidationError`는 항상 nonRetryable(현행 유지). `normalizeRetryPolicy`·`isRetryableError`·`calculateBackoffDelay` 등 `retry.util.ts` 재사용(유틸은 정상 — 버그는 호출부였음).
3. **재시도 루프**: `next.handle()` + RxJS 재구독(defer/catchError 루프). attempt 카운터는 클로저 변수로 정확히 증가 — **#507은 코드 대체로 소멸**. backoff 대기 중 `KafkaContext.getHeartbeat()` 콜백을 호출해 `max.poll.interval.ms` 초과/리밸런스 churn 방지 (OrderCreated 정책은 누적 최대 ~30s 대기).
4. **최종 실패**: nonRetryable 판정 또는 재시도 소진 → `DLQHandler.sendToDLQ`(실제 `attemptHistory` 포함) → **`of(undefined)` 반환으로 정상 완료 → offset commit** (`EventTypeGuard`와 동일 패턴). DLQ 전송 실패 시에만 에러 재던짐(의도된 재전달, 현행 의도 유지). `DLQHandler`는 `@Optional` 주입 — `enableDLQ=false` 구성이면 로그 후 삼킴(offset commit; 현행 필터의 "DLQHandler 부재 시 로그 후 commit" 의미 유지).

### 3.2 EventsModule 등록

- `forRoot`(`events.module.ts:79`)·`forConsumerModule`(`:239`) 양쪽 providers 배열에 `APP_INTERCEPTOR`로 추가하되 **`SchemaValidationInterceptor`보다 앞(바깥)** — 전역 인터셉터는 등록 순서대로 감싸므로, 스키마 검증 에러도 재시도 인터셉터의 분류망(SchemaValidationError → 즉시 DLQ)에 잡힌다. 지금까지 필터가 잡던 경로의 대체.
- **중복 등록 무해성**: 한 앱에서 여러 모듈이 forRoot/forConsumerModule을 호출(core는 4곳+)해 인터셉터가 중첩되지만, 에러는 최내곽 재시도 인터셉터가 잡아 삼키므로 바깥 인스턴스들은 정상 완료만 관찰 — 의미론 불변. (SchemaValidation 중복 실행은 기존 특성, 본 작업 무관.)

### 3.3 필터 제거

- `EventsExceptionFilter` 클래스·`filters/` 디렉터리 삭제, `index.ts` export 제거.
- `@UseFilters(EventsExceptionFilter)` 8곳 제거: notification 3(order/user/wallet-event), core 1(order-events), wallet 2(ugc-command/billing-charge), analytics 2(orders/products ingest). 소비자 파일의 미사용 import 정리.
- `order-events.consumer.spec.ts:418`의 필터 부착 assert를 제거하고 §4 회귀 가드로 대체.

## 4. 검증 / 테스트

- **유닛** (`libs/events`, 실제 `Reflector` + 실제 데코레이터 붙은 테스트 컨슈머 클래스):
  - nonRetryable(정책 지정·SchemaValidationError) → 재시도 0회, 즉시 DLQ, 에러 미전파.
  - retryable → 정확히 `maxRetries`회 재시도 후 DLQ (#507 회귀 봉인), backoff가 1s→2s→… escalate, 재시도 중 성공 시 즉시 정상 완료.
  - DLQ 전송 실패 → 에러 재전파(재전달 유도). `disableDLQ` → DLQ 미호출 + 삼킴.
  - 컨텍스트 가드: http 컨텍스트 통과, request-response 메시지 통과.
  - backoff 중 heartbeat 호출 assert.
- **실배선 인프로세스** (신규): `TestingModule`로 실제 컨슈머 컨트롤러 + 전역 인터셉터를 올리고 Nest `RpcContextCreator`가 바인딩한 프록시 핸들러를 실제 `KafkaContext`로 직접 호출. 포이즌 메시지 투입 → DLQ(mock KAFKA_CLIENT) 호출 + 에러 미전파(= offset commit 등가) assert. 이 계층이 있었으면 이번 null-handler 크래시를 잡았음.
- **컨슈머 회귀 가드**: `order-events.consumer.spec.ts`의 `@RetryPolicy` 메타데이터 assert 존치(분류 계약 봉인). 필터 부착 assert는 전역 등록 assert(EventsModule providers에 `EventRetryInterceptor` 존재)로 대체.
- **공통 규약**: `nest build` 전 앱 exit 0 · 변경 파일 신규 eslint error 0 · 기존 이벤트 관련 스펙 GREEN.

## 5. 불가침 / 비목표

- **불가침**: 핸들러 멱등 가드(작업 13 §5), G4·G7, DLQ 메시지 포맷(`DLQHandler.sendToDLQ` 시그니처·envelope 파싱) 무변경 — ops 재구동 도구 호환 유지.
- **비목표**:
  - retry topic(non-blocking retry) 도입 — 필요 시 별도 설계.
  - channel-adapter의 자체 로컬 `RetryPolicy` 데코레이터(+DLQ 전송 주석 처리 반쪽 구현, `apps/channel-adapter/src/decorators/`) 이관 — **별도 이슈로 분리**. 단 전역 인터셉터가 깔리면 기본 정책의 보호는 자동 적용됨.
  - DLQ 토픽 모니터링/알림 (작업 13 리스크 §8 계승 — 여전히 유효한 운영 과제).

## 6. 부수 정리 (본 PR 동반)

- **이슈 #507**: 본 재설계로 close (재시도 루프 코드 자체가 대체됨을 코멘트로 기록).
- **신규 이슈**: 필터 크래시 발견(§1) 감사 추적용으로 등록 후 같은 PR에서 close, #507과 상호참조.
- **현황판**: 작업 13 P1-1/P1-2 ✅를 실상(프로덕션 미작동 → 본 작업으로 실작동)에 맞게 정정, 본 작업 블록 추가.

## 7. 리스크

- **전역 등록의 파급**: EventsModule을 import하는 전 앱(HTTP-only인 user-service 포함)에 인터셉터가 깔림 — 첫 줄 `getType() !== 'rpc'` 가드로 HTTP는 무개입. 리포에 동일 패턴 선례 3곳(§2 표).
- **in-process 재시도의 파티션 블로킹**: backoff 대기 동안 해당 파티션 소비 정지(현행 계약과 동일). heartbeat 호출로 리밸런스는 방지하나, 긴 정체가 문제 되면 retry topic 재설계(비목표)로 승격.
- **삼킴의 관측성**: 포이즌이 "시끄러운 파티션 정체"에서 "조용한 DLQ 적재"로 바뀌는 트레이드오프는 작업 13 §8에서 이미 수용된 결정 — DLQ 모니터링 과제가 전제.
