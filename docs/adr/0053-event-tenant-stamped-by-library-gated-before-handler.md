# 이벤트의 테넌트는 봉투에 라이브러리가 찍고, 소비 앱은 핸들러 앞의 문에서 거른다

## Status
Accepted (2026-10-29, 교정 10-30). 라이브(전환 배포 ②, 2026-11-02). 멀티테넌트 전체 그림은 `docs/multi-tenancy.md`.
선행: [[0051-core-tenant-per-database]] · [[0029-events-module-registration-surfaces]].

## Context
core 가 내는 상품·재고·주문 이벤트를 Medusa·channel-adapter·notification 등 여러 앱이 소비한다. 테넌트 2 의 상품이 생기면, 아무것도 하지 않을 경우
그 이벤트가 테넌트 1 의 Medusa 에 «판매중» 상품으로 들어간다. 소비 핸들러는 50개가 넘는다.

## Decision
1. **테넌트는 봉투 `metadata.tenantId` 에 싣고, 생산 코드가 아니라 `@app/events` 가 찍는다**(`libs/events/src/tenancy/event-tenant-stamp.ts`). 생산 코드가 넘겨도 덮어쓴다.
   - 직접 발행: CLS 맥락(`TENANT_CONTEXT_KEY`) → 없으면 앱 설정 T(`SERVED_TENANT_ID`).
   - outbox: 디스패처가 **행이 든 DB 의 테넌트**(`OUTBOX_TENANT_ID`, 없으면 T)로 나갈 때 찍는다. 이미 쌓여 있던 행도 나갈 때 찍힌다.
   - **core 는 직접 발행하지 않는다** — 전부 `enqueue`(outbox). 그래야 «테넌트 = 행이 든 DB» 규칙에 예외가 없다(`apps/core/src/platform/tenancy/core-no-direct-publish.spec.ts`).
2. **이벤트 계약이 이벤트마다 성질을 선언한다.** 기본은 «테넌트 이벤트», 계정 수명주기는 `event(…, { tenancy: 'account' })` 로 «계정 이벤트». payload 에는 테넌트를 싣지 않는다.
3. **소비 앱은 `startConsumer(app, { tenancy })` 로 모드를 선언한다 — 기본값 없음, 빠지면 기동 거부.**
   - `per-message`(core·user-service): 봉투의 테넌트를 맥락으로 세우고 핸들러를 부른다.
   - `served-tenant`(나머지 전부): `SERVED_TENANT_ID` 하나만 섬긴다.
4. **판정은 핸들러 앞의 문 하나가 한다**(`libs/events/src/tenancy/event-tenant-gate.ts`).
   - 남의 테넌트 이벤트 → 건너뛰고 센다(`events_skipped_other_tenant_total`). 그 테넌트의 정상 업무라 실패로 다루면 실패 화면이 정상 메시지로 찬다.
   - 테넌트 이벤트인데 테넌트가 없거나 목록에 없다 → `reject` 모드는 재시도 없이 DLQ, `warn` 모드는 경고 + 셈.
   - 계정 이벤트 → 통과.
5. **식별자는 하나다.** 봉투 `tenantId`·토큰 `tenant`·테넌트 목록의 `id`·앱 설정 T 가 같은 값이고, 코드에 상수로 두지 않는다.
6. **앱 설정 T 가 목록에 없으면 기동 거부**(`@app/tenancy` 의 `TenancyModule`). T 를 잘못 넣으면 그 앱은 모든 메시지를 건너뛰며 조용히 죽기 때문이다.
   어느 앱이 어느 모드·T 를 쓰는지는 `libs/tenancy/src/guards/tenancy-wiring.spec.ts` 가 SST 설정·로컬 env 와 대조한다.

## Considered Options
- **발행 쪽에서 거른다**(테넌트 2 는 상품 이벤트를 안 낸다) — 반려. «누가 듣는가»가 core 에 들어오고, 그 테넌트가 소비 앱을 붙이는 날 걷어내야 하며, Kafka 기록이 실제 업무와 달라진다.
- **핸들러마다 거른다** — 반려. 하나만 빠져도 누출이다. 공유 테이블 + `tenant_id` 를 반려한 것([[0051-core-tenant-per-database]])과 같은 이유.
- **테넌트별 토픽** — 반려. `@On` 바인딩이 정적 토픽이라 라이브러리를 다시 짜야 하고, 테넌트 목록이 토픽 이름으로 퍼진다.
- **payload 필드** — 반려. strict 스키마 토픽의 옛 소비자가 throw 하고, 재파싱하는 핸들러가 그 필드를 strip 한다.
- **전환 중 «봉투 시각 < 전환 시각이면 테넌트 1»** — 반려. 시한부라도 기본 테넌트를 코드에 들인다.

## Consequences
- 전환은 두 번 배포였다: ① 모든 생산 앱이 찍기 시작(문은 «없으면 경고») → consumer lag 0 확인 → ② «없으면 DLQ». ② 뒤에 재생된 옛 메시지는 DLQ 에서 사람이 다시 흘린다
  (`npm run events:untenanted-dlq`). core dead letter 는 Grafana 알림 하나가 실패 테이블 기록과 `.dlq` 를 함께 잡는다(`events_dlq_messages_total{job="core"}`).
- `UserCreated` 는 «들어온 앱의 테넌트에 고객 가입»(테넌트 이벤트)이다. 운영자가 대행해 만드는 직원 계정은 이것을 내지 않는다.
- `served-tenant` 앱(channel-adapter·analytics 등)이 여러 테넌트를 섬기게 되면 `per-message` 로 바꾸고 그 앱의 저장소(inbox 등)에 테넌트 축을 단다.
- 이 문은 Kafka 밖을 덮지 않는다 — 앱 사이 HTTP 는 [[0054-shared-services-serve-one-tenant]], 외부 연동(택배사 등)은 테넌트별 설정이 따로 필요하다.
