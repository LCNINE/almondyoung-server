# 합배송·송장분할·백오더·피킹 V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## 다음 세션 핸드오프 (2026-07-16 세션 2 종료 시점 — PR A 코드 완료)

> 이 절이 세션 간 인수인계 지점이다. 별도 핸드오프 문서를 만들지 않는다 — 이 플랜이 SoT 이고,
> 사본을 두면 어긋난다. 작업이 끝나면 이 절을 지운다.

**PR A (V1 코드 제거 + outbox topic 강제) 는 코드·검증 완료.** 이전 세션의 미커밋 12 파일을 이어받아
완성했다. 남은 것은 배포와 그 이후 단계다:

1. **배포 전 유일한 사람 결정: `FULFILLMENT_V2_CUTOVER_AT` 확정.** 매니페스트에
   `2026-07-16T00:00:00.000Z` 가 잠정값으로 있다. 자연스러운 선택은 **v2 go-live(배포) 시각** —
   cleanup 이 기존 FO 를 전부 지우므로 "cutover 이전 주문 = 수동 처리" 결정과 정합한다. 불변값이며
   epoch 로 바꾸지 말 것: 이 타임스탬프는 DB 상태와 무관하게 옛 이벤트 재전달을 영구 불활성화하는
   유일한 stateless 가드다(`shouldEnqueueFo` 의 도메인 시각 비교). 이번 세션에 사용자와 재확인한 결정.
2. **배포** (`sst deploy`) — expand 마이그레이션은 이미 적용돼 있으므로 이 배포부터 topicless outbox
   write 가 물리적으로 불가능해진다.
3. **운영자 정리** — `DELETE FROM outbox_events WHERE status='published'` + FO cleanup (런북
   allowlist 절차). 런북 머리에 "현행 절차" 배너를 넣어 legacy 시절 의식과 구분해 뒀다.
4. **PR B** — `topic`/`idempotency_key` NOT NULL + V1 컬럼/테이블/enum 드롭 → `migrate`.
   "제거 범위 실측" 절의 표(사장 enum 12 값, `fulfillment_order_batches` 등)가 그대로 PR B 의 사양이다.
   Goodsflow 코드 제거 여부(enum 값 `goodsflow` 포함)도 PR B 시점에 결정.

**PR A 에서 원래 목록에 없던 실측/결정** (다음 세션이 알아야 할 것):

- topicless 호출부는 12 곳이 아니라 **13 곳**이었다(`inventory-command.service.ts` 의 `ship()` 비배치
  갈래가 하나 더). 전부 명시 topic + idempotencyKey 로 전환 — **폴백 목적지 보존 원칙**: ORDER_CREATED/
  ORDER_MODIFIED 2 곳은 역사적 catch-all 목적지(`fulfillments.events.v1`)를 그대로 명시했다(주석 있음).
  재라우팅은 컨슈머 분석이 필요한 별도 결정.
- **dispatcher 잠재 버그 동시 해소**: 명시 topic 분기가 3개뿐이라 `inventory.events.v1` 을 명시로 넘기면
  "Unknown explicit topic" 으로 죽었다(V2 batch dispatch 경로가 이미 밟고 있던 지뢰). 명시 분기를 5개
  스트림 전부로 확장하고 폴백은 fail-closed throw 로 대체 + 스펙 커버.
- `assertMutationAllowed`(410)·`FULFILLMENT_LEGACY_CLOSED_CODE`·`FULFILLMENT_V2_NOT_ACTIVE_CODE`(409)
  제거. `assertV2MutationAllowed` 는 운영 게이트로의 위임만 남기고 이름은 호출부 의도 표현용으로 유지.
- **FO 수동 reserve/unreserve 는 라우트째 은퇴** (facade `reserve`/`unreserve`, 컨트롤러 라우트,
  admin-web 훅/다이얼로그). `adminAvailableActions` 도 더 이상 광고하지 않는다. 남은 수동 개입은
  transfer 뿐. V2 예약은 shipment line 단위 자동(부분예약 + retry worker).
- V2 create 는 digital/void-only 주문에 **placeholder FO 를 만들지 않는다(null 반환)** — V1 의
  completed 빈 FO 동작과 다르고, 스펙도 그렇게 고정했다.
- V1 의미론을 단언하던 스펙은 삭제가 맞다: `fulfillment-stock-allocation.integration`(FO 단위
  할당/unfulfillable/retry), retry worker 통합 스펙(V2 커버리지는
  `shipment-reservation.integration.spec.ts:120-121` 에 이미 있음), golden-path·batch-pick-ship 등.
- `wireLogistics` 의 게이트에 **epoch cutover 를 명시** — cutover 미설정 v2 게이트는 fail-closed 라
  backlog enqueue 가 전부 거부된다(conversion 통합 스펙이 이걸로 깨졌었다).

**검증 결과** (이 세션 실측):

- core 프로덕션 tsc(`tsconfig.app.json`) exit 0. 루트 tsc apps/core **신규 0** (87 vs HEAD 89 —
  "신규"로 보이는 5줄은 전부 HEAD 동일 에러의 라인 이동, 개별 대조 완료).
- 변경 파일 eslint(--fix 없이) HEAD 대조 **신규 0** (대량 음수 델타).
- 유닛: core 모듈 706 passed. 잔여 실패 2 스위트(`partial-cancellation-refund-calculator`,
  `product-sellable-quantity.calculator`)는 **HEAD 에서도 동일 실패** — 기존 debt.
- 통합(fresh 로컬 DB): outbound-v2 **8 suites/56 tests 전부 green**, core 통합 35 passed / 4 failed 중
  1건(`logistics-support`)은 이 세션의 헬퍼 삭제 실수(상수 오삭제)로 즉시 복구, 나머지 3건
  (`inventory-command.adjust`·`unified-reservation.lock`·`stocktaking-uniques`)은 **HEAD 에서도 같은
  메시지로 실패** — 기존 debt (`{db}` 캐스팅 스펙이 `dbService.run` 부재로 죽는 패턴 등).
- admin-web tsc **신규 0** (전후 diff 동일), V1 식별자 rg 게이트 0 히트.
- 사보타주: 호출부에서 topic 한 줄 제거 → TS2345 red 확인 → 복원 green. dispatcher fail-closed 는
  스펙 전환 과정에서 red 를 직접 관측(옛 폴백 기대 테스트가 새 throw 로 깨지는 것).

**검증 레시피와 이 레포의 함정** (유지 — 다음 세션도 그대로 쓸 것):

- **타입체크를 절대 개수로 보지 말 것.** 루트 tsc 는 수천 개 상시 에러(대부분 `web/` 스토어프론트).
  변경 전후 diff 로 *신규 0* 을 확인한다. 별도 worktree 로 HEAD 기준선을 만들면 stash 없이 안전하다 —
  단 untracked 생성물 차이로 절대 개수가 어긋나므로 반드시 파일 단위로 대조한다.
  `apps/*/tsconfig.app.json` 은 spec 제외 — 스펙 검증은 루트로.
- **lint 도 같은 방식.** `npm run lint` 는 전역 `--fix` 라 검증에 쓸 수 없다. 변경 파일만
  `npx eslint --format json`(--fix 없이) 후 HEAD worktree 와 (파일,규칙) 단위 카운터로 대조.
- **`rg -r` 주의.** `-r` 은 replace 다.
- **통합 러너**: `npm run test:core:integration:local -- "apps/core.*integration"` (Docker).
  로컬 DB 는 커밋형 스펙 잔재가 누적된다 — 전역 0-count 단언 스펙이 있으므로 판정 전
  `DROP DATABASE core WITH (FORCE); CREATE DATABASE core;` 로 리셋할 것.
- **사보타주 규율**: 가드를 고쳤으면 일부러 부숴 red 를 확인하고 되돌린다. 되돌릴 때 `git checkout --
  <file>` 금지(세션의 정당한 미커밋 변경까지 날린다) — 넣었던 줄만 정확히 되빼는 방식으로.

**미결** (사람 결정):

1. **`FULFILLMENT_V2_CUTOVER_AT` 확정** — 위 1번. 배포 전 유일한 블로커.
2. V2 수동 발행 경로 시점(한진 계약이 idempotency 를 노출하지 않을 때의 유일한 출구), Goodsflow
   코드/enum 제거 여부 — 둘 다 PR B 이전까지 결정하면 된다.

---

## 진행 상태 (2026-07-16 기준)

Task 1~23 완료, Task 24 는 **provider 미구현으로 블록**, **Task 25 는 착수 가능** (Task 24 에 연쇄 블록되지 않는다 — 아래). 브랜치 `feat/outbound-v2-consolidation-backorder`.

**Task 25 는 Task 24 를 기다리지 않는다.** Task 24 의 커토버 의식(스냅샷·audit 산출물·watermark·관찰 기간)은 *보호할 V1 데이터가 있을 때* 필요한 절차인데 그런 데이터가 없다(2026-07-16 확인). 남는 선행 조건은 두 가지뿐이다: (1) V1 을 안 쓰는 코드를 먼저 배포하는 `deploy → migrate` 순서, (2) NOT NULL 강화 전에 규격 미달 행(예: `shipmentLineId IS NULL` 인 legacy 예약)을 지우는 cleanup. 둘 다 한진과 무관하다. 자세한 근거는 Task 25 절 참조.

expand 마이그레이션과 배포는 적용됐다(2026-07-16 확인). 배포된 Core 는 `FULFILLMENT_WORKFLOW_MODE: 'legacy'` — 즉 **V1 이 현재 유일하게 살아있는 출고 경로**다.

**Task 24 블로커 — V2 invoice 를 발행할 수 있는 provider 가 없다.**
`invoice-orchestrator.service.ts:459` 는 `issue.safeToRepeat` 와 `issue.lookupByIdempotencyKey` 가 **둘 다 false 면** `unsupported` 를 던진다. 이 게이트는 attempt 카운터보다 앞이라 재시도 복구뿐 아니라 **모든 발행이 거부된다**. 이 상태로 `v2` 를 켜면 송장을 못 받는 Draft shipment 만 쌓인다. 게이트가 보는 것은 provider **이름이 아니라 capability 플래그**이므로, provider 를 갈아끼우는 것만으로는 열리지 않는다. capability 플래그를 손으로 true 로 바꾸는 것은 게이트 무력화이므로 금지.

**결정 (2026-07-16): Goodsflow 를 쓰지 않고 한진택배 API 를 쓴다.** 스펙과 결정기록 어디에도 provider 선택이 적힌 적이 없다 — V1 코드에서 흘러온 사실상의 기본값이었으므로, 이 결정은 기존 결정을 뒤집는 게 아니라 빈칸을 채운다.

이 결정은 블로커를 **해소하지 않고 이동시킨다**. 성격은 바뀐다: 벤더가 계약을 안 열어주는 문제(repo 밖) → 우리가 구현하면 되는 문제(repo 안, 단 공식 계약서 필요).

- 배선은 이미 다 있다. schema enum(`invoice_method` 에 `hanjin`), V2 orchestrator(`ProviderName`, `:1118` 선택), V2 DTO(`shipment-invoice.dto.ts:10`), V1 전환 스위치(`invoice.service.ts` 의 `defaultIssueMethod`)까지 한진을 1급으로 다룬다.
- 없는 것은 `HanjinDeliveryProvider` 본체뿐이다. 현재 fail-closed 스텁 — 모든 메서드가 `unsupported` 를 던지고, `isConfigured()` 가 `false` 를 하드코딩하며, capability 4개가 전부 false 다. 즉 **지금은 Goodsflow 보다 더 닫혀 있다** (Goodsflow 는 `void.lookupByServiceId: true` 라도 있었다).
- 이건 사고가 아니라 의도다. 옛 스켈레톤이 **추정 endpoint** 를 호출하고 있었고, 추정 주소로 쏘다가 timeout 이 나면 중복 송장을 복구할 수 없어 통째로 걷어냈다(`hanjin-delivery.provider.ts:22-28`).

**한진 구현의 선행 조건 — 공식 API 계약서가 다음 셋에 답해야 한다.** 이 답이 곧 capability 플래그 값이고, 플래그가 게이트를 연다.

1. issue 요청에 클라이언트 멱등키를 실을 수 있는가 → `issue.safeToRepeat`
2. timeout 후 그 키(또는 안정적 참조)로 발행 결과를 조회할 수 있는가 → `issue.lookupByIdempotencyKey`
3. void 를 service id 로 조회/취소할 수 있는가 → `void.lookupByServiceId`

**1·2 중 최소 하나가 참이어야 한다.** 둘 다 없으면 한진도 같은 벽이고, provider 교체로는 해결되지 않는다.

**후속 결정 필요**: Goodsflow 를 코드에서 제거할지, enum·기존 행은 두고 신규 발행만 한진으로 돌릴지. 전자는 `invoice_method` enum 값 제거라 destructive — Task 25 로 미루는 게 자연스럽다(아래 "실측 결과" 참조).

**Task 24 중 완료된 것**: expand 배포 배선. `FULFILLMENT_WORKFLOW_MODE` 가 배포 매니페스트에 없어서 이 브랜치를 배포하면 Core 가 부팅 실패했다(production 에서 필수 — `env.validation.ts:71`, 배포는 `NODE_ENV=production`). `deployments/lcnine/services/infra/services.ts` 의 Core `environment` 에 `legacy` 를 배선했고, 런북에 빠져 있던 expand 배포 절차와 증거표를 추가했다. 커밋 `85d37a4f3`.

**expand 배포는 `migrate → deploy` 순서다** (contract 와 반대). ADR-0005 §5 의 `deploy → migrate` 는 contract 전용이고, expand 를 지키는 "additive 만" 컨벤션은 *새 schema 가 옛 코드를 안 깨는 것*만 보장한다. 반대 방향은 보장하지 않는데, 이 릴리스는 outbox 에 `topic`/`idempotency_key` 를 가르치고 outbox 는 V1 경로도 탄다.

**체크 근거를 구분해서 읽어야 한다.**

- **Task 1~22**: 체크 근거는 *각 Task 가 지정한 `Commit:` 메시지의 커밋이 실제로 존재한다*는 것뿐이다. 항목별 재검증은 하지 않았다. Task 23 리뷰에서 "지정 커밋이 있어도 항목이 실제로는 충족되지 않은" 사례가 두 건 나왔으므로(아래), 이 체크를 항목별 완료 증거로 신뢰하면 안 된다. 릴리스 게이트를 통과시키려면 Task 24 가 요구하는 실환경 증거로 다시 확인해야 한다.
- **Task 23**: 전 항목 완료. 잔여 5건(체크박스 4개)은 모두 *테스트가 초록인데 자기가 검증한다고 주장하는 것을 실제로는 검증하지 않는* 유형이었고 — 항등식 단언, 배포 설정 대신 테스트 자신의 복사본 검증, 3행만 해싱, 이름이 증명 범위를 초과 — 고친 뒤 **각각 가드를 일부러 부숴 red 를 확인하고 되돌리는 방식으로** 검증했다. 이 규율이 없으면 같은 함정에 다시 빠진다. 실제로 이 과정에서 사보타주 자체가 no-op 이거나(이미 0인 값에 `qty > 0` 조건) 엉뚱한 메서드에 주입돼 "초록"이 나온 사례가 두 번 있었다 — 사보타주가 red 를 만드는지부터 확인해야 증명이 성립한다.
- **Release gate checklist**: 전부 미체크다. 로컬 스위트 통과는 첫 항목의 필요조건일 뿐이고, 나머지는 실환경 커토버(Task 24) 없이는 채울 수 없다.

**Task 23 리뷰에서 발견돼 고친 것** (커밋 `85dc008bb`, `b24fe78bd`):

- recall 의 데드락 수정이 short-pick 에 적용되지 않아 recall↔short-pick / short-pick↔short-pick 데드락이 남아 있었다. `shipment_operation_members.shipment_id` FK 가 KEY SHARE 를 잡는다는 사실이 누락된 결과다.
- migration rehearsal 의 watermark 검증이 `isNewSalesOrder: false` 로 단락돼, cutover 비교 로직을 지워도 통과하는 상태였다. Task 24 의 "replay an older event and prove it cannot enqueue FO" 게이트가 이 테스트에 걸려 있었다.

**Task 23 후속 이슈는 전부 해소됐다** (2026-07-16). 아래 두 항목은 남는 참고사항이다.

- `apps/*/tsconfig.app.json` 은 `**/*spec.ts` 를 제외한다 — 스펙 타입체크에 이 config 를 쓰면 파일을 읽지도 않고 exit 0 이 난다. 스펙을 포함하는 program 은 루트 `tsconfig.json` 이다.
- 루트 `tsconfig.json --noEmit` 은 현재 **4789 개의 상시 에러**를 낸다(레포 전역 debt). 변경 검증은 절대 개수가 아니라 *변경 전후 diff 로 신규 에러 0* 을 확인하는 방식이어야 한다.

해소 내역:

- **outbox topology 헬퍼 하이스팅.** `__support__/outbound-v2-outbox.ts` 로 올렸다(`expectExactOutboxTopology` + `ExpectedOutboxTopology` + 구조적 `OutboxTopologyWorld`). 실측 결과 "세 스펙"이 아니라 `outbound-v2-scenarios`·`outbound-v2-lifecycle-scenarios` 두 스펙에 150 줄이 `world` 타입명만 다른 채 완전 동일 복붙이었고, `outbound-v2-warehouse-scenarios` 는 카운트만 보는 별개의 약한 변형(`expectArtifactCardinality`)이라 그대로 뒀다 — 통합 대상이 아니다. 순 -276 줄.
- **시나리오 06 이름.** `addShipment` 가 `assertDispatchableInvoice` 를 거쳐 `SHIPMENT_INVOICE_NOT_READY` 로 막으므로(`invoice-orchestrator.service.ts:432`, `outbound-batch-orchestrator.service.ts:967`) 발행 실패한 shipment 는 batch 에 **들어갈 수조차 없다** — "sibling batch shipment" 는 성립하지 않는 이름이었다. 이름을 실제 동작으로 좁히고, 그 배제 이유를 단언으로 못박았다(이름이 드리프트한 원인이 이 암묵적 가정이었다).
- **`ValidationPipe` 하드코딩 복사본 4 건 제거.** 전부 `createGlobalValidationPipe()` 로 교체. 단 이 교체는 **동작상 no-op** 이다 — 옛 복사본과 정본의 차이는 `forbidNonWhitelisted: false`/`disableErrorMessages: false`(둘 다 Nest 기본값)와 cosmetic 한 `validationError` 뿐이고, 위조 필드를 실제로 거르는 `whitelist: true` 는 양쪽에 있었다. 얻는 것은 커버리지가 아니라 **drift 제거**(main.ts 가 바뀌면 스펙이 따라온다). 정본이 red 를 만든다는 증명은 Task 23 의 `outbound-v2-authorization.spec.ts` 하이스팅 때 이미 했으므로 반복하지 않는다 — 재증명하려고 `whitelist` 를 프로덕션에서 false 로 되돌리는 것은 보안 설정 약화이므로 하지 말 것.

`protectedHashes` 3행 해싱 건은 해소됐다 (위 Task 23 항목 참조).

**시나리오 14 hand-seed 건은 해소됐다.** `seedRecalledAttemptHistory` 를 지우고 13 의 실제 연쇄(`planAndIssue → stageBatch → lastScan → recall`)로 attempt 1 을 만든 뒤 재출고한다. 검증은 사보타주 대조로 했다 — dispatch 가 work item 을 `completed` 대신 `packing` 으로 남기게 하면(재투입 시 `uq_outbound_work_item_active_shipment` 위반) **새 14 는 red, 옛 14 는 green** 이었다. 옛 14 의 shipment 는 batch 를 거친 적이 없어 work item 자체가 없었기 때문이다. 시나리오 13 도 green 이라 이 커버리지는 14 만 짊어진다.

이 과정에서 같은 계열의 결함 두 건이 더 드러났다.

- **v1 full-completion 투영의 once-only 성질이 재출고와 만나는 지점이 무검증이었다.** 키가 `${foId}:fully-shipped` 라 attempt 2 는 v1 `FulfillmentShipped` 를 다시 만들지 않는다 — 재출고 후 outbox 는 8 이 아니라 **7**. 옛 14 는 outbox 0 에서 시작해 선행 v1 행이 없었으므로 이 상호작용을 한 번도 건드리지 못했다. 이제 `expectExactOutboxTopology` 가 attempt 2 개에 v1 행 1 개로 고정한다.
- **`shipment_tracking` immutability 단언이 존재할 수 없는 상태를 검증하고 있었다.** tracking 을 쓰는 프로덕션 경로는 `recordProviderEvent` 뿐이고 `in_transit`/`delivered` 만 받는데, recall 은 그 둘을 모두 거부한다(`shipment-recall.service.ts:201`). 즉 **recall 가능한 attempt 는 tracking 행을 가질 수 없다** — 옛 픽스처의 `status: 'shipped'` tracking 은 어떤 코드도 만들 수 없는 fiction 이었다. 단언은 "재출고가 옛 attempt 에 tracking 을 날조하지 않는다" 로 좁혔다. Task 21 의 "old attempt/source/tracking remains immutable history" 중 tracking 절반은 recall 경로에서는 검증 대상이 아니다 — 필요하다면 attempt 2 배송 후 webhook 시나리오로 따로 세워야 한다.

**Goal:** FO 중심의 단일 출고 경로를 shipment/attempt 중심 모델로 교체해 부분예약·백오더, Draft 분할/합배송, shipment 단위 송장, 세 가지 피킹 전략, 즉시 dispatch, short-pick 격리, recall/재출고를 수량 보존과 멱등성이 검증된 상태로 제공한다.

**Architecture:** SO/FO/FOI는 원수요와 정산 progress를, shipment/line/invoice/dispatch-attempt는 출고 truth를, reservation/picking/session/stock-ledger는 물리 재고 truth를 소유한다. Core command는 이 세 축을 한 transaction과 고정 잠금 순서로 조정하고, 외부 송장 API만 durable saga로 분리한다. 실제 V1 출고 이력이 없다는 전제에서 fulfillment 작업 데이터는 maintenance window에 명시적 allowlist로 제거하며 SKU/SO/stock ledger는 보존한다.

**Tech Stack:** NestJS, TypeScript, Drizzle ORM/PostgreSQL, Kafka typed streams/outbox, Jest, Next.js admin-web, Yarn workspace.

**Source of Truth:** `docs/superpowers/specs/2026-07-14-outbound-consolidation-split-backorder-technical-design.md`. 코드 감사 기준은 `de7c443a3`이며, 구현 중 설계 의미를 바꿔야 하는 발견이 나오면 코드부터 바꾸지 말고 스펙/결정 기록을 먼저 갱신한다.

## 구현 경계

- Hard cutover다. V1/V2 row별 `workflowVersion`, 기존 FO drain, 기존 fulfillment row 변환, 과거 주문 replay를 만들지 않는다.
- 보존 대상은 `sales_orders`, `sales_order_lines`, SKU/mapping/profile/warehouse/location master와 stock journal/event/ledger다. cleanup은 fulfillment allowlist 밖을 삭제하지 않는다.
- 자사 물리 주문만 V2 router를 탄다. digital-only는 FO를 만들지 않고, `fulfillmentMode='drop_ship'`은 기존 direct-ship 경로를 유지한다.
- V2 producer보다 event contract와 channel-adapter consumer를 먼저 배포한다. 기존 `FulfillmentShipped`는 전체 완료 projection으로만 남고 외부 채널 발송 호출을 하지 않는다.
- FO status에는 delivered를 넣지 않는다. shipment delivery와 FO demand settlement를 별도 축으로 유지한다.
- Draft는 mixed shipping profile을 잠시 가질 수 있지만 Planned 전 반드시 profile별로 분리한다. 운영자 profile 강제 선택은 제공하지 않는다.
- shipment line이 FO와 shipment의 M:N 연결이자 reservation target이다. batch/work item/dispatch의 단위는 FO가 아니라 shipment다.
- 작업 중 custody 변화는 batch session balance/event에, 경제적 반출과 recall 복귀는 stock ledger에만 쓴다.
- 기존 `AuditService.log()`는 실패를 삼키므로 위험 명령에서 사용하지 않는다. operation lineage와 필수 `USER_ACTION` audit가 같은 DB transaction에서 함께 성공해야 한다.
- 기존 `InventoryCommandService.moveInternal()`를 포함한 일반 재고 이동 경로는 batch-controlled source bucket을 이동하지 못하도록 공통 guard를 거친다.
- 현재 사용자의 수정인 설계 스펙과 `docs/outbound-consolidation-split-backorder-decision-record.md`는 구현 작업에서 덮어쓰거나 되돌리지 않는다.

## 공통 계약

### Workflow mode

`FULFILLMENT_WORKFLOW_MODE=legacy|maintenance|v2`를 단일 운영 스위치로 두고, V2에는 ISO timestamp `FULFILLMENT_V2_CUTOVER_AT`를 함께 요구한다.

- `legacy`: additive 배포 전환 기간의 기존 동작. 새 환경에서는 의도적으로만 선택한다.
- `maintenance`: SO 수집은 유지하지만 FO backlog enqueue/claim, reservation retry, fulfillment mutation, picking/inspection/dispatch worker를 중지한다. outbox의 비-fulfillment 이벤트 발행은 멈추지 않는다.
- `v2`: cutover timestamp 이후 처음 수신·생성된 새 자사 물리 주문만 FO+최초 Draft shipment를 만든다. 기존 SO에 대한 Kafka redelivery는 ownership 같은 비-fulfillment 자가치유만 수행하고 backlog를 만들지 않는다. V1 mutation은 계속 닫혀 있다.
- production에서 값 누락은 startup failure로 처리하고 dev/test만 `legacy` 기본을 허용한다.
- maintenance 동안 들어온 물리 주문을 자동 backfill하지 않는다. 운영은 upstream 주문 intake를 함께 멈추거나 별도 수동 예외 목록으로 처리하며, 그 목록을 Kafka replay로 해소하지 않는다.

### Command/idempotency

모든 mutation은 `Idempotency-Key`를 필수로 받고 JWT의 사용자 ID를 operator로 사용한다.

- `fulfillment_command_requests`를 transport-level replay envelope으로 추가한다: `commandType`, `idempotencyKey`, `requestHash`, `status`, `resourceType/resourceId`, `operationId/attemptId`, `responseSnapshot`, timestamps, unique `(commandType,idempotencyKey)`.
- 같은 key+같은 canonical request는 저장된 결과 또는 진행 중 operation을 반환한다.
- 같은 key+다른 request hash는 409를 반환한다.
- shipment/invoice/work-item/session/dispatch의 실제 상태와 복구 source는 각 domain operation/attempt row다. command request는 domain truth를 대체하지 않는다.
- 외부 provider 명령은 202와 operation ID를 반환할 수 있으며 재요청은 새 provider 호출을 만들지 않는다.
- 위험 명령은 `reason` 필수, `csCaseId/note` 선택이다. body의 `operatorId`는 DTO에서 제거하고 성공 응답은 변경된 resource와 operation/attempt ID를 함께 반환한다.

권한은 `fulfillment.warehouse.operate`, `fulfillment.shipment.consolidate`, `fulfillment.shipment.override_recipient`, `fulfillment.reservation.transfer`, `fulfillment.dispatch.force`, `fulfillment.dispatch.recall`, `fulfillment.shipment.reopen` 일곱 scope로 고정한다.

### Primary providers

스펙의 서비스 경계는 구현 클래스 이름에도 그대로 드러낸다.

- `ShipmentPlanningService`: 최초 Draft, split/consolidation orchestration, recipient, plan, outstanding cancel.
- `ShipmentReservationService`: partial reserve/release/transfer/recompute.
- `InvoiceOrchestrator`: shipment-owned issue/void/recovery saga.
- `OutboundBatchOrchestrator`: shipment work item, claim/handoff, batch lifecycle.
- `PickingStrategyRegistry`: discrete, aggregate-then-sort, pick-to-tote provider 선택.
- `ShipmentDispatchService`: inspection 완료부터 attempt/ledger/progress/outbox까지 원자적 정산.
- `ShipmentRecallService`: invoice void, rework reversal, reservation restore, FO reopen.

### Transaction/lock

- 기본 잠금 순서는 `FOI(id) → shipment(id) → shipment_line(id) → reservation(createdAt,id) → work item/session`이다. SO/FO 생성은 SO→FO를 먼저 잠그고 이 순서로 진입한다.
- 여러 shipment/line을 다루는 명령은 전달받은 순서가 아니라 정렬된 UUID 순서로 잠근다.
- 수량 변경 transaction 끝에서 FOI 보존식, active shipment line 합, reservation 합, manifest/reservation version을 다시 읽어 검증한다.
- provider network I/O는 DB transaction 안에서 실행하지 않는다. DB operation 생성/claim → provider call → 결과 확정의 saga로 나눈다.

### Quantity invariants

```text
FOI.qty
= FOI.shippedQty
 + FOI.canceledQty
 + SUM(active shipment_lines.qty)

shipment_line.qty >= inspectedQty >= 0
shipment_line outstanding >= confirmed reservation qty >= 0
physical Planned shipment line outstanding = confirmed reservation qty
active invoice.manifestVersion = shipment.manifestVersion

session handed-in
= session remaining + dispatch settled + returned + approved shortage/defect
```

정상 dispatch는 on-hand와 reserved를 동량 감소시켜 available을 유지한다. recall은 `OUTBOUND_REWORK` on-hand와 reservation을 동량 복원해 available을 유지한다.

### Migration/deploy discipline

- DB 변경은 `expand`와 `contract` 두 deploy로 분리한다.
- expand에서는 새 FK/column을 nullable/additive로 두고 구 enum/column을 유지한다. V2 write는 application guard로 새 필드를 필수화한다.
- cleanup/reconciliation 후 contract migration에서 `openedForFO`, FO batch link, FO invoice ownership, reservation `targetType/targetId` 등 V1 경로를 제거하거나 NOT NULL로 강화한다.
- generated SQL과 snapshot은 반드시 함께 commit하고, 자동 생성 SQL의 `TRUNCATE CASCADE`나 광범위 delete를 허용하지 않는다.

## 단계와 배포 게이트

| 구간 | Tasks | 배포/진입 조건 |
|---|---:|---|
| Phase 0 안전장치 | 1–4 | legacy 특성화 green, V1 외부 dispatch 제거, maintenance 전환 가능 |
| Phase 1 기반 | 5–8 | expand migration 적용, identity/scope/location/progress 기반 green |
| Phase 2 계획/예약 | 9–11 | Draft·partial reserve·split·consolidation 불변식 green |
| Phase 3 송장 | 12 | issue/void sandbox와 crash recovery green |
| Phase 4 batch/session | 13–14 | work item·custody 보존·movement guard green |
| Phase 5 전략 | 15–17 | 세 provider가 같은 strategy contract 통과 |
| Phase 6 dispatch/consumer | 18–19 | attempt/ledger/outbox와 단일 채널 consumer contract green |
| Phase 7 복구 | 20–21 | short pick·recall·재출고·반품 contract green |
| Phase 8 UI/cutover | 22–25 | 17개 시나리오, rehearsal, release gate, 관찰 기간 완료 |

---

## Phase 0 — 특성화와 안전장치

### Task 1: V1 특성화, workflow gate, 위험 UI/API 차단

**Files:**

- Create: `apps/core/src/modules/fulfillment/services/fulfillment-workflow-gate.service.ts`
- Create: `apps/core/src/modules/fulfillment/services/fulfillment-workflow-gate.service.spec.ts`
- Modify: `apps/core/src/config/env.validation.ts`
- Modify: `env-templates/.env.wms.example`
- Modify: `envs/.env.wms.example`
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-order-creation-backlog.worker.ts`
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-order-reservation-retry.worker.ts`
- Modify: `apps/core/src/modules/fulfillment/outbox/outbox-dispatcher.service.ts`
- Modify: `apps/core/src/modules/fulfillment/backlog/fulfillment-order-creation-backlog.service.ts`
- Modify: `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts`
- Modify: `apps/core/src/modules/sales-order/consumers/order-events.consumer.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/controllers/consolidation.controller.ts`
- Modify: `apps/core/src/modules/fulfillment/controllers/invoice.controller.ts`
- Modify: `apps/core/src/modules/fulfillment/controllers/shipment.controller.ts`
- Modify: `apps/admin-web/src/features/order/consolidation/template/index.tsx`
- Modify: `apps/admin-web/src/features/order/outbound-batches/`
- Test: existing fulfillment service/controller/admin tests plus new gate tests.

**Interfaces:**

- `FulfillmentWorkflowGate.assertMutationAllowed(kind)`
- `FulfillmentWorkflowGate.shouldEnqueueFo(eventOccurredAt,isNewSalesOrder)` / `shouldRunFoCreation()` / `shouldRunReservationRetry()`
- maintenance rejection: HTTP 503 with stable code `FULFILLMENT_MAINTENANCE`.

- [x] Add env validation and templates. In production, reject a missing/unknown mode and require a valid cutover timestamp in `v2`; make mode/watermark visible in startup logs and health details.
- [x] Add characterization tests for current FO creation, reservation retry, invoice void, force shipment, consolidation stub, FO completed/delivered semantics and drop-ship bypass before changing them.
- [x] Put the gate at backlog enqueue, service and worker boundaries, not only the controller, so event redelivery/cron/manual calls cannot bypass maintenance.
- [x] In `v2`, enqueue only when the SO was created by this event and domain time `payload.createdAt >= FULFILLMENT_V2_CUTOVER_AT`. Do not use the Kafka redelivery time as the cutoff. Existing SO redelivery may retry ownership grants but never creates a fulfillment backlog; a missing/unparseable domain time fails closed and emits an alert.
- [x] In maintenance, leave SO ingestion and general outbox dispatch alive while preventing backlog claims, retry candidates and all physical fulfillment writes.
- [x] Make the shared dispatcher skip/avoid leasing legacy and V2 fulfillment/shipment event rows in maintenance while continuing inventory/core-order topics. This preserves pending fulfillment rows for Task 4 cleanup without blocking unrelated outbox traffic.
- [x] Return 410 from the fake consolidation mutation until Task 11 replaces it. Remove `total_picking` from admin choices; keep the existing server rejection as defense in depth.
- [x] Add temporary admin/master protection to force dispatch, invoice void and consolidation mutation. Task 3 replaces this with scopes.
- [x] Verify: `npx jest --runInBand fulfillment-workflow-gate fulfillment-events.consumer fulfillment-order-reservation-retry`.
- [x] Build: `yarn build:core && yarn --cwd apps/admin-web type-check`.
- [x] Commit: `fix(fulfillment): gate legacy outbound mutations and workers`.

### Task 2: V2 event contracts 선배포

**Files:**

- Create: `packages/event-contracts/streams/shipments.stream.ts`
- Create: `packages/event-contracts/streams/fulfillments-v2.stream.ts`
- Create: `packages/event-contracts/streams/shipments.stream.spec.ts`
- Modify: `packages/event-contracts/streams/index.ts`

**Contracts:**

- `SHIPMENT_STREAM.topic.topic = 'shipments.events.v1'` with `ShipmentShipped`, `ShipmentDelivered`, `ShipmentDispatchRecalled`.
- `FULFILLMENT_V2_STREAM.topic.topic = 'fulfillments.events.v2'` with `FulfillmentProgressed`, `FulfillmentReopened`.
- `ShipmentShipped` contains shipment/attempt/invoice data and orders grouped by `salesChannel/channelOrderId`; each line carries `shipmentLineId`, FOI/SO line IDs, `channelOrderItemId`, SKU and qty.

- [x] Write schema/parse tests first: reject duplicate/missing line identity, invalid qty and payloads without attempt/invoice identity.
- [x] Keep recipient/address PII out of shipment events. Fix partition keys to `shipmentId` for shipment stream and `fulfillmentOrderId` for fulfillment-v2.
- [x] Preserve v1 contracts as full-completion compatibility projections; add a test that a partial shipment cannot construct `FulfillmentShipped v1`.
- [x] Publish the package contract for Task 3 without registering a Core producer. Core outbox/schema changes wait for the Phase 1 expand deploy.
- [x] Verify: `npx jest --runInBand packages/event-contracts` and type-check/build the packages that consume the contracts.
- [x] Commit: `feat(events): add shipment and fulfillment progress streams`.

### Task 3: channel-adapter 선배포, 단일 채널 라우팅, 외부 ID 강제

**Files:**

- Create: `apps/channel-adapter/src/consumers/shipment-events.consumer.ts`
- Create: `apps/channel-adapter/src/services/shipment-dispatch-inbox.worker.ts`
- Create: `apps/channel-adapter/src/services/channel-fulfillment-capabilities.ts`
- Create: `apps/channel-adapter/src/services/shipment-dispatch-inbox.worker.spec.ts`
- Modify: `apps/channel-adapter/src/consumers/fulfillment-events.consumer.ts`
- Modify: `apps/channel-adapter/src/consumers/fulfillment-events.consumer.spec.ts`
- Modify: `apps/channel-adapter/src/schema.ts`
- Modify: `apps/channel-adapter/src/adapter.module.ts`
- Modify: `apps/channel-adapter/src/main.ts`
- Modify: `apps/channel-adapter/src/types.ts`
- Modify: `apps/channel-adapter/src/adapters/naver/naver-smartstore.adapter.ts`
- Modify: `apps/channel-adapter/src/adapters/coupang/coupang.adapter.ts`
- Modify: `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts`
- Modify: `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts`
- Migration: generated by `yarn db:generate:channel-adapter`; commit the resulting SQL and meta snapshot.

**Data model:**

- Add `inbox_events.idempotency_key` and partial unique `(event_type,idempotency_key)`.
- Add `channel_dispatch_operations` keyed by `(dispatchAttemptId,salesOrderId,operation)` with channel, external order ID, request snapshot, status `pending|succeeded|failed|manual_adjustment_required`, attempts/error/result timestamps.

- [x] Change v1 fulfillment handlers so `FulfillmentShipped` only enqueues Medusa/full-order projection and never calls Naver/Coupang. Remove the two-channel broadcast for shipped/cancelled.
- [x] New Kafka handlers only validate and durably insert inbox rows; they do not call channel APIs before inbox commit.
- [x] Expand one shipment event to one operation per order. Use an exhaustive routing map (`naver→naver_smartstore`, `coupang→coupang`, Medusa projection-only, unsupported 3PL→manual) and pass `channelOrderId` plus line `channelOrderItemId`; never substitute Core UUIDs.
- [x] Encode capability decisions explicitly. Unsupported partial-qty dispatch/recall/cancel becomes `manual_adjustment_required` with operator-visible reason, not a false success.
- [x] Implement Coupang/Naver translation tests with captured provider requests. Remove placeholder/fallback product/order identifiers.
- [x] Store Medusa shipment/attempt history as arrays and derived partial progress; do not overwrite scalar metadata on every split shipment. Recall marks the referenced attempt without deleting history.
- [x] Subscribe channel-adapter to shipment and fulfillment-v2 streams before any Core V2 producer is enabled.
- [x] Generate/review migration: `yarn db:generate:channel-adapter`.
- [x] Verify duplicate delivery, worker crash after one order succeeds, mixed-channel shipment, missing external IDs and unsupported recall cases.
- [x] Run: `npx jest --runInBand apps/channel-adapter/src/consumers apps/channel-adapter/src/services/shipment-dispatch-inbox.worker.spec.ts apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts`.
- [x] Build: `yarn build:channel-adapter`.
- [x] Commit: `feat(channel-adapter): consume shipment attempts with single-channel routing`.

### Task 4: hard-cutover audit/cleanup/verify 도구

**Files:**

- Create: `scripts/fulfillment-v2/audit.ts`
- Create: `scripts/fulfillment-v2/cleanup.ts`
- Create: `scripts/fulfillment-v2/verify.ts`
- Create: `scripts/fulfillment-v2/cleanup.integration.spec.ts`
- Create: `docs/runbooks/outbound-v2-cutover.md`
- Modify: `package.json`

**Commands:**

- `yarn fulfillment:v2:audit --output "$AUDIT_PATH"`
- `yarn fulfillment:v2:cleanup --audit "$AUDIT_PATH" --snapshot-id "$SNAPSHOT_ID" --execute`
- `yarn fulfillment:v2:verify --audit "$AUDIT_PATH"`

- [x] Audit exact row counts/FK closure for backlog, FO-target reservations, tracking/lines/shipments, inspection issues, invoices, FO-batch links/batches, FOI/FO and pending legacy fulfillment outbox.
- [x] Enumerate affected `(warehouseId,skuId)` pairs and reservation quantities. Detect any shipment-linked SHIP journal/event and exit non-zero if at least one exists.
- [x] Write a signed/hashable JSON artifact with schema version, database identity, snapshot ID placeholder, counts and allowlist. Do not commit production artifacts.
- [x] Cleanup defaults to dry-run, requires the matching audit hash, explicit `--execute` and an advisory lock. Use ordered `DELETE` statements in one transaction; no table-wide stock reservation/outbox delete and no `TRUNCATE CASCADE`.
- [x] Keep sales orders/lines, master data, stock journals/events/ledgers, unrelated outbox/audit rows untouched. Add before/after checks that prove this.
- [x] Verify confirmed FO reservations are zero, affected stock reservation/ledger reconciliation has zero drift, legacy pending outbox cannot replay, and no backlog/order event with domain `payload.createdAt < cutoverAt` can recreate old FO.
- [x] Integration-test abort-on-SHIP, unrelated reservation/outbox preservation, rollback on mid-cleanup failure and idempotent verify.
- [x] Document maintenance entry/exit, platform snapshot evidence, consumer readiness, rollback boundary before first V2 row, and “V2 row exists → stop intake and repair in V2” rule.
- [x] Commit: `feat(fulfillment): add audited V2 cutover toolkit`.

---

## Phase 1 — additive domain foundation

### Task 5: Core expand schema와 domain type 정착

**Files:**

- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts`
- Modify: `apps/core/src/modules/fulfillment/outbox/outbox.service.ts`
- Modify: `apps/core/src/modules/inventory/shared/outbox/outbox.service.ts`
- Modify: `apps/core/src/modules/fulfillment/outbox/outbox-dispatcher.service.ts`
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts`
- Migration: generated by `yarn db:generate:core`; commit the resulting expand SQL and meta snapshot.
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.spec.ts` or add a focused schema integration spec.

**Existing-table changes:**

- `sales_order_lines`: nullable `channelOrderItemId/channelProductId` plus partial unique `(salesOrderId,channelOrderItemId)`.
- `fulfillment_order_items`: immutable original `qty`, `shippedQty`, new `canceledQty`; retain deprecated counters only until contract.
- `shipments`: additive V2 statuses, warehouse/profile/recipient snapshot, `manifestVersion/reservationVersion`, planned/shipped/delivered/superseded timestamps and recovery code.
- `shipment_lines`: reservation summary projection if retained, `lineVersion`, `createdFromLineId`; keep source FOI.
- `stock_reservations`: nullable during expand `shipmentLineId/requestedAt/stateReason/invalidatedAt`.
- `invoices`: shipment manifest/recipient hash, saga statuses and operation relationship; keep `issuedForFO` only for compatibility.
- `shipment_tracking`: nullable `dispatchAttemptId/providerEventId` and provider idempotency unique.
- `delivery_profiles`: sender/origin/return snapshot references, carrier account ref, supported modes and handling flags.
- `return_request_items`: nullable `shipmentLineId/dispatchAttemptId`.
- `outbox_events`: nullable `topic` plus nullable `idempotencyKey` and partial uniqueness for `(topic,eventType,idempotencyKey)`. V2 event writes always provide both.

**New tables:**

- `fulfillment_command_requests`
- `shipment_operations` / `shipment_operation_members`
- `invoice_operations`
- `outbound_batch_work_items`
- `picking_plans` / plan member version snapshots / `picking_source_allocations`
- `batch_inventory_sessions` / `batch_inventory_session_balances` / `batch_inventory_session_events`
- `totes` / `shipment_tote_assignments`
- `dispatch_attempts` / `dispatch_attempt_sources`

- [x] Add all enums, FK actions, checks and partial uniques. Use `NULLS NOT DISTINCT` or a reviewed `COALESCE` expression unique for session balance grain.
- [x] Make a shipment have at most one active invoice and one active work item. Make `(shipmentId,attemptNo)` and attempt idempotency unique.
- [x] Add operation `idempotencyKey/requestHash` and before/after manifest snapshots so split/consolidation lineage can be replayed without reconstructing mutable rows.
- [x] Keep new required V2 links nullable in expand so the migration applies before cleanup; mark every temporary nullable field in code with a contract-removal reference.
- [x] Update relations and `wmsTables/wmsSchema` exports without deleting V1 relations yet. Model SO→FO as one-to-one in the V2 read path.
- [x] Make both outbox services accept explicit topic+idempotency key and make dispatcher route non-null topics to the two new typed publishers. A duplicate event key returns the existing outbox row. Keep aggregate/event fallback only for legacy topicless rows during expand; unknown non-null topics fail closed and remain retryable.
- [x] Register the new Core publishers only in this post-expand deploy, with V2 event writes still disabled by workflow mode.
- [x] Generate via `yarn db:generate:core`, review SQL and snapshot, then rehearse against a DB containing current fulfillment fixtures.
- [x] Test all check/unique constraints using real PostgreSQL, including two active invoices, two active work items, duplicate session NULL buckets and duplicate attempt numbers.
- [x] Run: `yarn test:core:integration:local -- outbound-v2-schema` and `yarn build:core`.
- [x] Commit: `feat(db): expand outbound V2 shipment and picking schema`.

### Task 6: 외부 주문 line identity의 수집·보존

**Files:**

- Modify: `packages/event-contracts/streams/orders.stream.ts` and its contract tests.
- Modify: `apps/core/src/modules/sales-order/dto/create-sales-order.dto.ts`
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts`
- Modify/Test: `apps/core/src/modules/sales-order/services/sales-orders.service.spec.ts`
- Modify: `apps/channel-adapter/src/services/order-event.publisher.ts`
- Modify: `apps/channel-adapter/src/services/order-event.publisher.legacy.ts`
- Modify: `apps/channel-adapter/src/services/order-collection/medusa-order.provider.ts`
- Test: provider/publisher contract specs.

- [x] Widen the ingress contract so legacy/manual publishers may omit unavailable `orderItemId/channelProductId` instead of fabricating them. Carry present `OrderItem.orderItemId` to `sales_order_lines.channelOrderItemId` and `channelProductId` to its own field; do not derive both from one fallback value.
- [x] For trusted channel orders, reject duplicate item IDs inside an order and fail V2 Planned validation if a required external item ID is absent.
- [x] Legacy/manual orders may store null identity, but must never manufacture a provider identifier from `salesOrderLineId` or `channelOrderId`.
- [x] Add round-trip contract: provider payload → order event → Core SO line → `ShipmentShipped` line contains the same two external IDs.
- [x] Verify Medusa item ID, Naver product-order ID and Coupang order-item ID fixtures independently.
- [x] Run targeted publisher/provider/Core service tests and `yarn build:channel-adapter && yarn build:core`.
- [x] Commit: `feat(orders): preserve channel order item identity end to end`.

### Task 7: fulfillment scopes, role bootstrap, 필수 audit

**Files:**

- Create: `apps/core/src/platform/auth/fulfillment-scopes.ts`
- Modify: `apps/core/src/platform/auth/merged-scopes.ts`
- Modify: `apps/core/src/app.module.ts`
- Modify: `libs/authorization/src/services/scope-bootstrap.service.ts`
- Modify: `libs/authorization/src/services/authorization.service.ts`
- Modify: `libs/authorization/src/authorization.module.ts`
- Modify: `apps/core/src/modules/inventory/shared/services/audit.service.ts`
- Modify: `scripts/seeding/steps/user-service.seed-step.ts`
- Modify: `scripts/seeding/constants/uuids.ts`
- Modify: `scripts/seed-data/seeders/03-user-service.seeder.ts`
- Modify: `scripts/seed-data/constants/uuids.ts`
- Test: Core guard/bootstrap, authorization library, seed idempotency and strict audit specs.

- [x] Register the seven exact `fulfillment.*` scopes from the technical design.
- [x] Extend authorization bootstrap with ordered `roleMappings` so scopes are inserted before `logistics_worker/logistics_manager` mappings. Keep role assignment in user-service; Core stores only role-name→scope mapping.
- [x] Seed the two role definitions idempotently in both current reference seed paths. Do not assign them to users automatically.
- [x] Make unknown roles and missing mappings deny. Add tests that worker has only operate and manager has all seven scopes.
- [x] Add `AuditService.logRequired(...)` (or equivalent strict option) that propagates DB errors and accepts the caller transaction. Keep best-effort `log()` for unrelated legacy callers.
- [x] Apply `ScopeGuard`/`@RequireScopes` as each V2 controller is introduced. Remove the temporary admin guards only after equivalent scope tests are green.
- [x] Prove operator ID comes from JWT even if body contains a forged field; remove `operatorId/workerId` from risky command DTOs where identity is the authenticated actor.
- [x] Commit: `feat(auth): add fulfillment scopes and transactional audit`.

### Task 8: OUTBOUND_REWORK, progress calculator, invariant/reconciliation 기반

**Files:**

- Modify: `apps/core/src/modules/inventory/core/types/location.types.ts`
- Modify: `apps/core/src/modules/inventory/core/constants/warehouse.constants.ts`
- Modify: `apps/core/src/modules/inventory/core/services/location.service.ts`
- Test: `apps/core/src/modules/inventory/core/services/location.service.spec.ts`
- Create: `apps/core/src/modules/fulfillment/services/fulfillment-progress.service.ts`
- Create: `apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.ts`
- Create: `apps/core/src/modules/fulfillment/services/fulfillment-reconciliation.service.ts`
- Create: corresponding unit/integration specs.

- [x] Add system role `outbound_rework` and have warehouse bootstrap create exactly one active location per warehouse.
- [x] Reject rename, role change, deletion and deactivation of required system locations.
- [x] Implement pure FOI/FO progress projection for `created|partially_reserved|ready|processing|partially_shipped|completed|canceled|recovery_required`. Never derive delivered into FO status.
- [x] Implement transaction-time invariant checks over locked FOI/shipment/line/reservation/session rows.
- [x] Add scheduled/read-only reconciliation for FOI quantity, active lines, confirmed reservations, active invoice version, session conservation and dispatch source/event cardinality. Emit counts/IDs as metrics without auto-correcting.
- [x] Characterize recalled FO reopening and “shipped+canceled=qty means completed” in unit tests before any dispatch implementation.
- [x] Run targeted tests and `yarn test:core:integration:local -- fulfillment-invariant`.
- [x] Commit: `feat(fulfillment): add progress and outbound invariant foundation`.

---

## Phase 2 — shipment 계획과 부분예약

### Task 9: FO 생성 시 최초 Draft와 부분예약

**Files:**

- Create: `apps/core/src/modules/fulfillment/services/shipment-reservation.service.ts`
- Create: `apps/core/src/modules/fulfillment/services/shipment-reservation.service.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts`
- Modify: `apps/core/src/modules/inventory/shared/services/unified-reservation.service.ts`
- Modify: `apps/core/src/modules/inventory/shared/services/reservation-lifecycle.service.ts`
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-order-creation-backlog.worker.ts`
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-order-reservation-retry.worker.ts`
- Replace/update V1 reservation facade tests and logistics integration fixtures.

**Interfaces:**

- `reservePartial(shipmentLineId, requestedQty, tx)`
- `releasePartial(shipmentLineId, qty, reason, tx)`
- `transfer(sourceLineId,targetLineId,qty,tx)`
- `recompute(shipmentId,tx)`

- [x] In one transaction lock SO/FO, create FO/FOI, copy recipient snapshot to a Draft shipment, create all lines, compute profile compatibility and reserve `min(outstanding,reservable)`.
- [x] Reject physical FO without warehouse before opening the transaction. Preserve digital-only no-FO and drop-ship direct route.
- [x] Change reservation target to shipment line for V2 and set `requestedAt` for fairness. Do not dual-read FO-target reservations in V2.
- [x] Split reservation rows only when partial release/transfer needs it; preserve the original `requestedAt`, total confirmed quantity and deterministic oldest-first ordering.
- [x] Rewrite retry candidate selection around under-reserved active shipment lines, requested time and available stock. A retry may reserve a partial increment instead of all-or-zero.
- [x] Increment `reservationVersion` for every reservation-set mutation and recompute FO/shipment progress in the same transaction.
- [x] Test 10 requested/6 available, later +2 retry, concurrent retry, duplicate order event, missing warehouse, mixed profile Draft and drop-ship bypass.
- [x] Run: `yarn test:core:integration:local -- 'shipment-reservation|fulfillment-stock-allocation|sales-order-to-fulfillment'`.
- [x] Commit: `feat(fulfillment): create draft shipments with partial reservation`.

### Task 10: split, recipient revision, plan, outstanding cancellation

**Files:**

- Create: `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts`
- Create: `apps/core/src/modules/fulfillment/controllers/shipment-planning.controller.ts`
- Create: `apps/core/src/modules/fulfillment/dto/shipment-planning.dto.ts`
- Create: `apps/core/src/modules/fulfillment/services/shipment-planning.service.spec.ts`
- Create: `apps/core/src/modules/fulfillment/services/shipment-planning.integration.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts`
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` for outstanding cancellation orchestration.

**Commands:**

- `createInitialDraft`, `split`, `reviseRecipient`, `plan`, `cancelOutstanding`.

- [x] Introduce a common command wrapper that claims `fulfillment_command_requests`, validates request hash, resolves JWT actor and returns stored result on replay.
- [x] Implement Draft-only split with deterministic locks, unreserved-first movement, optional reservation row split/transfer, manifest+reservation version increments and operation member lineage.
- [x] Reject split/revision if custody exists; require explicit unpick before changing picked/session-owned quantity.
- [x] Recipient revision requires reason; differing from order snapshot also requires override scope. Active invoice blocks direct edit and points the caller to void/reopen.
- [x] Planned gate requires one compatible shipping profile, complete line reservations, trusted channel item IDs where needed, recipient completeness and no stale plan/invoice.
- [x] Cancellation changes only outstanding active lines, releases matching reservations, increments `canceledQty` and recomputes FO. Partial shipped + canceled remainder must end completed.
- [x] Draft cancellation applies immediately. Planned/invoice/work-item or consolidated targets enter a durable reopen/replan operation; no manifest quantity changes until invoice void and batch exclusion/unpick complete. Tasks 12–14 attach the saga steps to this operation.
- [x] Record strict audit and shipment operation in the same transaction for every risk command.
- [x] Add read DTOs: FO detail returns progress+shipment list; shipment detail returns FO/SO origin per line, reservation, invoice history, work item and attempts. Do not embed a single “current shipment” in V1 DTO.
- [x] Test idempotency mismatch, concurrent split/cancel, 10→6/4 quantity conservation, mixed-profile plan rejection and forged operator body.
- [x] Run unit/integration/authorization tests and `yarn build:core`.
- [x] Commit: `feat(fulfillment): add shipment planning commands`.

### Task 11: 보수적 후보 조회와 explicit consolidation

**Files:**

- Replace: `apps/core/src/modules/fulfillment/services/consolidation.service.ts`
- Modify: `apps/core/src/modules/fulfillment/controllers/consolidation.controller.ts`
- Create: `apps/core/src/modules/fulfillment/dto/consolidation.dto.ts`
- Create: `apps/core/src/modules/fulfillment/services/consolidation.service.spec.ts`
- Create: `apps/core/src/modules/fulfillment/services/consolidation.integration.spec.ts`

- [x] Delete all random/fake customer/address/weight generation and hardcoded reports. Candidate lookup is read-only and conservative.
- [x] Candidate query requires same warehouse, compatible profile, non-drop-ship, Draft-compatible status and recipient policy. Cross-channel is allowed only because dispatch remains grouped by each source order's sales channel.
- [x] Consolidation accepts whole source shipments only. Sort-lock every source and line, reject shipped/in-transit/delivered, and require completed unpick/batch exclusion/invoice void before activation.
- [x] Create a new Draft target, coalesce target lines by FOI when necessary, move reservations, supersede sources and store N→1 operation members plus before/after manifests.
- [x] Recipient override requires its scope/reason and persists the selected snapshot. Never silently choose the first source address.
- [x] If invoice void saga is pending/fails, return the durable operation and leave sources `recovery_required`; do not expose an active target.
- [x] Test two FO/one target, split lines merged back, source cancellation followed by replan, mixed channel, address mismatch, concurrent consolidation and replay.
- [x] Remove the Task 1 410 only when these tests and scope guards pass.
- [x] Commit: `feat(fulfillment): implement explicit shipment consolidation`.

---

## Phase 3 — invoice ownership 전환

### Task 12: shipment manifest 기반 invoice durable saga

**Files:**

- Create: `apps/core/src/modules/fulfillment/services/invoice-orchestrator.service.ts`
- Create: `apps/core/src/modules/fulfillment/services/invoice-recovery.worker.ts`
- Create: `apps/core/src/modules/fulfillment/controllers/shipment-invoice.controller.ts`
- Create: `apps/core/src/modules/fulfillment/dto/shipment-invoice.dto.ts`
- Modify: `apps/core/src/modules/fulfillment/services/invoice.service.ts` into provider-facing primitives or replace it.
- Modify: `apps/core/src/modules/fulfillment/services/delivery-provider.interface.ts`
- Modify: `apps/core/src/modules/fulfillment/services/hanjin-delivery.provider.ts`
- Modify: `apps/core/src/modules/fulfillment/services/goodsflow-delivery.provider.ts`
- Test: provider specs, orchestrator unit/integration/crash specs.

- [x] Build provider request only from a locked shipment manifest, recipient snapshot, delivery profile and external channel item identity. Store request hash, `manifestVersion` and `recipientHash`.
- [x] Issue flow: create/claim `invoice_operation(issue)` transactionally → call provider outside tx → create/update shipment-owned invoice and operation result transactionally.
- [x] Void flow follows the same pattern. A timeout/unknown response moves to retryable recovery; it never pretends the invoice is void.
- [x] On successful void, resume the waiting reopen/replan/consolidation/short-pick/recall operation by ID; never infer the next command from current mutable status alone.
- [x] Enforce one active invoice per shipment and reject dispatch when active invoice versions/hashes differ from shipment.
- [x] Recovery worker leases operations with `SKIP LOCKED`, bounded exponential retry and provider idempotency/query-before-repeat when supported.
- [x] Return 202+operation for pending work; same key returns the same operation. One invoice failure must not block other batch shipments.
- [x] Keep Goodsflow lookup/void compatibility only for existing labels until contract cleanup.
- [x] Test crash before/after provider call, provider success then DB failure, duplicate callback/retry, manifest changed during issue and void failure before consolidation.
- [x] Run provider sandbox issue/void rehearsal and record evidence in the cutover runbook.
- [x] Commit: `feat(fulfillment): move invoice lifecycle to shipment saga`.

---

## Phase 4 — shipment work item과 Batch Inventory Session

### Task 13: batch membership, claim, handoff, short-pick 상태 골격

**Files:**

- Create: `apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.ts`
- Create: `apps/core/src/modules/fulfillment/controllers/outbound-batch-v2.controller.ts`
- Create: `apps/core/src/modules/fulfillment/dto/outbound-batch-v2.dto.ts`
- Create: `apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.spec.ts`
- Create: `apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.integration.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/services/outbound-batch.service.ts` only for temporary read compatibility.
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-order-transaction.service.ts` to stop creating V2 FO-batch links.
- Modify: `apps/core/src/modules/fulfillment/controllers/outbound-batch.controller.ts`.

**State:**

- Work item: `queued|picking|ready_to_pack|packing|completed|short_pick_recovery|excluded`.
- Picker/packer claims have actor, lease/version, claimed/released timestamps; handoff is a durable operation, not a body-only worker change.

- [x] Create/add/remove batch commands around shipment work items. Planned, fully reserved, same-warehouse/profile/recipient/invoice-ready validation happens before a work item becomes active.
- [x] Derive batch totals/status from active work items; do not update `fulfillment_orders.batchId` or `fulfillment_order_batches` for V2.
- [x] Claim with compare-and-set lease version. Use JWT actor for self-claim; manager-authorized handoff may name the target worker but audit operator remains JWT actor.
- [x] Make add/remove/claim/handoff idempotent and return the work item plus command operation ID.
- [x] Exclusion is allowed only before dispatch and must preserve shipment reservation. If custody exists, exclusion delegates to Task 14 return/unpick.
- [x] After exclusion/unpick commits, resume any waiting reopen/replan or consolidation operation by its stored operation ID.
- [x] Add query APIs for eligible shipments, work items, claim state and recovery reason.
- [x] Test two-worker claim race, lease expiry, handoff replay, wrong warehouse, duplicate active work item and one failed shipment not closing the batch.
- [x] Commit: `feat(fulfillment): replace FO batch links with shipment work items`.

### Task 14: Batch Inventory Session, movement guard, crash recovery

**Files:**

- Create: `apps/core/src/modules/fulfillment/services/batch-inventory-session.service.ts`
- Create: `apps/core/src/modules/fulfillment/services/batch-session-recovery.service.ts`
- Create: `apps/core/src/modules/fulfillment/services/batch-inventory-session.integration.spec.ts`
- Create: `apps/core/src/modules/inventory/core/services/batch-controlled-stock.guard.ts`
- Modify: `apps/core/src/modules/inventory/core/services/inventory-command.service.ts`
- Modify: `apps/core/src/modules/inventory/core/services/transfer.service.ts`
- Modify: inventory move/transfer/adjust integration specs.

**Interfaces:**

- `startSession(batchId, planId)`, `moveCustody(...)`, `returnToSource(...)`, `settleForDispatch(...)`, `rebuildFromEvents(sessionId)`, `reconcile(sessionId)`.

- [x] At batch start lock each plan source bucket, revalidate stock/reservation/version and append handed-in session events/balances. Do not post stock ledger events.
- [x] Every custody mutation claims an idempotency key, locks/CAS-updates source and target balances, appends a session event and rechecks conservation.
- [x] Add custody-specific CHECKs: worker requires worker ref, tote requires tote ref, source/settled bucket requirements, nonnegative qty and valid shipment-line assignment.
- [x] Mark source SKU/location buckets batch-controlled while handed-in quantity remains. Apply the common guard to `moveInternal`, transfer execution, adjust-down and any general allocation path.
- [x] A different batch plan cannot allocate controlled stock. Reads expose controlled vs generally available quantities without changing the economic on-hand.
- [x] Recovery compares balance rows to the append-only session events and deterministically rebuilds or marks `recovery_required`; it never guesses a missing event.
- [x] Test crash between event/balance stages (same DB tx), repeated handoff, general move rejection, second-batch rejection, return-to-source and session total conservation.
- [x] Run: `yarn test:core:integration:local -- 'batch-inventory-session|move-internal|transfer'`.
- [x] Commit: `feat(inventory): add batch custody sessions and movement guards`.

---

## Phase 5 — 세 picking strategy

### Task 15: picking strategy contract와 discrete 구현

**Files:**

- Create: `apps/core/src/modules/fulfillment/picking/picking-strategy.interface.ts`
- Create: `apps/core/src/modules/fulfillment/picking/picking-strategy.registry.ts`
- Create: `apps/core/src/modules/fulfillment/picking/discrete-picking.strategy.ts`
- Create: `apps/core/src/modules/fulfillment/picking/picking-strategy.contract.spec.ts`
- Create: `apps/core/src/modules/fulfillment/picking/discrete-picking.strategy.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/services/picking-process.service.ts` into a temporary adapter or remove it at contract cleanup.

**Contract:**

- A strategy creates/revalidates plan+source allocation and translates scans into session custody events.
- It does not write stock ledger, consume reservation, issue invoice, settle FO progress or publish shipment events.

- [x] Define `plan(batch,shipments)`, `start`, `scan`, `handoff`, `completePick`, `unpickShipment` and strategy capability metadata.
- [x] Require explicit warehouse strategy configuration; reject missing/unknown strategy. Do not hide a default in the registry.
- [x] Snapshot every member shipment's manifest/reservation versions. Invalidate a plan on version/source stock change.
- [x] Implement discrete custody with worker buckets; do not create tote entities for informal personal baskets.
- [x] Make all scans idempotent and ensure over-pick, wrong SKU/source/worker and stale claim fail before balance mutation.
- [x] Establish a reusable strategy contract fixture that checks source allocation, custody conservation, unpick and common inspection-ready output.
- [x] Commit: `feat(fulfillment): add discrete picking strategy contract`.

### Task 16: aggregate-then-sort 전략

**Files:**

- Create: `apps/core/src/modules/fulfillment/picking/aggregate-then-sort.strategy.ts`
- Create: `apps/core/src/modules/fulfillment/picking/aggregate-then-sort.strategy.spec.ts`
- Extend: `apps/core/src/modules/fulfillment/picking/picking-strategy.contract.spec.ts`
- Modify: V2 picking DTO/controller files for bulk-cart and sort scans.

- [x] Aggregate source allocations into `BULK_CART` by SKU/source while retaining plan allocation lineage per shipment line.
- [x] Sort scans move exact quantities from bulk-cart to shipment-assigned sorting/packing custody; an unsorted remainder cannot become inspection-ready.
- [x] Handoff and crash recovery operate through session events only.
- [x] Test two shipments sharing SKU, partial sort, wrong destination, repeated scan, short source and one shipment isolation.
- [x] Run strategy contract for discrete and aggregate providers.
- [x] Commit: `feat(fulfillment): add aggregate then sort picking`.

### Task 17: pick-to-tote 전략과 공통 packing 진입

**Files:**

- Create: `apps/core/src/modules/fulfillment/picking/pick-to-tote.strategy.ts`
- Create: `apps/core/src/modules/fulfillment/picking/pick-to-tote.strategy.spec.ts`
- Create: `apps/core/src/modules/fulfillment/controllers/tote.controller.ts`
- Create: `apps/core/src/modules/fulfillment/dto/tote.dto.ts`
- Extend: strategy contract and module registration.

- [x] Register/scan physical tote barcodes and allow multiple totes per shipment while preventing one active tote assignment from belonging to conflicting work.
- [x] Move source→TOTE→PACKING custody with exact shipment-line attribution and version checks.
- [x] Make tote release contingent on empty/settled balances; do not delete assignment history.
- [x] Normalize all three strategies to the same `ready_to_pack`/packing custody output consumed by inspection.
- [x] Run the full strategy contract against discrete, aggregate-then-sort and pick-to-tote.
- [x] Test one shipment/multiple totes, tote reuse race, cross-shipment scan and handoff.
- [x] Commit: `feat(fulfillment): add pick to tote strategy`.

---

## Phase 6 — dispatch와 event 전환

### Task 18: inspection과 shipment dispatch atomic transaction

**Files:**

- Create: `apps/core/src/modules/fulfillment/services/shipment-dispatch.service.ts`
- Replace/modify: `apps/core/src/modules/fulfillment/services/shipment.service.ts`
- Replace/modify: `apps/core/src/modules/fulfillment/services/outbound-consumption.service.ts`
- Modify: `apps/core/src/modules/fulfillment/controllers/shipment.controller.ts`
- Create: `apps/core/src/modules/fulfillment/dto/shipment-dispatch.dto.ts`
- Create: `apps/core/src/modules/fulfillment/services/shipment-dispatch.service.spec.ts`
- Create: `apps/core/src/modules/fulfillment/services/shipment-dispatch.integration.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/events.ts` and outbox tests.

**Dispatch transaction:**

1. claim command and lock shipment/lines/session/invoice;
2. verify inspected==qty and current invoice manifest/recipient;
3. create/reuse dispatch attempt and exact source rows from session allocations;
4. append one SHIP stock event per source with `sourceType='SHIPMENT_DISPATCH_ATTEMPT'`;
5. consume matching shipment-line reservations and settle session buckets;
6. update FOI shipped qty and FO/shipment progress;
7. enqueue shipment-v1, fulfillment-v2 and eligible full-completion v1 projections.

- [x] Inspection scans update line progress and session custody. The last valid scan calls dispatch in the same command flow; batch close is not a dispatch trigger.
- [x] Force dispatch requires scope+reason, records forced quantities explicitly and follows the same attempt/ledger/reservation path.
- [x] Dispatch uses `picking_source_allocations/dispatch_attempt_sources`, never a new FIFO lookup.
- [x] Put `(attemptId,shipmentLineId,sourceLocationId)` event uniqueness and request idempotency behind DB constraints. A crash/retry cannot double SHIP.
- [x] Ensure each SHIP decreases on-hand/reserved equally and keeps available unchanged; already-settled session qty is never deducted at batch close.
- [x] Emit `ShipmentShipped` for every attempt, `FulfillmentProgressed` for affected FO and v1 `FulfillmentShipped` only when every FOI is fully shipped (`canceledQty=0`) and completion has not already been projected.
- [x] Use stable outbox keys: attempt ID for shipment shipped, `attemptId+foId` for progress, and `foId+fully-shipped` for the once-only v1 projection. Recall/delivery use their attempt/operation plus affected FO so transaction retries cannot create a second logical event.
- [x] Keep `FulfillmentsService.ship()` only for explicit direct-ship dispatch. Remove in-house V1 external-dispatch emission.
- [x] Test last-scan dispatch, concurrent last scans, forced dispatch authorization, stale invoice, two shipments completed at different times and outbox duplicate retry.
- [x] Run: `yarn test:core:integration:local -- 'shipment-dispatch|golden-path|outbound-batch-pick-ship'`.
- [x] Commit: `feat(fulfillment): dispatch shipment attempts from session allocations`.

### Task 19: delivery projection, Core tracking, channel consumer end-to-end

**Files:**

- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts` delivery handling.
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts`
- Modify: `apps/core/src/modules/sales-order/dto/store-order-tracking.dto.ts`
- Create/update: tracking query integration specs.
- Extend: Task 3 channel consumer/worker and Medusa projection tests.

- [x] Update provider tracking by `dispatchAttemptId/providerEventId` idempotently and move only the referenced shipment through in-transit/delivered.
- [x] Emit `ShipmentDelivered` per attempt/shipment. Emit v1 `FulfillmentDelivered` only after an eligible full-shipped v1 projection exists and all its non-recalled shipped quantity is delivered; do not mark FO delivered/completed from carrier state.
- [x] Build customer tracking via `SO → FOI → shipment_line → shipment → dispatch_attempt/invoice/tracking`. A consolidated shipment appears on each related SO with only that SO's lines.
- [x] Return attempt history including recalled state; do not erase an old tracking number on redispatch.
- [x] Exercise Core outbox→Kafka contract→channel inbox→one adapter command end to end. Assert that mixed Naver/Coupang orders call their own adapter once each and never broadcast.
- [x] Add observability for pending/recovery/manual channel operations keyed by attempt and sales order.
- [x] Commit: `feat(orders): project shipment attempts into tracking and channels`.

---

## Phase 7 — short pick, recall, 재출고

### Task 20: short-pick isolation과 정상 예약 유지

**Files:**

- Create: `apps/core/src/modules/fulfillment/services/shipment-short-pick.service.ts`
- Create: `apps/core/src/modules/fulfillment/services/shipment-short-pick.service.spec.ts`
- Create: `apps/core/src/modules/fulfillment/services/shipment-short-pick.integration.spec.ts`
- Modify: batch work-item/session/picking orchestrators.

- [x] Short-pick command locks only the affected work item/shipment lines and moves the work item to `short_pick_recovery`.
- [x] Return/adjust missing custody through explicit session events. Preserve good confirmed reservations; invalidate/retry only the short quantity.
- [x] Void the affected shipment invoice through the durable saga. Other ready shipments in the batch continue to inspection/dispatch.
- [x] When physical session balances are reconciled, return the affected shipment to Draft, increment versions, rebuild outstanding reservation demand and requeue fairly.
- [x] Require approved shortage/defect reason for any session conservation adjustment and strict audit it.
- [x] Test one short shipment plus one successful shipment, good-reservation preservation, invoice void failure, duplicate short report and session recovery.
- [x] Commit: `feat(fulfillment): isolate short picks without releasing good stock`.

### Task 21: recall, 역분개, reopen, 재출고와 반품 eligibility

**Files:**

- Add: `StockEventStore.reverseShipmentDispatchEvent(...)` in `apps/core/src/modules/inventory/core/repositories/stock-event.store.ts`
- Modify: `apps/core/src/modules/inventory/core/services/inventory-command.service.ts`
- Create: `apps/core/src/modules/fulfillment/services/shipment-recall.service.ts`
- Create: `apps/core/src/modules/fulfillment/controllers/shipment-recall.controller.ts`
- Create: `apps/core/src/modules/fulfillment/dto/shipment-recall.dto.ts`
- Create: recall unit/integration/concurrency specs.
- Modify: `apps/core/src/modules/sales-order/services/store-return-exchange.service.ts`
- Modify: `apps/core/src/modules/sales-order/dto/store-return-request.dto.ts`
- Modify: return request tests.

- [x] Add an inventory primitive that reverses each attempt SHIP source directly from null/economic-outside into the warehouse's `OUTBOUND_REWORK` location, links original/reversal events and rejects a second reversal.
- [x] Recall requires the exact attempt, `physicalRecoveryConfirmed=true`, scope, reason and an attempt that is shipped but not carrier-accepted/in-transit/delivered.
- [x] Saga order: durable recall op → invoice void → one DB transaction for reversal ledger, restored shipment-line reservation, cleared inspection/session state, Draft/version update, FOI shipped decrement/FO reopen, outbox and strict audit.
- [x] A void/reversal failure leaves `recovery_required` and is retryable from the same operation; never reopen FO before economic stock restoration succeeds.
- [x] Redispatch reuses the shipment but creates a new invoice and monotonically increasing attempt number. Old attempt/source/tracking remains immutable history.
- [x] Emit `ShipmentDispatchRecalled` and `FulfillmentReopened`; channel consumer maps unsupported external reversal to `manual_adjustment_required`.
- [x] Require new return requests to identify `shipmentLineId+dispatchAttemptId` and validate ownership, delivered non-recalled attempt and cumulative eligible qty. Keep old nullable rows readable.
- [x] When an approved customer return becomes a warehouse receipt, carry the line/attempt identity into receipt metadata; do not infer V2 eligibility from legacy `returns.shipmentId`.
- [x] Test recall available invariant, double/concurrent recall, provider void timeout, redispatch attempt 2, delivered/accepted recall rejection and recalled-attempt return rejection.
- [x] Run: `yarn test:core:integration:local -- 'shipment-recall|return-exchange|inventory-idempotency'`.
- [x] Commit: `feat(fulfillment): add dispatch recall and attempt-based returns`.

---

## Phase 8 — UI, release scenarios, cutover, contract cleanup

### Task 22: V2 read API와 Admin 작업 화면

**Files:**

- Modify: `apps/admin-web/src/lib/types/dto/fulfillment.ts`
- Modify: `apps/admin-web/src/lib/api/domains/orders/fulfillment-order.client.ts`
- Modify: `apps/admin-web/src/lib/api/domains/orders/outbound-batches.client.ts`
- Modify: `apps/admin-web/src/lib/api/domains/orders/picking.client.ts`
- Modify: `apps/admin-web/src/lib/api/domains/orders/invoices.client.ts`
- Modify: `apps/admin-web/src/lib/api/domains/orders/consolidation.client.ts`
- Modify: `apps/admin-web/src/lib/api/domains/orders/inspection.client.ts`
- Modify: corresponding query keys/queries/mutations.
- Modify: `apps/admin-web/src/features/order/fulfillments/`
- Modify: `apps/admin-web/src/features/order/outbound-batches/`
- Modify: `apps/admin-web/src/features/order/picking-list/`
- Modify: `apps/admin-web/src/features/order/consolidation/`
- Modify: `apps/admin-web/src/features/order/inspection/`
- Modify: `apps/admin-web/src/features/cs/return-exchange/`

- [x] Replace FO-centric single-shipment assumptions with shipment list/detail, per-line reservation/progress and attempt/invoice history.
- [x] Add planner actions for split, consolidation, recipient override, plan, outstanding cancellation and reservation transfer with reason/case fields and generated idempotency key.
- [x] Surface operation `pending/recovery_required` and allow safe retry using the original key; do not optimistically display provider success.
- [x] Add batch strategy selection from explicit warehouse capabilities, shipment work item queue, picker/packer claim/handoff, tote scan and short-pick recovery.
- [x] Inspection shows session source/custody and makes force dispatch available only to scope-capable users.
- [x] Add recall confirmation requiring physical recovery, attempt selection and reason. Surface channel `manual_adjustment_required`.
- [x] Update return selection to delivered shipment lines/attempts and display remaining eligible qty.
- [x] Add component tests for permission hiding plus server-deny handling; UI hiding is not the authorization boundary.
- [x] Run: `yarn --cwd apps/admin-web lint && yarn --cwd apps/admin-web type-check && yarn --cwd apps/admin-web build`.
- [x] Commit: `feat(admin): add shipment planning and V2 picking operations`.

### Task 23: 17개 대표 시나리오와 비기능 release suite

**Files:**

- Extend: `apps/core/src/modules/fulfillment/services/__support__/` for V2 wiring/fixtures/assertions.
- Create: `apps/core/src/modules/fulfillment/services/outbound-v2-scenarios.integration.spec.ts`
- Create: `apps/core/src/modules/fulfillment/services/outbound-v2-concurrency.integration.spec.ts`
- Create: `apps/core/src/modules/fulfillment/services/outbound-v2-authorization.spec.ts`
- Create: `apps/channel-adapter/src/consumers/shipment-events.contract.spec.ts`
- Modify: `docs/local-dev.md`.

- [x] Implement these numbered, independently named cases:
  1. A reserved/B backordered split and A-first dispatch.
  2. FOI 10 split 6/4 with two invoices/attempts.
  3. Two FO shipments consolidate with new recipient, lineage and void.
  4. One consolidated source SO cancellation triggers void/replan/reissue.
  5. Cross-channel same warehouse/profile consolidation with per-channel routing.
  6. One invoice issue failure does not block another batch shipment.
  7. Discrete multi-worker claim/handoff.
  8. Aggregate collect/sort/source-bucket conservation.
  9. Pick-to-tote with multiple totes for one shipment.
  10. Short pick isolates one shipment and preserves good reservations.
  11. Last inspection auto-dispatches and immediately posts ledger.
  12. Staggered dispatch occurs once each; batch close does not double-consume.
  13. Recall reverses to rework, restores reservation and reopens FO.
  14. Recalled shipment redispatches with new invoice/attempt.
  15. Partial shipped + canceled remainder completes FO.
  16. Batch-controlled source rejects general move/transfer.
  17. Session crash recovery conserves quantity and dispatch remains idempotent.
- [x] At every scenario checkpoint assert FOI demand conservation, active line/reservation sum, on-hand/reserved/available, session conservation, attempt source/event cardinality and outbox count.
      - 두 결함을 닫았다. (1) `available` 이 `logistics-fixtures.ts` 에서 `onHandQty - reservedQty` 로 **TS 재계산**돼 같은 객체의 이미 단언된 두 값의 항등식이었다 — 정보량 0. 이제 `availableFromView` 로 DB 의 `stock_summary_view.available_qty` 를 읽는다. 뷰는 `on_hand − reserved − transit_out` 이라 TS 산술이 구조적으로 볼 수 없는 항을 포함한다. 실측: pending transfer(3) 상황에서 옛 산술은 `10`, 뷰는 `7` — 옛 단언은 틀린 available 을 초록으로 통과시켰다. `ProductSellableQuantityService` 대조는 채택하지 않았다 (variant 키 기반 cross-BC seam 이고, 이 불변식은 창고 단위다). (2) 시나리오 12 에 batch close(`getBatch`) 이후 checkpoint 를 추가했다. `getBatch` 가 원장을 건드리도록 사보타주하면 `onHandQty 0→1` 로 red 가 되는 것을 확인했고, 나머지 4 시나리오는 그대로 초록이라 blast radius 도 맞다.
- [x] Add concurrency barriers for reserve/split/claim/last-scan dispatch/recall rather than relying on timing sleeps.
- [x] Add authorization matrix for worker, manager, unknown role, missing scope and forged body operator.
      - 파이프 설정을 `apps/core/src/platform/http/validation-pipe.ts` (`GLOBAL_VALIDATION_PIPE_OPTIONS` / `createGlobalValidationPipe`) 로 하이스팅해 `main.ts` 와 스펙이 같은 객체를 쓴다. 옵션 값은 불변. 로컬 복사본은 충실하지도 않았다 — `forbidNonWhitelisted`/`disableErrorMessages`/`validationError` 를 누락해 스펙이 배포보다 좁은 설정을 검증하고 있었다. `whitelist: false` 로 회귀시키면 위조된 `performedBy` 가 DTO 까지 살아남아 red 가 되는 것을 확인했다(다른 17건은 초록 유지). 후속: `shipment-planning.service.spec.ts:97`, `shipment.controller.spec.ts:187`, `tote.controller.spec.ts:174`, `consolidation.service.spec.ts:209` 가 같은 하드코딩 복사본을 들고 있다 — 이제 import 한 줄로 고칠 수 있다.
- [x] Add migration rehearsal fixture: current schema data → expand → audit/cleanup → V2 create → verify; confirm SKU/SO/ledger hashes are unchanged and old orders are not replayed.
      - `protectedHashes` 를 테이블 단위 `md5(string_agg(md5(row) ORDER BY ...))` 로 바꾸고 `sales_order_lines` 를 추가했다 (cleanup 안전 경계가 "sales orders/lines" 보존을 약속하므로). 컬럼 제외는 expand 의 additive 기본값(`stock_ledgers.version`, `sales_order_lines.channel_*_id`) 뿐 — jsonb 에서 없는 키를 빼는 건 no-op 이라 expand 양쪽에서 같은 쿼리가 유효하다. **테이블 단위 해시만으로는 부족**해서 bystander 행(cleanup 그래프와 무관한 SKU/SO/line/ledger)을 픽스처에 심었다 — 픽스처가 각 보호 테이블에 1행씩만 갖고 있어서 table-wide 와 by-ID 의 검출력이 같았기 때문이다. 두 반쪽이 함께여야 성립한다. 검증: cleanup 이 bystander SKU 를 변조하도록 사보타주하니 `sku` digest 가 움직여 red. 발견: toolkit 자체가 이미 10개 보호 테이블을 트랜잭션 안에서 fingerprint 하므로(`toolkit.ts:41`), 스펙의 해시는 **toolkit 의 자기검사를 신뢰하지 않는 독립 검증**이 그 역할이다 — 그래서 red 증명도 toolkit self-check 를 실명시킨 상태에서 했다. V2 create 이후 비교는 픽스처가 보호 테이블에 정당하게 행을 추가하므로 그 직후 재기준선(`hashesAfterV2Seed`)과 비교한다.
- [x] Add channel contract assertions that partial shipment is not full order shipped and exactly one adapter handles each sales order.
      - 이름이 증명 범위를 넘어서던 것을 없앴다. "partial ≠ full order shipped" 는 소유 스펙 참조로 정리 — 실제 가드가 Core `shipment-dispatch.service.ts:1154` 의 fullyShipped 게이트이고 `outbound-v2-scenarios` 의 시나리오 02 가 집합 동등성으로 증명하므로, 이 파일은 그 사실을 file:line 과 함께 명시하고 자기 이름을 실제 동작(inbox pass-through)으로 좁혔다. 동시에 단언 자체도 강화 — 옛 단언은 `isPartial: true` 한쪽만 보는 `arrayContaining` 이라 consumer 가 값을 하드코딩해도 통과했고, 이제 두 주문의 true/false 를 모두 고정한다(하드코딩 사보타주로 red 확인). "exactly one adapter" 는 routing 절반이 이미 정직했다 — `getAdapter` 호출을 exact-array 로 고정해 broadcast 를 실제로 배제한다. 지속성 절반(중복 방지)만 `uq_channel_dispatch_attempt_order_operation` 소유 스펙 참조로 넘기고, `onConflictDoNothing` 호출을 단언해 그 위임이 공허하지 않게 했다(제거 시 red 확인).
- [x] Run full suite serially: `yarn test:core:integration:local -- outbound-v2` plus targeted channel-adapter tests.
      - 로컬 실행 결과: DB 스위트 8 suites / 56 tests, 채널·권한 포함 관련 유닛 25 tests, 모두 통과. `build:core` / `build:channel-adapter` exit 0. 러너 명령은 npm 기준(`npm run ...`)이다 — 아래 verification command set 의 yarn 표기는 이 repo 와 맞지 않는다.
- [x] Record local execution instructions and Docker requirement in `docs/local-dev.md`.
- [x] Commit: `test(fulfillment): cover outbound V2 release scenarios`.

### Task 24: cutover rehearsal와 V2 producer activation

**Files:**

- Modify: `docs/runbooks/outbound-v2-cutover.md` with the rehearsal evidence fields and actual results.
- Modify: deployment env/manifests in scope if present.
- No schema contract deletion in this task.

- [ ] Deploy Task 2 contracts and Task 3 channel consumer; prove subscription, inbox uniqueness and v1 external-dispatch removal in the target environment.
- [ ] Apply Core/channel expand migrations and deploy additive V2 code with workflow mode still `legacy` or the approved pre-window mode.
- [ ] Switch Core to `maintenance`. Verify FO creation backlog/retry and every fulfillment mutation/worker report stopped while SO intake continues.
- [ ] Confirm all 17 scenarios green in the release artifact and provider issue/void sandbox recovery drill complete.
- [ ] Create platform DB snapshot and run read-only audit. Attach snapshot ID and audit artifact outside the repository.
- [ ] Stop if any historical SHIP journal/event exists. Otherwise execute allowlisted cleanup and verify preserved table hashes, zero FO confirmed reservations, zero drift and no pending legacy outbox/backlog replay.
- [ ] Verify user-service roles exist, intended users are assigned by an authorized administrator, Core mappings exist and deny tests pass.
- [ ] Set an immutable `FULFILLMENT_V2_CUTOVER_AT` after cleanup, deploy/enable `v2` and create one controlled order whose event time is later than the watermark. Also replay an older event and prove it cannot enqueue FO. Verify SO identities, Draft lines, partial reservation, outbox topic and channel consumer observability before opening intake.
- [ ] Define rollback checkpoint: before first V2 row restore snapshot/previous release is allowed; after it, do not boot V1—switch to maintenance and recover with V2.
- [ ] Observe error/recovery queues, reconciliation metrics, outbox lag and channel manual operations through the agreed window.
- [ ] Commit only runbook/config changes, never environment audit artifacts or secrets.

### Task 25: 관찰 기간 뒤 contract migration과 V1 코드 제거

**Files:**

- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts`
- Migration: generated by `yarn db:generate:core` after the contract schema edit; commit the resulting SQL and meta snapshot.
- Delete/replace V1-only fulfillment services/controllers/tests after usage scan.
- Modify: Core/channel event registration and admin clients.
- Update: `docs/runbooks/outbound-v2-cutover.md` and relevant API docs.

#### 제거 범위 실측 (2026-07-16)

아래 체크리스트가 적어둔 제거 목록은 **실제 사장 범위를 과소평가한다**. 코드에서 실측한 결과를 먼저 싣는다. 착수 시 이 표부터 재실측할 것 — 아래는 `5d6ebee94` 시점 기준이다.

**enum 값이 컬럼보다 크다.** `fulfillment_status` 는 20개 값인데 V2 progress calculator(`fulfillment-progress.service.ts`)가 내는 것은 **8개**뿐이다: `created, partially_reserved, ready, processing, partially_shipped, completed, canceled, recovery_required`.

죽는 값 **12개**: `reserving, unfulfillable, labeled, shipped, pending, allocated, picking, picked, inspecting, inspected, invoiced, forwarded`. 아래 체크리스트는 `picked/invoiced/shipped` **3개만** 지목한다.

writer 전수 (전부 V1 서비스):

| 값 | writer |
|---|---|
| `invoiced`, `picked` | `invoice.service.ts:191,433` |
| `picking`, `picked` | `picking-process.service.ts:588,746` |
| `allocated`, `ready`, `picking`, `picked` | `outbound-batch.service.ts:195,268,332,387,441,468` |
| `shipped` | `outbound-consumption.service.ts:145` |
| `unfulfillable` | `fulfillments.service.ts:690` |
| `allocated` | `fulfillment-order-transaction.service.ts:118` |

V2 는 `shipment-reservation.service.ts:1123` 에서 `projected.status` 하나로만 쓴다.

주의할 값 둘:

- **`forwarded` 는 안전하다.** `direct-ship.service.ts:302` 가 쓰는 것은 `fulfillmentOrders.status` 가 아니라 **`directShipStatus`** 컬럼(별도 `directShipStatusEnum`)이다. drop-ship 경로는 유지되지만 `fulfillment_status` 를 건드리지 않으므로 이 값은 죽는다.
- **`reserving`/`unfulfillable`/`labeled` 는 writer 는 없는데 reader 가 남아 있다.** `store-sales-orders.service.ts:43`(`FO_PACKED_STATUSES`), 같은 파일 `:1000`, `sales-orders.service.ts:140`(`CANCELLABLE_FULFILLMENT_STATUSES`) 가 이 값으로 SO 상태를 분류한다. 값 제거 전에 이 read-side 부터 정리해야 한다.

**`shipment_status`**: `'open'` 이 죽는다. 단 enum 주석(`inventory.schema.ts:62`)이 `in_transit`/`failed` 를 "DEAD 값(producer 0)" 으로 적어둔 것은 **낡았다 — Task 19 delivery projection 이 `in_transit` 을 되살렸다.** 이 주석이 가리키는 물류 하드닝 백로그(dev DB 복구 대기)와 대상 목록이 겹치므로, 두 작업을 합치되 목록은 다시 짤 것.

**통째로 죽은 테이블**: `fulfillment_order_batches`. 비-spec 사용처 **0건** — `inventory.schema.ts` 의 정의/relations/`InferSelectModel` 타입에만 존재한다. 아래 체크리스트에 언급이 없다. 반면 `outbound_batches` 는 V2 orchestrator 가 계속 쓰므로 **살아남는다** (죽는 것은 batch 가 아니라 FO↔batch 링크).

**`invoice_method`**: 위 Goodsflow→한진 결정에 따라 `'goodsflow'` 도 제거 후보. `'direct'`/`'self'` 는 V1 `invoice.service` 전용이라 같이 죽을 것으로 보이나, V2 에 자체발행 유스케이스가 있는지 스펙에 없다 — **결정 필요**.

**실행 난이도가 컬럼과 다르다.** PostgreSQL 에는 `ALTER TYPE ... DROP VALUE` 가 없다. 컬럼은 `DROP COLUMN` 한 줄이지만 enum 값 제거는 새 타입 생성 → `USING` 캐스트로 컬럼 전환 → 옛 타입 drop → rename 의 4단계이고 drizzle-kit 이 이를 깔끔히 뽑아주지 못한다. 생성 SQL 을 반드시 손으로 검토할 것.

#### live DB 실측 (2026-07-16)

**접속**: DB 는 VPC private subnet 이라(`sst.aws.Postgres('Db', { vpc })`, `PubliclyAccessible: False`) 터널 없이는 못 붙는다. `deployments/lcnine/services` 에서 `npx sst tunnel --stage live` 를 띄운 뒤 RDS 엔드포인트로 직접 붙는다(localhost 아님). 자격증명은 Secrets Manager `lcnine-services-live-DbProxySecret-*`. **RDS 는 live 하나뿐 — dev 인스턴스는 없다** (`db:setup --stage dev` 가 가리키는 건 로컬 docker PG). 즉 이 판단에 필요한 DB 는 live 하나다.

**출고가 한 번도 일어난 적이 없다는 것이 데이터로 확인됐다.** 전제가 아니라 사실이다.

| 대상 | 행 수 |
|---|---:|
| SHIP 재고이벤트 | **0** |
| `dispatch_attempts` | **0** |
| `invoices` | **0** |
| `shipments` | **0** |
| `stock_reservations` | **0** |
| `fulfillment_order_batches` | **0** |
| `batch_id` 가 있는 FO | **0** |

`fulfillment_order_batches` 드롭과 `invoices`/`shipments`/`stock_reservations`/`shipment_tracking` 의 NOT NULL 강화는 **행이 없어 공짜**다. Goodsflow(`issue_method`)·`shipment_status='open'` 을 쓰는 행도 0 이라 그 enum 값 제거도 막히지 않는다.

**막는 것은 둘뿐이다.**

- **`fulfillment_orders` 137 행, 그중 135 행이 사장 12 값**. FO 만 만들어지고 그 뒤로 아무 일도 없었다. cleanup allowlist 가 `fulfillment_orders` 를 포함하므로 cleanup 이 해소한다 → 그러면 FO status enum 수술도 공짜가 된다.
- **`outbox_events.topic IS NULL` 4,767 행** — 이쪽이 진짜 문제다(아래).

#### outbox 4,767 행 — 진짜 블로커와 정정된 순서

전량이 **published** 이고, **명시적 topic 을 가진 행은 하나도 없다**(합계가 정확히 4,767). V2 이벤트가 한 번도 쓰인 적 없다는 뜻이며 shipments/invoices 0 과 일관된다.

| aggregate_type / event_type | 행 수 | 폴백 라우팅 | 기간 |
|---|---:|---|---|
| `ProductSellableQuantity` / `ProductSellableQuantityChanged` | 3,380 | `inventory.events.v1` | 06-16 ~ **07-15** |
| `order` / `ORDER_CREATED` | 1,293 | `fulfillment.events.v1` | 05-31 ~ **07-15** |
| `Order` / `SalesOrderCancelled` | 92 | `core.orders.events.v1` | 06-02 ~ 07-14 |
| `order` / `ORDER_CANCELLED` | 2 | (발행 안 함/스킵) | 06-01 |

두 가지 사실이 따라온다.

- **topicless 폴백 라우팅은 이미 도달 불가능한 코드다.** dispatcher 는 `pending` 만 leasing 하는데 topicless 가 전부 published 다. 즉 폴백 제거는 어느 경로를 택하든 지금 안전하다.
- **published outbox 를 정리하는 로직이 레포에 없다** — 무한 누적 중이다.

**결정 (2026-07-16): published 전량 삭제.** outbox 는 전달 큐지 기록부가 아니고(감사 추적은 `audit_logs`), 정리 로직이 없어 어차피 누적만 된다.

**⚠️ 이 삭제는 단독으로 성립하지 않는다.** topicless 행이 **지금도 쓰이고 있다**(최신 07-15). `product-sellable-quantity.service.ts:322` 등이 `topic` 없이 `enqueue` 를 부른다 — topicless 호출부는 **4 파일 12 곳**: `inventory-command.service.ts`(3), `product-sellable-quantity.service.ts`(1), `fulfillments.service.ts`(3), `sales-orders.service.ts`(5). 오늘 지워도 내일 다시 쌓여(~110/일) NOT NULL 이 그때 깨진다. **타입 강제가 삭제의 선행 조건이다** — 두 outbox 서비스의 topicless union 갈래(`{ topic?: undefined }`)를 지워 컴파일러가 재발을 막아야 한다.

**정정된 3 단계 순서:**

1. **PR A** — V1 코드 제거 **+ 12 곳이 topic 을 넘기도록 수정 + topicless union 갈래 제거** → **배포**
2. **운영자** — `DELETE FROM outbox_events WHERE status='published'` + FO cleanup (이 시점엔 새 topicless 가 안 생긴다)
3. **PR B** — NOT NULL + 컬럼/테이블/enum 드롭 → **migrate**

2 번을 마이그레이션에 넣을 수 없다 — CLAUDE.md 가 "자동 생성 SQL 의 `TRUNCATE CASCADE` 나 광범위 delete 를 허용하지 않는다" 고 못박는다. 운영자 단계로 분리한다.

**A1(모드 제거)과 A2(V1 코드 삭제)는 분리할 수 없다.** V1 을 도달 불가능하게 만드는 순간 V1 스펙은 통과할 수 없다(게이트에 막히거나 픽스처가 안 맞는다). 실측: `legacy` 제거만 했을 때 `fulfillment-order-reservation-retry.worker.integration.spec.ts` 2 건이 red — `findCandidates` 가 v2 에서 `[]` 를 반환한다(Task 9 이 후보 선정을 shipment line 기준으로 바꿨는데 스펙은 V1 형태 픽스처를 심는다). 그러므로 PR A 는 모드+V1코드+outbox 를 한 덩어리로 간다.

**미결: `FULFILLMENT_V2_CUTOVER_AT` 확정.** 불변값이고, 이 시각 이전 주문은 FO 가 생기지 않으며 자동 backfill 도 없다 — 한진 인도 후 출고하려 할 때 수동 처리 대상이 된다. 매니페스트에 `2026-07-16T00:00:00.000Z` 를 넣어뒀으나 **배포 전 확정 필요**.

**이 Task 를 막는 것은 데이터가 아니다.** "V1 물류가 진지하게 쓰인 적 없어 데이터가 날아가도 무방하다"(2026-07-16 확인)는 사실이지만 그것만으로 Task 25 가 열리지는 않는다 — 플랜은 애초에 "V1 출고 이력 없음"을 전제로 설계됐다. 배포된 Core 가 `legacy` 모드로 **V1 을 실행 중**이므로(`fulfillment-workflow-gate.service.ts:87-89` 의 `shouldEnqueueFo` 가 legacy 에서 무조건 true, `fulfillments.service.ts:114-119` 가 모드로 분기), 지금 V1 컬럼/enum 을 드롭하면 주문 유입마다 런타임 에러가 난다. 그래서 contract 는 `deploy → migrate` 순서(ADR-0005 §5)를 지켜 V1 을 안 쓰는 코드를 먼저 띄워야 한다.

**legacy 가 송장이 나오는 유일한 모드다 — 그리고 그 이유가 중요하다.**

| 모드 | V1 `invoice.service` | V2 `invoice-orchestrator` |
|---|---|---|
| `legacy` | ✅ 발행됨 | ❌ 409 `FULFILLMENT_V2_NOT_ACTIVE` |
| `maintenance` | ❌ 503 | ❌ 503 |
| `v2` | ❌ 410 `FULFILLMENT_LEGACY_CLOSED` | ❌ `unsupported` (capability 게이트) |

V1 이 되는 이유는 안전해서가 아니라 **계약 검사를 건너뛰기 때문이다** — `invoice.service.ts:158` 이 `provider.issueInvoice()` 를 capability 검사 없이 직접 부른다. 즉 V1 로 출고한다는 것은 V2 가 거부하는 위험(timeout 시 복구 불가능한 중복 송장)을 그대로 받는다는 뜻이다. **V1 은 안전한 폴백이 아니라 위험한데 라벨이 나오는 경로다.**

**따라서 Task 25 를 여는 조건은 "한진" 이 아니라 "출고 능력이 필요한가" 다.** 필요하다면 한진 구현 **또는** V2 수동 발행 경로 둘 중 하나가 있어야 한다 — V1 의 `direct`(운영자가 번호 직접 입력, `invoice.service.ts:162`)/`self`(내부 발번, `:165`)는 provider 를 부르지 않으므로 capability 게이트의 적용 대상이 애초에 아닌데, V2 에는 이 경로가 없다(`shipment-invoice.dto.ts:9` 가 `@IsIn(['goodsflow','hanjin'])`). 벤더 의존이 없으므로 후자가 훨씬 가깝다.

**결정 (2026-07-16): 한진이 들어오기 전까지 출고할 일이 없다. 따라서 Task 25 를 진행한다.** 출고 능력을 유지할 필요가 없으므로 한진도 V2 수동 발행 경로도 선행 조건이 아니다. 대신 **은퇴 완료 후 한진이 인도될 때까지 이 시스템은 어떤 라벨도 발행할 수 없다** — 이 상태를 감수하는 것이 위 결정의 내용이다. 한진 계약이 끝내 idempotency 를 노출하지 않으면 V2 수동 발행 경로가 유일한 출구가 되므로, 그때는 그것을 구현한다(이 결정으로 막히는 것은 없다 — 수동 경로는 언제든 추가 가능한 additive 작업이다).

**Task 24 축소 가능성 (미결)**: V1 물류가 한 번도 쓰이지 않았다면 Task 24 의 커토버 의식 — 플랫폼 스냅샷, audit 산출물, allowlist cleanup, watermark, maintenance 윈도우 — 대부분이 *보호할 대상이 없는 것을 보호하는 절차*가 된다. 한진 블로커가 풀린 뒤 Task 24 착수 전에 이 축소를 먼저 검토할 것. 단 cleanup 의 "SHIP 이벤트 발견 시 abort" 는 전제를 **검증하는** 장치이므로 전제를 믿는 근거로 삼아 지우면 순환논법이 된다.

- [ ] Prove via production audit that no V1 writer/reader, pending V1 fulfillment outbox, FO-target reservation, `issuedForFO` ownership, `openedForFO` lookup or FO-batch link remains.
- [ ] Make V2-required links NOT NULL where the final model requires them: shipment-line reservations, shipment-owned invoices, tracking attempt links for new tracking rows and outbox topic.
- [ ] Remove `fulfillment_orders.batchId`, `fulfillment_order_batches`, `invoices.issuedForFO`, `shipments.openedForFO/openedBy/openedAt` and legacy reservation target fields only after FK closure verification.
- [ ] Remove or freeze V1-only summaries/ownership: FOI `pickedQty`, writable `reservedQty`, batch `assignedTo` and directly maintained batch totals. Replace remaining reads with reservation/work-item projections.
- [ ] Remove old FO status writes (`picked/invoiced/shipped`), lazy shipment open-box creation, FIFO-at-dispatch consumption and V1 in-house dispatch paths.
- [ ] Keep v1 fulfillment event contracts/projections only for explicitly documented full-completion consumers. Remove them only in a separately approved contract version.
- [ ] Remove expand compatibility fallback from outbox topic routing and fail any topicless new write.
      - 폴백 제거 자체는 지금 안전하다 (topicless 4,767 행이 전부 published 이고 dispatcher 는 pending 만 leasing 하므로 이미 도달 불가). 그러나 "fail any topicless new write" 는 **PR A 에서 12 곳의 호출부 수정 + 두 outbox 서비스의 topicless union 갈래 제거**가 실체다. 이것이 published 삭제와 `topic` NOT NULL 의 **선행 조건**이다 — 순서는 위 "outbox 4,767 행" 절 참조.
- [ ] Generate/review migration and run it against the rehearsal snapshot plus populated V2 fixtures. Verify downgrade is intentionally unsupported after V2 data; recovery uses forward repair.
- [ ] Run `rg` gates for every removed column/status/service, full Core/channel/admin builds, all V2 integration tests and schema reconciliation.
- [ ] Commit: `refactor(fulfillment): remove legacy FO outbound contract`.

---

## Release gate checklist

V2 producer activation requires all items below, not just passing unit tests.

- [ ] 17 representative scenarios and concurrency suite green.
- [ ] Workflow mode `maintenance` demonstrably stops FO creation/retry/mutations/workers.
- [ ] Snapshot ID and read-only audit artifact retained; historical shipment SHIP journal/event count is zero.
- [ ] Cleanup leaves zero confirmed FO-target reservations and zero reservation/ledger drift.
- [ ] Legacy pending fulfillment outbox/backlog cannot replay old orders.
- [ ] Shipment/fulfillment-v2 consumers are deployed; v1 fulfillment events cannot externally dispatch.
- [ ] New channel order and item IDs round-trip unchanged and missing IDs fail Planned for affected channels.
- [ ] Invoice issue/void sandbox crash-recovery drill succeeds.
- [ ] Logistics roles, Core scope mappings, allow/deny tests and JWT audit identity are verified.
- [ ] Reconciliation metrics are zero for FOI demand, reservations, sessions, dispatch source/events and invoices.
- [ ] Before/after cleanup hashes prove SKU/SO/stock journal/event/ledger preservation.
- [ ] V2 data rollback boundary and post-activation maintenance/recovery procedure are acknowledged.

## Verification command set

Use repository-root Yarn commands unless a task names a narrower command.

```bash
yarn build:core
yarn build:channel-adapter
yarn --cwd apps/admin-web lint
yarn --cwd apps/admin-web type-check
yarn --cwd apps/admin-web build

npx jest --runInBand "$TEST_PATTERN"
yarn test:core:integration:local -- outbound-v2

yarn db:generate:core
yarn db:generate:channel-adapter
```

`yarn lint` runs autofix across the monorepo, so do not use it as a read-only verification command in a dirty worktree. Run targeted ESLint without `--fix` for changed TypeScript paths, and review `git diff --check` plus `git status --short` before every commit.

## Final evidence package

Implementation is complete only when the handoff contains:

- exact Core/channel/admin build and test commands with pass counts;
- expand/contract migration filenames and rehearsal database versions;
- 17-scenario result mapping;
- provider issue/void recovery evidence;
- authorization matrix result;
- cutover audit/cleanup/verify artifact locations and hashes, with secrets excluded;
- reconciliation/metric snapshot before and after activation;
- a list of any compatibility projection intentionally retained.

## Plan self-review

- Spec architecture sections 3–7: resource owners, API/idempotency, scopes/audit, data model, progress/lifecycle, quantity equations, command transaction and event/consumer strategy map to Tasks 2–21.
- Hard cutover section 8: consumer-first deployment, additive expand, maintenance, snapshot/audit, allowlisted cleanup, V2 activation and delayed contract cleanup map to Tasks 1–5 and 24–25.
- Workstreams section 9: every Phase 0–8 deliverable has an explicit task and test gate.
- Test/release section 10: unit, real-DB, concurrency, strategy contract, migration rehearsal, consumer/auth/return/crash coverage and all 10 producer gates are included.
- Fixed decisions section 11 are preserved: extended delivery profile, separate state axes, no row workflow version/drain, new streams plus full-completion compatibility, direct rework reversal, additive return attempt link and user-service role/Core scope ownership.
- Current-code hazards are explicitly closed: audit failures no longer swallowed for risk commands, channel events no longer broadcast, inbox has attempt idempotency, `moveInternal` gains a batch control guard, fake consolidation is blocked/replaced and `total_picking` is hidden until a real strategy exists.
