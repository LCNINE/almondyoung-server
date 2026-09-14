# 발주가 수령을 소유 (PR-B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 입고계획 헤더·품목(`inbound_plans`·`inbound_plan_items`)을 코드에서 완전히 걷어내고, **발주 라인이 곧 입고예정**이 되며 **발주가 자기 수령 정산(`received_qty`·잔량 포기·헤더 파생)을 소유**하게 한다. 현장 입고 작업은 PR-A 가 꺼낸 입고 커널을 조달이 호출한다.

**Architecture:** 조달 모듈에 수령 Manager(`PurchaseOrderReceivingManager`)와 헤더 파생기(`PurchaseOrderHeaderDeriver`)를 두고, 라인 상태 규칙은 순수 함수 파일 하나(`purchase-order-status.rules.ts`)가 소유한다. 잠금은 **발주 행 `FOR UPDATE` → 발주 라인 `FOR UPDATE`(sku_id 순) → 커널** 한 방향이다. 커널은 `ArrivalOrigin` 판별 유니온으로 `source`/`method` 조합을 타입으로 잠그고, `cancelLine` 이 `source` 를 검증하는 유일한 자리다. 입고 대기 읽기는 중립 층(`stock-projection`)의 `GET /inventory/expected-arrivals` 가 조달 reader 를 조합한다. 옛 테이블은 남되(PR-C 가 지운다) 아무도 읽고 쓰지 않는다.

**Tech Stack:** NestJS 11 · drizzle-orm 0.44.7 / drizzle-kit 0.31.10 (`check()`·`pgView().as()` 지원) · Jest(UTC) · 로컬 compose PostgreSQL · admin-web(Next.js, jest `.spec.ts` 만) · 창고 앱(Vite + Vitest, 별도 `npm ci`)

**Spec:** `docs/superpowers/specs/2026-09-14-purchase-order-owns-receiving-design.md` — 이번 범위는 **§11 PR-B** 전부. 커널 인터페이스는 §8 스케치가 아니라 **§8 «PR-A 실제 시그니처» 주석**이 정본이다. 선행: PR-A 계획 `docs/superpowers/plans/2026-09-14-inbound-receipt-kernel-extraction.md`(PR #867, develop `c4705d274`).

## 작성 당시 관측 기록 (현재 실행의 검증 증거가 아님)

아래 DB 관측은 첨부 원문의 기록이다. 현재 실행에서 재측정하여 검증 보고서에 남긴다. 라이브 PR-A migrate → deploy 완료는 사용자 확인 사항이다.

- 스펙 §11 사전 확인 쿼리 **P1~P3 는 `dev_core`·`core` 양쪽 모두 0행**. 두 DB 모두 `inbound_plans` 0 · `inbound_plan_items` 0 · `purchase_orders` 0 이라 백필 ①~③ 은 로컬에서 no-op 이다. 라이브는 사용자가 돌린다(쿼리는 §11 그대로).
- PR-A 마이그레이션(`20260913204809_add-inbound-receipt-source`)은 `dev_core`·`core` 에 적용돼 있다(`inbound_receipt_lines.source` 존재). `core` 의 `__drizzle_migrations` 는 91행, `dev_core` 는 93행 — 통합 러너가 매번 `drizzle-kit migrate` 를 돌리므로 `core` 쪽은 신경 쓰지 않는다.
- PR-A 의 dev 스모크(admin-web `/inventory/inbound` 5항목)는 **미실행** — Task 13 스모크에 합친다.
- 현재 워크트리: `/home/pauseb/Documents/Codex/2026-09-14/files-mentioned-by-the-user-2026/work/po-receiving-pr-b`, 브랜치 `feat/purchase-order-owns-receiving-codex`. 2026-09-14 `git pull --ff-only origin develop` 확인, base `c4705d274`. 기존 잠긴 PR-B 워크트리는 보존한다.

## Global Constraints

- **행 잠금 순서 불변식(스펙 §7.1):** `purchase_orders` 행 `FOR UPDATE` → `purchase_order_lines` 행 `FOR UPDATE`(**`sku_id` 오름차순**) → 커널(회차 라인 `FOR UPDATE` · 회차 헤더 `FOR NO KEY UPDATE`). **커널은 발주 행·라인을 절대 잠그지 않는다.** 회차 헤더에 `FOR UPDATE` 를 걸지 않는다 — 적치 작업로그의 FK `KEY SHARE` 와 교착한다.
- **남은 수량(outstanding) 술어는 한 뜻이다.** `status = 'ordered' ∧ closed_at IS NULL ∧ received_qty < COALESCE(ordered_qty, 0)` 이고 **헤더가 `cancelled` 가 아닌 발주**의 라인만 센다. TS 는 `outstandingQty()`(Task 2), SQL 은 `outstandingLineWhere()`(Task 7)와 VIEW(Task 1)가 같은 식을 쓴다. `CHECK` 는 NULL 을 통과시키므로 SQL 은 반드시 `COALESCE` 를 쓴다(스펙 §4.1).
- **라인 입고 진행은 enum 이 아니라 카운터 파생이다(D9).** `po_line_status`·`inbound_status`·`inbound_method` 에 값을 **추가하지 않는다.** 마이그레이션은 기존 enum 값만 쓴다.
- **커널 `source` 가드는 이 PR 부터 켠다.** `cancelLine` 의 `expected.source` 와 라인의 `source` 가 다르면 409. `POST /inbound/cancel` 은 `'direct'` 로만, 조달은 `'purchase_order'` 로만 부른다.
- **검증 층 배정(스펙 §6.1):** DB 를 안 보는 형태 검증은 DTO(class-validator), DB 를 보는 검증은 Manager 에서 `@app/shared` 도메인 예외(`NotFoundError`→404 · `BadRequestError`→400 · `ConflictError`→409). 컨트롤러는 위임만. **새 조달 라우트의 거절 메시지는 한국어**(§6.1 표 그대로). 커널 안의 새 예외는 PR-A 와 같은 Nest 예외(`ConflictException`)를 쓴다 — 한 파일에 두 예외 체계를 섞지 않는다.
- **커널 public 메서드의 `tx` 는 마지막 인자이고 필수다**(PR-A 계승). 조달 Manager 는 `dbService.run(fn, tx)` 로 트랜잭션을 열고 커널에 넘긴다.
- **멱등:** 발주 수령 `withIdempotency('purchase_order.receive', …)`, 수령 취소 `'purchase_order.receipt.cancel'`. 원장 이벤트 키는 `purchase_order.receive:${idempotencyKey}:${i}`(라인 순번). 잔량 포기·예정일 수정은 자연 멱등 — 키 없음.
- **삭제 라우트 5개:** `GET /inbound/pending` · `POST /inbound/plans/items` · `GET /inbound/plans/items` · `POST /inbound/plans/receive` · `POST /inbound/plans/:planId/items/:itemId/close`. **신설 라우트 5개:** `POST /purchase-orders/:poId/receipts`(OPERATE) · `POST /purchase-orders/receipt-lines/:receiptLineId/cancel`(OPERATE) · `POST /purchase-orders/:poId/lines/:skuId/short-close`(MANAGE) · `PATCH /purchase-orders/:poId/lines/:skuId/expected-arrival`(MANAGE) · `GET /inventory/expected-arrivals?warehouseId=`(OPERATE). `inventory-scope-coverage.spec.ts` 표를 같이 고친다.
- **`isTerminal`·`isTerminalPoStatus` 는 지운다** — 뜻만 바꿔 재정의하지 않는다(D11). 타입체커가 호출 지점을 나열하면 지점마다 `acceptsChanges` / `isDerivationFrozen` 중 하나를 고른다.
- **CLAUDE.md Inventory Query Rules:** `db.query.*`·`with` 관계 금지, `any`/`as` 캐스팅 금지(정당화 주석 없이), `@InjectTypedDb<typeof wmsSchema>()`.
- **마이그레이션 2파일**(Task 1): 생성 DDL 1 + `--custom` 백필 1. `db:generate` 는 **메인 세션 또는 사람**이 돌린다 — 서브에이전트는 돌리지 못한다. 배포 순서 **`migrate → deploy`**. `migration-safety.yml` 은 `ADD CONSTRAINT … CHECK`·`RAISE EXCEPTION` 을 라벨링하지 못하므로 PR 본문에 사람이 적는다.
- **기존 결함으로 알려진 것(회귀 아님):** `simple`·`simple-fullscan`·`individual` 의 HTTP 멱등 재전송이 500 — jsonb 재생값의 Date 가 문자열인데 `inbound.mapper.ts:23-41` 이 `.toISOString()` 을 부른다. base 부터 있다. 스모크에서 재전송을 보면 PR-B 회귀로 오인하지 말 것(수정은 범위 밖).
- **통합 스펙 실행:** `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- <패턴>` (워크트리에서 `COMPOSE_PROJECT_NAME` 필수). 통합 러너는 `core` DB, `apps/core/.env` 는 `dev_core` — 마이그레이션은 양쪽에 적용한다. 스펙 안에서 `dotenv.config()` 금지, `describeIfDb` 가드 필수. 같은 물리 DB 를 쓰는 커밋형 스펙은 시드 행을 스스로 지운다.
- **행 잠금 테스트 탐침:** `FOR UPDATE NOWAIT` 는 같은 tx 의 UPDATE/FK 에도 걸려 판별이 안 된다. **`FOR KEY SHARE NOWAIT`**(라인 잠금 확인) 또는 **`FOR NO KEY UPDATE NOWAIT`**(헤더 잠금 확인 — KEY SHARE 와는 충돌하지 않으므로 FK 오탐이 없다)로 탐침하고, **잠금을 제거한 변이에서 RED 가 되는지**를 한 번 확인한다. 탐침 실패 시 held tx 는 `finally` 에서 반드시 푼다.
- **develop 기준선 RED 8 suite**(2026-08-25 실측, `core-integration-tests-local` 메모): `product-masters-variant-preview` · `bulk-session-draft` · `bulk-session-publish` · `shipment-planning` · `inventory-command.service.adjust` · `unified-reservation.service.lifecycle` · `unified-reservation.service.lock` · `stocktaking-uniques`. PR-A 시점엔 10개였다 — Task 13 에서 base 를 다시 재서 대조한다.
- **게이트:** `npm run type-check` 0 · `npx jest --maxWorkers=2` 실패 0 · `cd apps/admin-web && npx tsc --noEmit` 0 · `npm run test:admin-web` 0 · 창고 앱 `npm test` 0 · core 통합 전체 develop 대비 새 실패 0.
- **커밋:** 한국어 conventional(`feat(procurement): …` 등). 이전 Claude 세션을 현재 커밋의 출처로 표기하지 않는다. **푸시·PR 생성·이슈 생성은 사용자 확인 뒤**(Task 13).
- **서브에이전트 모델:** 사용자의 현재 지시에 따라 조사·구현·리뷰 모두 `gpt-5.6-sol` 또는 그 이하 모델만 사용한다. 모델과 reasoning effort를 명시하고 추가 서브에이전트 생성은 컨트롤러가 관리한다.


## 실행 전 검토 보완 (2026-09-14)

다음 보완은 아래 예제보다 우선한다. 설계의 기능 범위는 §11 PR-B 그대로다.

- **T1 최초 설치:** VIEW와 custom 백필의 `po.status` 비교는 `::text`로 비교한다. 과거 `ALTER TYPE ... ADD VALUE cancelled`와 PR-B를 빈 DB에 한 트랜잭션으로 적용할 때의 unsafe enum 사용을 피하는 동등한 술어다. 실제 전체 이력 신규 설치 테스트를 추가한다.
- **T1 백필 정합성 가드:** 백필 마지막에 PR-C 확인 쿼리 3종에 해당하는 orphan 품목·미이관 회차·카운터/링크 합 불일치가 하나라도 있으면 `RAISE EXCEPTION`으로 트랜잭션 전체를 롤백한다. 옛 cache를 임의로 고치지 않으며, 불일치 시 사람이 정리할 수 있도록 가드 원인을 명시한다. CHECK는 기존 계획대로 생성 DDL에 둔다.
- **T1 백필 증거:** 가드 DO 블록만 호출하는 기존 테스트 외에, PR-A 스키마까지 적용한 작업 전용 DB에 정상 옛 모델(부분 수령, 취소된 회차, 잔량 포기, cancelled 헤더 포함)을 시드한다. P1~P3 0행 → 실제 PR-B DDL+백필 실행 → PR-C 확인 쿼리 3종 0행, source·카운터·헤더 상태를 단언한다. 중복 품목·destination·status/ordered_qty 불일치는 각각 실제 migrate 실패를 확인한다. 작업 전용 DB만 생성/삭제하며 공용 core/dev_core를 리셋하지 않는다.
- **T3/T5 생성자 배선:** T3는 `purchase-order.manager.spec.ts`와 `purchase-order-line-execution.integration.spec.ts`를 포함한 모든 생존 `new PurchaseOrderManager`를 `(dbService, reader, deriver)`로 맞춘다. T5는 모든 생존 `new PurchaseOrderService`에 receiving 의존성을 추가한다. 각 변경의 type-check로 누락을 확인한다.
- **T4 이력 응답 계약:** `GET /inbound/receipts`를 admin이 요구하는 회차별 응답 `{total, items: (BaseInboundReceiptDto & {lines: InboundReceiptLineDto[]})[]}`으로 명시한다. 회차 ID·상태·총량·전체 라인의 ID/source/수량/취소/회송/적치 카운터를 실제 DB에서 조회한다. 페이지/total은 회차 단위이며, SKU 필터는 해당 SKU를 포함하는 회차를 선택하고 선택된 회차의 전체 라인을 반환한다. 기존 posted 필터와 query 파라미터는 유지한다. tx를 받은 읽기는 `dbService.run(..., tx)`로 전파한다. DTO/컨트롤러의 응답 타입과 회차 2품목·페이지/총수·source/counters 통합 테스트를 함께 추가한다. T10은 별도 `InboundReceiptHistoryDto`를 선언해 이 응답을 소비하며 drawer의 추측 캐스팅을 제거한다. 쓰기 경로의 간편/전수/개별 응답 형태는 유지한다.
- **T4 동시 취소:** 아래 300ms 지연·catch-all 예제를 그대로 옮기지 않는다. 성공/실패를 전파하는 명시적 acquire/release barrier, 제한 시간, finally 해제 및 FK 순서의 시드 정리를 사용한다. 헤더 잠금 NOWAIT 탐침과 형제 두 라인 동시 취소 후 회차 voided·총 취소량을 모두 검증하고, 헤더 잠금 제거 변이에서 실패함을 확인한다.
- **T5 형태 검증:** 중복 SKU validator는 unknown 입력에서 배열/원소/null을 먼저 검사하여 예외를 던지지 않는다. 비배열·null 원소·중복·빈 lines·0/음수/소수 수량·잘못된/누락된 예정일·공백 사유가 validation 오류가 되는 DTO 테스트를 추가한다. DB 거절의 상태/한국어 메시지와 수령 취소 멱등 재전송도 검증한다.
- **T8 경합 증거:** Promise.allSettled만으로 경합을 가정하지 않는다. 두 커넥션이 실제 잠금에서 만났다는 barrier/대기 관측을 사용하고, 정합성 단언·40P01 부재·finally 정리를 유지한다. 적치-vs-취소는 두 선행 순서를 모두 검증한다.
- **T9 거절 무변경:** source 거절 뒤 canceledQty뿐 아니라 회차·작업 로그·원장 이벤트/잔량도 변경되지 않았음을 단언한다.
- **T7 Swagger:** 공급처는 `ExpectedArrivalSupplierDto`라는 중첩 DTO로 선언한다.
- **T10 문서/창고 연결:** ExpectedArrivalDto에는 warehouseId가 없다. 목록 응답의 warehouseId를 드로어에 전달하고 수령 본문에 사용한다. 라우트/훅/source 취소 분기는 브라우저 스모크에서 검증한다.
- **로컬 환경:** 공유 core에는 이미 다른 PR-B 마이그레이션이 있으므로 첨부 원문의 빈 DB 관측을 재사용하지 않는다. 이번 기준선 DB는 `pr_b_codex_base_20260914`, 구현 DB는 `pr_b_codex_head_20260914`(localhost:5432). 기존 러너와 같은 Jest 패턴/runInBand에 명시적 DATABASE_URL을 주입한다. dev 스모크는 별도 로컬 DB/프로세스로 분리한다. live migrate/deploy는 실행 범위에 포함하지 않는다.

## File Structure

| 파일 | 상태 | 책임 |
|---|---|---|
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` | 수정 | `purchase_order_lines` 4컬럼 + CHECK 3 · `purchase_order_receipt_lines` 신설 · `stock_summary_view` `inbound_pending` 재정의 |
| `apps/core/drizzle/<ts1>_purchase-order-owns-receiving.sql` (+`meta/`) | 생성 | DDL(컬럼·테이블·CHECK·VIEW) |
| `apps/core/drizzle/<ts2>_backfill-purchase-order-receiving.sql` (+`meta/`) | 생성(custom) | 가드 ⓪ + 백필 ①②③ |
| `procurement/services/purchase-order-status.rules.ts` (+`.spec.ts`) | 신규 | 관문 술어 2 · `outstandingQty` · `lineReceivingProgress` · `deriveHeaderStatus` · `purchaseOrderExpectedArrival` |
| `procurement/services/purchase-order-header.deriver.ts` | 신규 | 잠긴 발주의 헤더를 규칙으로 재파생해 저장 |
| `procurement/services/purchase-order-closure.rules.ts` (+`.spec.ts`) · `purchase-order-closure.adapter.ts` | 삭제 | `isTerminal`·3층 파생 |
| `procurement/services/purchase-order.manager.ts` | 수정 | 관문 교체 · 취소 규칙 · `PUT :id/lines` 예정일 · 입고 호출 제거 · 파생기 사용 |
| `procurement/services/purchase-order.reader.ts` | 수정 | 라인 응답에 `receivedQty`·`outstandingQty`·`receivingProgress`·`closedReason`·`closedAt` |
| `procurement/dto/purchase-order/purchase-order-response.dto.ts` · `purchase-order.dto.ts` | 수정 | 응답 필드 · `UpdatePurchaseOrderLineDto.expectedArrival` |
| `procurement/dto/purchase-order/receiving.dto.ts` | 신규 | 수령·취소·잔량 포기·예정일 DTO + 응답 |
| `procurement/services/purchase-order-receiving.manager.ts` (+`.integration.spec.ts`, `.concurrency.integration.spec.ts`) | 신규 | 수령 · 수령 취소 · 잔량 포기 · 예정일 수정 |
| `procurement/services/purchase-order-outstanding.sql.ts` | 신규 | drizzle SQL 조각 — 남은 수량 술어·수량 |
| `procurement/services/purchase-order-expected-arrival.reader.ts` | 신규 | 창고별 입고예정 목록 · SKU 별 남은 수량 합(파이프라인용) |
| `procurement/services/purchase-order.service.ts` · `controllers/purchase-order.controller.ts` · `procurement.module.ts` | 수정 | 신설 라우트 4 위임 · provider 등록 |
| `inbound/kernel/inbound-receipt.kernel.ts` (+`.integration.spec.ts`) | 수정 | `ArrivalOrigin` 유니온 · `cancelLine` source 가드 · 회차 헤더 `FOR NO KEY UPDATE` |
| `inbound/services/inbound.service.ts` · `controllers/inbound.controllers.ts` · `dto/*` · `mappers/inbound.mapper.ts` · `inbound.module.ts` | 수정 | 옛 예정 입고 경로 삭제 · `cancel` 복원 블록 삭제 · 응답 `planItemId`→`source` |
| `inbound/services/inbound-plan-closure.rules.ts` (+spec) · `shared/ports/purchase-order-closure.port.ts` | 삭제 | |
| `inbound/services/__fixtures__/inbound-harness.ts` + 배선 5곳 | 수정 | `InboundService` 생성자 5인자 |
| `stock-projection/dto/expected-arrivals.dto.ts` · `services/expected-arrivals.reader.ts` · `controllers/stock-projection.controller.ts` · `services/stock-projection.service.ts` · `stock-projection.module.ts` | 신규/수정 | `GET /inventory/expected-arrivals` |
| `stock-projection/services/inbound-pipeline.reader.ts` | 수정 | ①·전사 합계를 조달 reader 로 |
| `replenishment/demand/lead-time-profile.refresher.ts` | 수정 | 링크 테이블 경유 |
| `apps/channel-adapter/scripts/sync-restock-to-medusa.ts` | 수정 | 발주 라인 기반 SQL |
| `stock-projection/services/expected-arrivals-parity.integration.spec.ts` | 신규 | §12 #8 읽기 파리티 + #12 동기화 SQL |
| `inventory/inbound-kernel-boundary.arch.spec.ts` · `inventory-write-boundary.arch.spec.ts` · `platform/auth/inventory-scope-coverage.spec.ts` | 수정 | §12 #9 · #11 |
| `apps/core/scripts/import-inbound-plans.ts` | 삭제 | 셀메이트 입고예정 import(D6) |
| `scripts/local/seed-dev-core/inbound.ts` · `index.ts` · `seed.integration.spec.ts` · `scripts/qa/seed-qa7-dev.ts` | 수정 | 새 모델 시드 · 배선 |
| `apps/admin-web/src/…`(Task 10 표) | 수정 | 발주 드로어·목록·입고 대기·이력 |
| `native/warehouse-app/src/…`(Task 11 표) | 수정 | 입고 대기 목록·수령 화면 |
| `docs/adr/0039-…md` · `0032` · `CONTEXT.md` · `docs/agents/domain.md` · `docs/runbooks/selmate-stock-pipeline.md` | 신규/수정 | §13 |

경로 접두 `procurement/`·`inbound/`·`stock-projection/`·`replenishment/`·`shared/` 는 모두 `apps/core/src/modules/inventory/` 아래다.

---
### Task 1: 스키마 + 마이그레이션 2파일 (생성 DDL · custom 백필) — 메인 세션이 실행한다

`db:generate` 는 서브에이전트가 못 돌린다. 이 태스크는 **메인 세션(또는 사람)** 이 직접 한다.

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`purchaseOrderLines` `:2136-2165` · `wmsTables` `:3347-3349` · `stockSummary` `:1106-1200` 의 `inbound_pending` 서브쿼리 `:1186-1194` · row 타입 `:4615-4619`)
- Create(생성): `apps/core/drizzle/<ts1>_purchase-order-owns-receiving.sql` · `apps/core/drizzle/<ts2>_backfill-purchase-order-receiving.sql` · `apps/core/drizzle/meta/*`
- Create: `apps/core/src/modules/inventory/schema/purchase-order-receiving-backfill-guard.integration.spec.ts`

**Interfaces:**
- Produces: `wmsTables.purchaseOrderReceiptLines` · `PurchaseOrderLine.receivedQty: number` · `.closedReason: string | null` · `.closedAt: Date | null` · `.closedBy: string | null` · `PurchaseOrderReceiptLine` / `NewPurchaseOrderReceiptLine` 타입 · VIEW `inbound_pending_qty` 가 발주 라인 남은 수량

**스펙 §11 과의 의도한 차이 하나:** CHECK 3개를 `schema.ts` 에 `check()` 로 선언해 **생성 DDL 파일**에 싣는다(스펙 ④는 백필 뒤). drizzle 스냅샷이 제약을 알아야 다음 `generate` 가 같은 제약을 다시 만들지 않기 때문이다. 요란함은 보존된다 — `received_qty` 기본값 0·`closed_at` NULL 이라 ALTER 자체는 통과하고, 백필 ① 이 초과 수령 행을 만나면 `ck_po_lines_received` 위반으로, `(status='ordered') ≠ (ordered_qty IS NOT NULL)` 행이 있으면 `ck_po_lines_ordered_qty` 추가 시점에 실패한다. 가드 ⓪(P3) 메시지보다 덜 친절할 뿐 조용히 잘리지 않는다.

- [ ] **Step 1: `purchase_order_lines` 컬럼·CHECK 추가**

`purchaseOrderLines` 의 `unavailableReason` 컬럼 아래에 추가하고, 테이블 extras 를 `pk` 하나에서 아래로 바꾼다.

```ts
    unavailableReason: text('unavailable_reason'),
    /**
     * 받은 누계. **발주 행 잠금 안에서만** 갱신한다(스펙 §4.1·§7.1). 정본은 링크된 회차 라인의
     * `quantity − canceled_qty` 합이고 이 컬럼은 그 캐시다 — 파리티는 통합 스펙이 고정한다.
     */
    receivedQty: integer('received_qty').notNull().default(0),
    /** 잔량 포기 사유. `closedAt` 이 null 이 아니면 잔량 포기된 라인이다. */
    closedReason: text('closed_reason'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey(t.poId, t.skuId),
    // 실발주 전에는 받을 수 없고, 실발주를 넘겨 받을 수 없다(D7). CHECK 는 NULL 을 통과시키므로 COALESCE.
    ckReceived: check(
      'ck_po_lines_received',
      sql`${t.receivedQty} >= 0 AND ${t.receivedQty} <= COALESCE(${t.orderedQty}, 0)`,
    ),
    // 잔량 포기는 실발주된 라인에만 있다.
    ckClosed: check('ck_po_lines_closed', sql`${t.closedAt} IS NULL OR ${t.status} = 'ordered'`),
    // 실발주 수량은 실발주된 라인에만, 그리고 반드시 있다 — 지금까지 주석뿐이던 규칙.
    ckOrderedQty: check('ck_po_lines_ordered_qty', sql`(${t.status} = 'ordered') = (${t.orderedQty} IS NOT NULL)`),
  }),
);
```

- [ ] **Step 2: 링크 테이블 신설** — `purchaseOrderLines` 선언 바로 아래.

```ts
/**
 * 발주 라인 ↔ 커널 회차 라인 링크(조달 소유, 스펙 §4.2). 수량은 복사하지 않는다 — 회차 라인의
 * `quantity`·`canceled_qty` 가 진실이다. 취소된 회차의 링크 행도 이력으로 남는다.
 * FK 방향은 문서 → 커널이다. `ON DELETE RESTRICT`: 발주·회차 삭제 경로가 없다.
 */
export const purchaseOrderReceiptLines = pgTable(
  'purchase_order_receipt_lines',
  {
    poId: uuid('po_id').notNull(),
    skuId: uuid('sku_id').notNull(),
    receiptLineId: uuid('receipt_line_id')
      .primaryKey()
      .references(() => inboundReceiptLines.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    fkLine: foreignKey({
      columns: [t.poId, t.skuId],
      foreignColumns: [purchaseOrderLines.poId, purchaseOrderLines.skuId],
      name: 'fk_po_receipt_lines_line',
    }).onDelete('restrict'),
    ixLine: index('ix_po_receipt_lines_line').on(t.poId, t.skuId),
  }),
);
```

`inboundReceiptLines` 가 파일에서 이 테이블보다 **뒤**(`:2353`)에 선언돼 있다 — `references(() => …)` 는 지연 평가라 순서는 상관없지만, `foreignKey({ foreignColumns: [purchaseOrderLines.…] })` 는 즉시 평가라 `purchaseOrderLines` 뒤에 둬야 한다(위 위치가 그렇다). `foreignKey`·`index`·`check` 가 `drizzle-orm/pg-core` import 에 있는지 확인한다(`:3-25`, `check` 는 `:23` 에 이미 있다).

`wmsTables` 에 `purchaseOrderReceiptLines,` 를 `purchaseOrderLines` 다음 줄에 추가하고, row 타입 블록(`:4615-4619`)에 추가:

```ts
export type PurchaseOrderReceiptLine = InferSelectModel<typeof purchaseOrderReceiptLines>;
export type NewPurchaseOrderReceiptLine = InferInsertModel<typeof purchaseOrderReceiptLines>;
```

- [ ] **Step 3: VIEW 의 `inbound_pending` 서브쿼리 교체** — `stockSummary` 의 `sql` 템플릿 `:1186-1194` 를 아래로 바꾼다(다른 서브쿼리는 손대지 않는다).

```sql
    LEFT JOIN (
        -- 입고예정 = 남은 수량이 있는 실발주 라인(스펙 §5.1). 출발 창고(source_warehouse_id) 기준이다.
        -- 술어는 procurement/services/purchase-order-outstanding.sql.ts 와 같은 식이어야 한다 —
        -- 파리티는 expected-arrivals-parity.integration.spec.ts 가 고정한다. COALESCE: CHECK 처럼 NULL 을 통과시키지 않기 위해.
        SELECT pol.sku_id, po.source_warehouse_id AS warehouse_id,
               SUM(COALESCE(pol.ordered_qty, 0) - pol.received_qty) as qty
        FROM purchase_order_lines pol
        INNER JOIN purchase_orders po ON po.id = pol.po_id
        WHERE pol.status = 'ordered'
          AND pol.closed_at IS NULL
          AND pol.received_qty < COALESCE(pol.ordered_qty, 0)
          AND po.status::text <> 'cancelled'
        GROUP BY pol.sku_id, po.source_warehouse_id
    ) inbound_pending ON s.id = inbound_pending.sku_id AND w.id = inbound_pending.warehouse_id
```

`available_qty` 위 주석의 「inbound_plan_items 기반이라」 문구(`:1146`)는 「옛 inbound_plan_items 기반이었을 때」로 고친다.

- [ ] **Step 4: 생성 마이그레이션 — 메인 세션**

Run: `npm run db:generate:core -- --name purchase-order-owns-receiving`
Expected: `apps/core/drizzle/<ts1>_purchase-order-owns-receiving.sql` 이 **다음 문장만** 담는다(순서는 drizzle 가 정한다). 다른 테이블 diff 가 섞이면 멈추고 스냅샷 체인부터 조사한다(core 스냅샷 복구 전력 `ccd7f6b8c`).

```sql
CREATE TABLE "purchase_order_receipt_lines" ( "po_id" uuid NOT NULL, "sku_id" uuid NOT NULL, "receipt_line_id" uuid PRIMARY KEY NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL );
ALTER TABLE "purchase_order_lines" ADD COLUMN "received_qty" integer DEFAULT 0 NOT NULL;
ALTER TABLE "purchase_order_lines" ADD COLUMN "closed_reason" text;
ALTER TABLE "purchase_order_lines" ADD COLUMN "closed_at" timestamp with time zone;
ALTER TABLE "purchase_order_lines" ADD COLUMN "closed_by" uuid;
ALTER TABLE "purchase_order_receipt_lines" ADD CONSTRAINT "purchase_order_receipt_lines_receipt_line_id_inbound_receipt_lines_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."inbound_receipt_lines"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "purchase_order_receipt_lines" ADD CONSTRAINT "fk_po_receipt_lines_line" FOREIGN KEY ("po_id","sku_id") REFERENCES "public"."purchase_order_lines"("po_id","sku_id") ON DELETE restrict ON UPDATE no action;
CREATE INDEX "ix_po_receipt_lines_line" ON "purchase_order_receipt_lines" USING btree ("po_id","sku_id");
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "ck_po_lines_received" CHECK ("purchase_order_lines"."received_qty" >= 0 AND "purchase_order_lines"."received_qty" <= COALESCE("purchase_order_lines"."ordered_qty", 0));
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "ck_po_lines_closed" CHECK ("purchase_order_lines"."closed_at" IS NULL OR "purchase_order_lines"."status" = 'ordered');
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "ck_po_lines_ordered_qty" CHECK (("purchase_order_lines"."status" = 'ordered') = ("purchase_order_lines"."ordered_qty" IS NOT NULL));
DROP VIEW "public"."stock_summary_view";
CREATE VIEW "public"."stock_summary_view" AS ( … Step 3 의 본문 … );
```

`ALTER TYPE … ADD VALUE` 가 **한 줄도 없어야 한다**(D9). 있으면 `schema.ts` 를 되돌리고 원인을 찾는다.

- [ ] **Step 5: custom 백필 마이그레이션 — 메인 세션**

Run: `npm run db:generate:core -- --custom --name backfill-purchase-order-receiving`
Expected: 빈 `apps/core/drizzle/<ts2>_backfill-purchase-order-receiving.sql` 과 journal 항목. `<ts2>` 가 `<ts1>` 보다 커야 한다(같은 초에 돌렸으면 1초 기다렸다 다시).

빈 파일에 아래를 **그대로** 넣는다. 각 문장은 `--> statement-breakpoint` 로 나눈다(8/27 선례 `20260827005020_add-purchase-order-closure-states.sql`). `DO $$ … $$` 블록은 한 문장이다. 기존 enum 값만 쓴다.

```sql
-- PR-B 백필 (스펙 §11). 옛 행이 없으면 전부 no-op. 기존 enum 값만 쓴다(D9).
-- ⓪ 가드 — 백필이 결정적이지 않은 데이터면 요란하게 멈춘다. 사전 확인 쿼리 P1~P3 가 같은 조건이다.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "inbound_plan_items" ipi JOIN "inbound_plans" ip ON ip."id" = ipi."plan_id"
    GROUP BY ip."linked_purchase_order_id", ipi."sku_id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'backfill guard: 한 발주·SKU 에 입고예정 품목이 둘 이상이다 — 사전 확인 쿼리 (P1) 로 행을 보고 사람이 정리할 것';
  END IF;
  IF EXISTS (SELECT 1 FROM "inbound_plans" WHERE "plan_type" = 'destination') THEN
    RAISE EXCEPTION 'backfill guard: destination 계획이 남아 있다 — 사전 확인 쿼리 (P2) 로 행을 보고 사람이 정리할 것';
  END IF;
  IF EXISTS (SELECT 1 FROM "purchase_order_lines" WHERE ("status" = 'ordered') <> ("ordered_qty" IS NOT NULL)) THEN
    RAISE EXCEPTION 'backfill guard: status 와 ordered_qty 가 어긋난 발주 라인이 있다 — 사전 확인 쿼리 (P3)';
  END IF;
END $$;--> statement-breakpoint
-- ① 옛 품목 → 발주 라인 정산 (⓪ 이 다중 매치를 막았으므로 결정적이다)
UPDATE "purchase_order_lines" pol
SET "received_qty"  = ipi."received_qty",
    "closed_reason" = ipi."closed_reason",
    "closed_at"     = ipi."closed_at",
    "closed_by"     = ipi."closed_by"
FROM "inbound_plan_items" ipi
JOIN "inbound_plans" ip ON ip."id" = ipi."plan_id"
WHERE pol."po_id" = ip."linked_purchase_order_id" AND pol."sku_id" = ipi."sku_id";--> statement-breakpoint
-- ② 옛 회차 링크 → 링크 테이블 + source
INSERT INTO "purchase_order_receipt_lines" ("po_id", "sku_id", "receipt_line_id")
SELECT ip."linked_purchase_order_id", ipi."sku_id", irl."id"
FROM "inbound_receipt_lines" irl
JOIN "inbound_plan_items" ipi ON ipi."id" = irl."plan_item_id"
JOIN "inbound_plans" ip ON ip."id" = ipi."plan_id";--> statement-breakpoint
UPDATE "inbound_receipt_lines" SET "source" = 'purchase_order' WHERE "plan_item_id" IS NOT NULL;--> statement-breakpoint
-- ③ 헤더를 새 규칙(§5.2)으로 재계산 — cancelled 는 건드리지 않는다
UPDATE "purchase_orders" po
SET "status" = CASE
  WHEN EXISTS (SELECT 1 FROM "purchase_order_lines" l
               WHERE l."po_id" = po."id" AND l."status" = 'requested') THEN 'created'
  WHEN EXISTS (SELECT 1 FROM "purchase_order_lines" l
               WHERE l."po_id" = po."id" AND l."status" = 'ordered')
   AND NOT EXISTS (SELECT 1 FROM "purchase_order_lines" l
                   WHERE l."po_id" = po."id" AND l."status" = 'ordered'
                     AND l."closed_at" IS NULL
                     AND l."received_qty" < COALESCE(l."ordered_qty", 0)) THEN 'received'
  ELSE 'confirmed'
END::po_status
WHERE po."status"::text <> 'cancelled';
```

- [ ] **Step 6: 가드 ⓪ 가 실제로 멈추는지 — 격리 DB 스펙(§12 #13)**

`apps/core/src/modules/inventory/schema/purchase-order-receiving-backfill-guard.integration.spec.ts`:

```ts
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as postgres from 'postgres';
import { randomUUID } from 'crypto';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * PR-B 백필 가드 ⓪ 가 실제로 멈추는지(스펙 §12 #13). 러너는 이미 마이그레이션을 다 적용했으므로
 * 여기서는 custom 파일의 첫 문장(DO 블록)만 떼어 **롤백 트랜잭션 안에서** 다시 실행한다 —
 * 한 발주·SKU 에 품목 둘을 심으면 RAISE EXCEPTION 이 나야 한다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- backfill-guard
 */
describeIfDb('PR-B 백필 가드 ⓪ (DB integration)', () => {
  jest.setTimeout(60_000);
  let sql: postgres.Sql;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
  });
  afterAll(async () => {
    await sql.end();
  });

  function guardStatement(): string {
    const dir = join(__dirname, '..', '..', '..', '..', 'drizzle');
    const file = readdirSync(dir).find((f) => f.endsWith('_backfill-purchase-order-receiving.sql'));
    if (!file) throw new Error('backfill migration file not found');
    const [first] = readFileSync(join(dir, file), 'utf8').split('--> statement-breakpoint');
    return first;
  }

  it('한 발주·SKU 에 품목이 둘이면 P1 가드가 RAISE 한다', async () => {
    await expect(
      sql.begin(async (tx) => {
        const suffix = randomUUID().slice(0, 8);
        const [wh] = await tx`INSERT INTO warehouses (name) VALUES (${'bg-wh-' + suffix}) RETURNING id`;
        const [holder] = await tx`INSERT INTO holders (name) VALUES (${'bg-h-' + suffix}) RETURNING id`;
        const [sku] = await tx`INSERT INTO skus (name, code, holder_id) VALUES ('bg', ${'BG-' + randomUUID()}, ${holder.id}) RETURNING id`;
        const [po] = await tx`INSERT INTO purchase_orders (type, source_warehouse_id, destination_warehouse_id)
                              VALUES ('domestic', ${wh.id}, ${wh.id}) RETURNING id`;
        const [plan] = await tx`INSERT INTO inbound_plans (warehouse_id, linked_purchase_order_id, destination_warehouse_id)
                                VALUES (${wh.id}, ${po.id}, ${wh.id}) RETURNING id`;
        await tx`INSERT INTO inbound_plan_items (plan_id, sku_id, expected_qty) VALUES (${plan.id}, ${sku.id}, 1), (${plan.id}, ${sku.id}, 2)`;
        await tx.unsafe(guardStatement());
      }),
    ).rejects.toThrow(/backfill guard: 한 발주·SKU/);
  });

  it('옛 행이 없으면 가드가 통과한다', async () => {
    await sql.begin(async (tx) => {
      await tx.unsafe(guardStatement());
    });
  });
});
```

`sql.begin` 은 콜백이 던지면 롤백한다 — 시드 행이 남지 않는다. 경로 `join(__dirname, '..', '..', '..', '..', 'drizzle')` 는 `apps/core/src/modules/inventory/schema` → `apps/core/drizzle` 다.

- [ ] **Step 7: 러너로 적용·검증**

Run: `npm run type-check && COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "backfill-guard|view-parity"`
Expected: type-check 0 · 러너 3/3 단계에서 새 마이그레이션 2건 적용 · `backfill-guard` 2 PASS · `view-parity` 는 **옛 `inbound_plan_items` 를 시드해서 RED** 가 된다(`view-parity.integration.spec.ts:144-219`). 이 RED 는 Task 7 이 고친다 — 여기서는 마이그레이션이 적용됐다는 신호로만 본다(VIEW 가 옛 테이블을 안 읽으므로 `inboundPending` 이 0).

- [ ] **Step 8: dev DB 에도 적용** (`apps/core/.env` 는 `dev_core`)

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dev_core npx drizzle-kit migrate --config apps/core/drizzle.config.ts`
Expected: 2건 적용. 확인: `docker exec -i almondyoung-server-postgres-1 psql -U postgres -d dev_core -c "\d purchase_order_receipt_lines" -c "select conname from pg_constraint where conrelid='purchase_order_lines'::regclass and contype='c'"` → 테이블 존재 · CHECK 3개.

- [ ] **Step 9: 커밋** — `schema.ts` + SQL 2 + `meta/` + 가드 스펙을 **한 커밋에**.

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle/ apps/core/src/modules/inventory/schema/purchase-order-receiving-backfill-guard.integration.spec.ts
git commit -m "feat(procurement): 발주 라인이 수령을 소유한다 — received_qty·잔량 포기 컬럼·링크 테이블·CHECK 3·VIEW 재생성 + 백필 (PR-B expand)

마이그레이션 2파일: 생성 DDL(컬럼·purchase_order_receipt_lines·CHECK·stock_summary_view) + custom 백필(가드 ⓪ + ①②③).
기존 enum 값만 쓴다(D9). 배포 순서 migrate → deploy. migration-safety.yml 은 CHECK·RAISE 를 라벨링하지 못한다."
```

---
### Task 2: 상태 규칙 순수 함수 — 관문 술어 2 · 남은 수량 · 입고 진행 · 헤더 파생 · 헤더 도착예정일

**Files:**
- Create: `apps/core/src/modules/inventory/procurement/services/purchase-order-status.rules.ts`
- Create: `apps/core/src/modules/inventory/procurement/services/purchase-order-status.rules.spec.ts`
- Delete: `apps/core/src/modules/inventory/procurement/services/purchase-order-closure.rules.ts` · `purchase-order-closure.rules.spec.ts`
- Modify: `apps/core/src/modules/inventory/shared/dates/earliest-expected-date.ts` (`purchaseOrderExpectedArrival` `:29-45` 삭제 — `earliestExpectedDate` 만 남긴다)

**Interfaces:**
- Produces (모두 `purchase-order-status.rules.ts` export):
  - `type PurchaseOrderStatus = 'created' | 'confirmed' | 'received' | 'cancelled'`
  - `type PurchaseOrderLineStatus = 'requested' | 'ordered' | 'unavailable'`
  - `acceptsChanges(s: PurchaseOrderStatus): boolean` · `isDerivationFrozen(s: PurchaseOrderStatus): boolean`
  - `interface LineSettlement { status: PurchaseOrderLineStatus; orderedQty: number | null; receivedQty: number; closedAt: Date | null }`
  - `outstandingQty(line: LineSettlement): number`
  - `type ReceivingProgress = 'awaiting' | 'received' | 'short_closed'` · `lineReceivingProgress(line: LineSettlement): ReceivingProgress | null`
  - `deriveHeaderStatus(lines: readonly LineSettlement[]): Exclude<PurchaseOrderStatus, 'cancelled'>`
  - `purchaseOrderExpectedArrival(lines: readonly (LineSettlement & { expectedArrival: string | null })[]): Date | null`
- Consumes: `earliestExpectedDate` (`shared/dates/earliest-expected-date.ts`)

`isTerminal` 을 지우면 `purchase-order.manager.ts:16,254,369,422,488` 과 `purchase-order-closure.adapter.ts:5` 가 컴파일 에러가 난다 — **이 태스크의 마지막 Step 에서 type-check 는 그 에러만 남긴 채 끝난다**(Task 3 이 고친다). 그래서 이 태스크의 검증은 `npx jest purchase-order-status.rules` 단위 스펙이다.

- [ ] **Step 1: 실패하는 스펙**

`purchase-order-status.rules.spec.ts`:

```ts
import {
  acceptsChanges,
  deriveHeaderStatus,
  isDerivationFrozen,
  lineReceivingProgress,
  outstandingQty,
  purchaseOrderExpectedArrival,
  LineSettlement,
} from './purchase-order-status.rules';

const ordered = (over: Partial<LineSettlement> = {}): LineSettlement => ({
  status: 'ordered',
  orderedQty: 10,
  receivedQty: 0,
  closedAt: null,
  ...over,
});
const requested: LineSettlement = { status: 'requested', orderedQty: null, receivedQty: 0, closedAt: null };
const unavailable: LineSettlement = { status: 'unavailable', orderedQty: null, receivedQty: 0, closedAt: null };

describe('관문 술어 (스펙 §5.3 4×2 표)', () => {
  it.each([
    ['created', true, false],
    ['confirmed', true, false],
    ['received', false, false],
    ['cancelled', false, true],
  ] as const)('%s → acceptsChanges=%s · isDerivationFrozen=%s', (status, accepts, frozen) => {
    expect(acceptsChanges(status)).toBe(accepts);
    expect(isDerivationFrozen(status)).toBe(frozen);
  });
});

describe('outstandingQty / lineReceivingProgress (§5.1)', () => {
  it('requested·unavailable 은 남은 수량 0, 입고 진행 없음', () => {
    expect(outstandingQty(requested)).toBe(0);
    expect(outstandingQty(unavailable)).toBe(0);
    expect(lineReceivingProgress(requested)).toBeNull();
    expect(lineReceivingProgress(unavailable)).toBeNull();
  });
  it('ordered 는 실발주 − 받은 누계', () => {
    expect(outstandingQty(ordered({ receivedQty: 3 }))).toBe(7);
    expect(lineReceivingProgress(ordered({ receivedQty: 3 }))).toBe('awaiting');
  });
  it('전량 입고 = 남은 수량 0', () => {
    expect(outstandingQty(ordered({ receivedQty: 10 }))).toBe(0);
    expect(lineReceivingProgress(ordered({ receivedQty: 10 }))).toBe('received');
  });
  it('잔량 포기는 받은 수와 무관하게 short_closed 이고 남은 수량 0', () => {
    const line = ordered({ receivedQty: 3, closedAt: new Date() });
    expect(outstandingQty(line)).toBe(0);
    expect(lineReceivingProgress(line)).toBe('short_closed');
  });
  it('orderedQty 가 null 인 ordered(CHECK 가 막지만)는 0 으로 — NULL 산술이 새지 않게', () => {
    expect(outstandingQty(ordered({ orderedQty: null }))).toBe(0);
  });
});

describe('deriveHeaderStatus (§5.2)', () => {
  it('requested 가 하나라도 있으면 created', () => {
    expect(deriveHeaderStatus([requested, ordered({ receivedQty: 10 })])).toBe('created');
  });
  it('받을 게 남았으면 confirmed', () => {
    expect(deriveHeaderStatus([ordered({ receivedQty: 3 }), unavailable])).toBe('confirmed');
  });
  it('전 라인이 unavailable 이면 confirmed (ordered 0)', () => {
    expect(deriveHeaderStatus([unavailable])).toBe('confirmed');
  });
  it('라인이 없으면 confirmed', () => {
    expect(deriveHeaderStatus([])).toBe('confirmed');
  });
  it('ordered ≥ 1 이고 남은 수량 있는 라인이 0 이면 received', () => {
    expect(deriveHeaderStatus([ordered({ receivedQty: 10 }), unavailable])).toBe('received');
  });
  it('전부 잔량 포기(받은 것 0 포함)여도 received — 「더 받을 것이 없다」', () => {
    expect(deriveHeaderStatus([ordered({ closedAt: new Date() })])).toBe('received');
  });
  it('received 에서 수령 취소로 남은 수량이 생기면 confirmed 로 돌아간다 (D10 역행)', () => {
    expect(deriveHeaderStatus([ordered({ receivedQty: 10 })])).toBe('received');
    expect(deriveHeaderStatus([ordered({ receivedQty: 0 })])).toBe('confirmed');
  });
});

describe('purchaseOrderExpectedArrival (§5.2 — 남은 수량이 있는 라인만)', () => {
  it('남은 수량이 있는 ordered 라인 중 가장 이른 날짜', () => {
    expect(
      purchaseOrderExpectedArrival([
        { ...ordered({ receivedQty: 10 }), expectedArrival: '2026-09-01' },
        { ...ordered(), expectedArrival: '2026-09-20' },
        { ...ordered(), expectedArrival: '2026-09-15' },
      ]),
    ).toEqual(new Date('2026-09-15T00:00:00.000Z'));
  });
  it('requested·unavailable·전량 입고·잔량 포기 라인의 날짜는 무시한다', () => {
    expect(
      purchaseOrderExpectedArrival([
        { ...requested, expectedArrival: '2026-09-01' },
        { ...unavailable, expectedArrival: '2026-09-02' },
        { ...ordered({ closedAt: new Date() }), expectedArrival: '2026-09-03' },
      ]),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/inventory/procurement/services/purchase-order-status.rules`
Expected: FAIL — `Cannot find module './purchase-order-status.rules'`.

- [ ] **Step 3: 구현**

`purchase-order-status.rules.ts`:

```ts
import { earliestExpectedDate } from '../../shared/dates/earliest-expected-date';

/** drizzle enum 컬럼은 문자열 유니온이다. TS enum 멤버로 비교하지 않는다. */
export type PurchaseOrderStatus = 'created' | 'confirmed' | 'received' | 'cancelled';
export type PurchaseOrderLineStatus = 'requested' | 'ordered' | 'unavailable';

/**
 * 상태 관문 둘(스펙 §5.3, D11). 옛 `isTerminal` 은 「편집 금지」와 「파생 동결」 두 뜻으로 쓰였고
 * 두 집합이 우연히 같아서 버텼다 — 이 모델에서 갈라지므로 목적으로 이름 붙이고 exhaustive 표로 둔다.
 * 상태값이 늘면 두 표가 컴파일 에러로 결정을 강제한다. admin-web `line-execution-model.ts` 가 같은 표를 든다.
 */
const ACCEPTS_CHANGES: Record<PurchaseOrderStatus, boolean> = {
  created: true,
  confirmed: true,
  received: false,
  cancelled: false,
};
/** 편집 관문 — 라인 수정 · 라인 실행 · 불가 · 발주 취소 · 예정일 수정 */
export const acceptsChanges = (s: PurchaseOrderStatus): boolean => ACCEPTS_CHANGES[s];

const DERIVATION_FROZEN: Record<PurchaseOrderStatus, boolean> = {
  created: false,
  confirmed: false,
  received: false,
  cancelled: true,
};
/** 파생 동결 — 헤더 파생 함수가 손대지 않는 상태. `received` 는 동결이 아니다(수령 취소로 돌아온다, D10). */
export const isDerivationFrozen = (s: PurchaseOrderStatus): boolean => DERIVATION_FROZEN[s];

/** 라인 정산에 필요한 최소 필드. DB 행(`PurchaseOrderLine`)이 이 모양을 만족한다. */
export interface LineSettlement {
  status: PurchaseOrderLineStatus;
  orderedQty: number | null;
  receivedQty: number;
  closedAt: Date | null;
}

/**
 * 남은 수량(스펙 §5.1). `ordered ∧ closed_at IS NULL ∧ ordered_qty − received_qty > 0` 일 때의 그 차.
 * SQL 쪽 같은 식은 `purchase-order-outstanding.sql.ts` 가 든다 — 두 식이 갈리면 파리티 스펙이 잡는다.
 */
export function outstandingQty(line: LineSettlement): number {
  if (line.status !== 'ordered' || line.closedAt !== null) return 0;
  return Math.max(0, (line.orderedQty ?? 0) - line.receivedQty);
}

/** 입고 진행 — enum 이 아니라 카운터에서 파생한다(D9). 주문 결정이 안 난 라인은 null. */
export type ReceivingProgress = 'awaiting' | 'received' | 'short_closed';
export function lineReceivingProgress(line: LineSettlement): ReceivingProgress | null {
  if (line.status !== 'ordered') return null;
  if (line.closedAt !== null) return 'short_closed';
  return outstandingQty(line) > 0 ? 'awaiting' : 'received';
}

/**
 * 헤더 파생(스펙 §5.2) — 조달 안의 유일한 함수. `cancelled` 는 사람의 결정이라 여기서 나오지 않는다.
 * 라인을 바꾸는 모든 조작(실행·불가·수령·수령 취소·잔량 포기)이 끝에서 이 함수를 부른다.
 */
export function deriveHeaderStatus(lines: readonly LineSettlement[]): Exclude<PurchaseOrderStatus, 'cancelled'> {
  if (lines.some((l) => l.status === 'requested')) return 'created';
  const hasOrdered = lines.some((l) => l.status === 'ordered');
  const hasOutstanding = lines.some((l) => outstandingQty(l) > 0);
  if (hasOrdered && !hasOutstanding) return 'received';
  return 'confirmed';
}

/** 헤더 도착예정일 = 남은 수량이 있는 라인 중 가장 이른 `expected_arrival`(스펙 §5.2). */
export function purchaseOrderExpectedArrival(
  lines: readonly (LineSettlement & { expectedArrival: string | null })[],
): Date | null {
  return earliestExpectedDate(lines.filter((l) => outstandingQty(l) > 0).map((l) => l.expectedArrival));
}
```

`shared/dates/earliest-expected-date.ts` 에서 `purchaseOrderExpectedArrival` 함수와 그 docstring(`:29-45`)을 지운다. `earliestExpectedDate` 와 `.spec.ts` 는 그대로다. 이 함수를 조달 규칙 파일로 옮기는 이유: 새 필터가 `outstandingQty`(조달 규칙)에 의존하므로 `shared/` 가 `procurement/` 를 import 하는 역방향을 피한다(ADR-0032 결정 4 의 「누가 쓰나」 기준 — 쓰는 곳은 조달 reader 뿐이다).

`purchase-order-closure.rules.ts` 와 `purchase-order-closure.rules.spec.ts` 를 `git rm` 한다.

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/inventory/procurement/services/purchase-order-status.rules`
Expected: PASS (17 tests).

Run: `npm run type-check 2>&1 | grep -c "error TS"`
Expected: 에러가 **`purchase-order.manager.ts`(isTerminal 5곳)·`purchase-order-closure.adapter.ts`·`purchase-order.reader.ts`(purchaseOrderExpectedArrival import 경로)** 에만 있다. 다른 파일에 있으면 이 태스크가 만든 것이다.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/procurement/services/purchase-order-status.rules.ts apps/core/src/modules/inventory/procurement/services/purchase-order-status.rules.spec.ts apps/core/src/modules/inventory/shared/dates/earliest-expected-date.ts
git rm -q apps/core/src/modules/inventory/procurement/services/purchase-order-closure.rules.ts apps/core/src/modules/inventory/procurement/services/purchase-order-closure.rules.spec.ts
git commit -m "feat(procurement): 발주 상태 규칙 — 관문 술어 둘(acceptsChanges·isDerivationFrozen)·남은 수량·입고 진행·헤더 파생 (isTerminal 삭제, D9·D11)"
```

---
### Task 3: 헤더 파생 통합 + 관문 적용 + 입고 호출 제거 + 응답 필드 (조달 Manager·Reader)

**Files:**
- Create: `apps/core/src/modules/inventory/procurement/services/purchase-order-header.deriver.ts`
- Modify: `apps/core/src/modules/inventory/procurement/services/purchase-order.manager.ts` (`:16` import · `:50-55` 생성자 · `:239-293` cancel · `:302-343` executeLineOrder · `:355-381` lock · `:414-437` refreshHeaderStatus · `:447-523` updateLines)
- Modify: `apps/core/src/modules/inventory/procurement/services/purchase-order.reader.ts` (`:9` import · `:44-64`·`:138-174` 라인 select · `:82-100`·`:180-198` 매핑)
- Modify: `apps/core/src/modules/inventory/procurement/dto/purchase-order/purchase-order-response.dto.ts` (`PurchaseOrderLineDto` `:12-35`)
- Modify: `apps/core/src/modules/inventory/procurement/dto/purchase-order.dto.ts` (`UpdatePurchaseOrderLineDto` `:74-88`)
- Modify: `apps/core/src/modules/inventory/procurement/procurement.module.ts` (provider 추가)
- Modify: `apps/core/src/modules/inventory/procurement/services/purchase-order-line-execution.integration.spec.ts` (계획 단언 → 라인 정산 단언)
- Delete: `procurement/services/purchase-order-single-plan.integration.spec.ts` · `purchase-order-closure.integration.spec.ts` · `purchase-order-closure.adapter.ts`
- Modify(배선만): `inbound/inbound.module.ts:6,22` (adapter 등록 제거는 **Task 6** 에서 port 삭제와 함께 — 이 태스크에서는 adapter 파일을 지우므로 등록 줄을 지우고 `PURCHASE_ORDER_CLOSURE` 는 `useValue: { onPlanClosed: async () => undefined }` 로 임시 대체한다. Task 6 가 port 자체를 지운다.) · `inbound-harness.ts:15,70` · `inbound.service.idempotency.spec.ts:2,17` · `inbound-plan-port-invariant.integration.spec.ts:9,55` · `core/services/inventory-idempotency.integration.spec.ts:19,56` · `scripts/local/seed-dev-core/index.ts:11,118` · `scripts/qa/seed-qa7-dev.ts:32,86` — `new PurchaseOrderClosureAdapter()` → `{ onPlanClosed: async () => undefined }` 로 바꾼다(Task 6 가 인자를 통째로 없앤다).

**Interfaces:**
- Produces: `PurchaseOrderHeaderDeriver.refresh(poId: string, tx: DbTx): Promise<PurchaseOrderStatus>` — **호출자가 발주 행을 이미 `FOR UPDATE` 로 잠갔어야 한다**. `PurchaseOrderLineDto` 에 `receivedQty: number` · `outstandingQty: number` · `receivingProgress: ReceivingProgress | null` · `closedReason: string | null` · `closedAt: Date | null`. `UpdatePurchaseOrderLineDto.expectedArrival?: string`.
- Consumes: Task 2 규칙 함수 전부.

- [ ] **Step 1: 실패하는 통합 단언 — `purchase-order-line-execution.integration.spec.ts` 를 새 모델로**

이 스펙(811줄)은 옛 계획 테이블을 직접 읽는다. 아래처럼 고친다.

1. `buildInboundService`(`:78-89`)의 `new PurchaseOrderClosureAdapter()` 를 `{ onPlanClosed: async () => undefined }` 로 바꾸고 import(`:15`)를 지운다.
2. `readPlans`(`:257-262`)·`readPlanItems`(`:264-272`) 헬퍼를 지우고, 대신:
```ts
  async function readLineSettlement(trx: DbTx, poId: string, skuId: string) {
    const [row] = await trx
      .select({
        status: wmsTables.purchaseOrderLines.status,
        orderedQty: wmsTables.purchaseOrderLines.orderedQty,
        receivedQty: wmsTables.purchaseOrderLines.receivedQty,
        closedAt: wmsTables.purchaseOrderLines.closedAt,
        expectedArrival: wmsTables.purchaseOrderLines.expectedArrival,
      })
      .from(wmsTables.purchaseOrderLines)
      .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.skuId, skuId)))
      .limit(1);
    return row;
  }
```
3. 계획을 단언하던 테스트를 바꾼다(it 이름과 단언):
   - `:273` 「발주 생성만으로는 계획이 없다」 → 「발주 생성만으로는 남은 수량이 없다 — requested 라인은 입고예정이 아니다」: 생성 후 각 라인 `readLineSettlement` 의 `status === 'requested'` 이고 `outstandingQty(row) === 0`.
   - `:352` 「계획은 한 번만 만들어진다」 → 삭제(계획이 없다).
   - `:371` 「불가 처리는 계획에 아무것도 남기지 않는다」 → 「불가 처리된 라인은 남은 수량 0 이고 receivingProgress 가 null 이다」: `readLineSettlement` 로 `outstandingQty === 0`, 응답 라인 `receivingProgress === null`.
   - `:553` 파리티 「헤더 ETA == 계획 예정일」 → 「헤더 ETA == 남은 수량 있는 라인의 최소 expectedArrival」: 3 라인 중 2개 실행(ETA `2026-09-20`, `2026-09-15`), 응답 `expectedArrival` 이 `new Date('2026-09-15T00:00:00.000Z')`.
   - `:657` 「부분 실행이면 파이프라인 ① 에 실행분만 보인다」 → **Task 7 에서 파이프라인 reader 를 바꾸기 전까지 실패한다.** 이 it 을 `it.skip` 으로 두고 주석 `// Task 7 에서 InboundPipelineReader 가 발주 라인을 읽게 되면 skip 을 푼다` 를 단다. Task 7 Step 에서 푼다.
   - `:678-772` `updatePurchaseOrderLines` 4건 중 「계획 아이템을 늘리지 않는다」(`:700` 부근) → 삭제. 나머지 3건은 그대로.
4. 새 it 추가 — `PUT :id/lines` 가 `expectedArrival` 을 싣는다:
```ts
  it('라인 일괄 수정이 expectedArrival 을 잃지 않는다 (§6.1 결함 수정)', async () => {
    await inRollback(async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const svc = buildService(trx);
      await svc.updatePurchaseOrderLines(fx.poId, {
        lines: [{ skuId: fx.skuIds[0], quantity: 5, expectedArrival: '2026-10-01' }],
      });
      const row = await readLineSettlement(trx, fx.poId, fx.skuIds[0]);
      expect(row.expectedArrival).toBe('2026-10-01');
    });
  });
```
5. 새 it 추가 — 관문 표(§12 #1a 의 편집 금지 절반. 수령 취소 통과는 Task 5):
```ts
  it('received 발주는 라인 수정·실행·불가·취소를 거절한다 (acceptsChanges)', async () => {
    await inRollback(async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const svc = buildService(trx);
      for (const skuId of fx.skuIds) await svc.orderLine(fx.poId, skuId, { orderedQty: 10 }, USER_ID);
      // 전량 입고를 직접 심어 received 로 만든다 — 수령 라우트는 Task 5 이므로 카운터를 직접 쓴다.
      await trx.update(wmsTables.purchaseOrderLines).set({ receivedQty: 10 }).where(eq(wmsTables.purchaseOrderLines.poId, fx.poId));
      await trx.update(wmsTables.purchaseOrders).set({ status: 'received' }).where(eq(wmsTables.purchaseOrders.id, fx.poId));

      await expect(svc.updatePurchaseOrderLines(fx.poId, { lines: [{ skuId: fx.skuIds[0], quantity: 1 }] })).rejects.toThrow(ConflictError);
      await expect(svc.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 1 }, USER_ID)).rejects.toThrow(ConflictError);
      await expect(svc.markLineUnavailable(fx.poId, fx.skuIds[0], {}, USER_ID)).rejects.toThrow(ConflictError);
      await expect(svc.cancelPurchaseOrder(fx.poId, { reason: 'x' }, USER_ID)).rejects.toThrow(ConflictError);
    });
  });

  it('부분 입고된 발주는 취소할 수 없고, 입고 0 이면 취소된다 (모든 라인 received_qty = 0)', async () => {
    await inRollback(async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const svc = buildService(trx);
      await svc.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 10 }, USER_ID);
      await trx.update(wmsTables.purchaseOrderLines).set({ receivedQty: 3 })
        .where(and(eq(wmsTables.purchaseOrderLines.poId, fx.poId), eq(wmsTables.purchaseOrderLines.skuId, fx.skuIds[0])));
      await expect(svc.cancelPurchaseOrder(fx.poId, { reason: 'x' }, USER_ID)).rejects.toThrow(/receipts/);

      await trx.update(wmsTables.purchaseOrderLines).set({ receivedQty: 0 })
        .where(and(eq(wmsTables.purchaseOrderLines.poId, fx.poId), eq(wmsTables.purchaseOrderLines.skuId, fx.skuIds[0])));
      const cancelled = await svc.cancelPurchaseOrder(fx.poId, { reason: 'x' }, USER_ID);
      expect(cancelled.status).toBe('cancelled');
    });
  });

  it('응답 라인이 receivedQty·outstandingQty·receivingProgress 를 싣는다', async () => {
    await inRollback(async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      const svc = buildService(trx);
      const res = await svc.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 10 }, USER_ID);
      const line = res.lines.find((l) => l.skuId === fx.skuIds[0])!;
      expect(line).toMatchObject({ receivedQty: 0, outstandingQty: 10, receivingProgress: 'awaiting', closedReason: null, closedAt: null });
      const requestedLine = res.lines.find((l) => l.skuId === fx.skuIds[1])!;
      expect(requestedLine).toMatchObject({ receivedQty: 0, outstandingQty: 0, receivingProgress: null });
    });
  });
```
`USER_ID`·`ConflictError`(`@app/shared`)·`and` import 는 파일 상단에서 이미 쓰는 이름을 쓴다(없으면 추가). 라인 실행 거절이 현행 `BadRequestError`(`:370`)에서 `ConflictError` 로 바뀐다 — 「이미 종결된 발주」는 409 가 맞다(#745 가 미뤘던 것). `updatePurchaseOrderLines` 의 `:489` 도 같이 409 로 간다.

- [ ] **Step 2: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-line-execution`
Expected: 컴파일 에러(`purchaseOrderExpectedArrival` 경로·`isTerminal`·응답 필드 없음)로 suite 자체가 FAIL.

- [ ] **Step 3: `PurchaseOrderHeaderDeriver`**

```ts
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../schema/inventory.schema';
import { deriveHeaderStatus, isDerivationFrozen, PurchaseOrderStatus } from './purchase-order-status.rules';

/**
 * 헤더 재파생(스펙 §5.2). 라인을 바꾸는 모든 조작이 끝에서 부른다 — 파생 경로가 하나라
 * 결함 ㄱ·ㄴ·ㄷ 이 설 자리가 없다.
 *
 * 🔴 **호출자가 발주 행을 이미 `FOR UPDATE` 로 잠갔어야 한다.** 여기서 다시 잠그지 않는다 —
 * 잠금 취득 지점을 한 곳(각 Manager 메서드의 첫 문장)으로 유지하기 위해서다.
 * 트랜잭션을 열지 않는다(`DbService` 미주입). `tx` 는 필수·마지막 인자다(PR-A 커널과 동일한 트랜잭션 전파 규약).
 */
@Injectable()
export class PurchaseOrderHeaderDeriver {
  async refresh(poId: string, tx: DbTx): Promise<PurchaseOrderStatus> {
    const [header] = await tx
      .select({ status: wmsTables.purchaseOrders.status })
      .from(wmsTables.purchaseOrders)
      .where(eq(wmsTables.purchaseOrders.id, poId))
      .limit(1);
    if (!header) throw new Error(`purchase order vanished under lock: ${poId}`);
    if (isDerivationFrozen(header.status)) return header.status;

    const lines = await tx
      .select({
        status: wmsTables.purchaseOrderLines.status,
        orderedQty: wmsTables.purchaseOrderLines.orderedQty,
        receivedQty: wmsTables.purchaseOrderLines.receivedQty,
        closedAt: wmsTables.purchaseOrderLines.closedAt,
      })
      .from(wmsTables.purchaseOrderLines)
      .where(eq(wmsTables.purchaseOrderLines.poId, poId));
    const next = deriveHeaderStatus(lines);
    if (next !== header.status) {
      await tx
        .update(wmsTables.purchaseOrders)
        .set({ status: next, updatedAt: new Date() })
        .where(eq(wmsTables.purchaseOrders.id, poId));
    }
    return next;
  }
}
```

`procurement.module.ts` providers·exports 에 `PurchaseOrderHeaderDeriver` 추가.

- [ ] **Step 4: `PurchaseOrderManager` 수정**

- import(`:16`): `import { isTerminal } from './purchase-order-closure.rules';` → `import { acceptsChanges } from './purchase-order-status.rules';` 그리고 `import { PurchaseOrderHeaderDeriver } from './purchase-order-header.deriver';`
- 생성자(`:50-55`): `inboundService: InboundService` 인자를 **제거**하고 `private readonly headerDeriver: PurchaseOrderHeaderDeriver` 를 추가 → `(dbService, reader, headerDeriver)`. `InboundService` import 제거. 클래스 docstring 의 「procurement → inbound 호출 두 개」 문단은 「조달은 입고 모듈의 **커널**만 부른다(`PurchaseOrderReceivingManager`)」로 고친다.
- `cancelPurchaseOrder`(`:239-293`):
  - `:254-256` → `if (!acceptsChanges(header.status)) throw new ConflictError(\`Purchase order is already ${header.status}; it cannot be cancelled\`);`
  - `:258-278`(계획 품목 probe + 긴 주석) → 라인을 잠그고 받은 누계를 본다:
```ts
      // 잠금 순서 불변식: 발주 행(위) → 라인 행. 옛 모델은 계획을 잠그지 않아 경합을 감수했다 — 사라졌다.
      const lines = await trx
        .select({ receivedQty: wmsTables.purchaseOrderLines.receivedQty })
        .from(wmsTables.purchaseOrderLines)
        .where(eq(wmsTables.purchaseOrderLines.poId, poId))
        .orderBy(wmsTables.purchaseOrderLines.skuId)
        .for('update');
      if (lines.some((l) => l.receivedQty > 0)) {
        throw new ConflictError('Purchase order already has receipts; close the remaining items instead');
      }
```
- `executeLineOrder`(`:302-343`): `:335-342` 의 `ensurePlanForPurchaseOrder`·`addInboundPlanItems` 두 호출과 그 주석을 **삭제**. 나머지 그대로.
- `lockPurchaseOrderForLineExecution`(`:355-381`): `:369-371` `if (isTerminal(po.status)) throw new BadRequestError(…)` → `if (!acceptsChanges(po.status)) throw new ConflictError(\`Cannot execute purchase order lines with status: ${po.status}\`);`. 주석의 「`inbound_plan_items` 에는 (plan_id, sku_id) 유니크가」 문장(`:379`)은 지운다.
- `refreshHeaderStatus`(`:414-437`) 메서드 **삭제**, 호출 3곳(`:195`·`:225`·`:522`)을 `await this.headerDeriver.refresh(poId, trx);` 로. (셋 다 발주 행을 이미 잠근 뒤다 — `:195`·`:225` 는 `lockPurchaseOrderForLineExecution`, `:522` 는 `:473-478`.)
- `updatePurchaseOrderLines`(`:447-523`): `:488-490` → `if (!acceptsChanges(po.status)) throw new ConflictError('Cannot modify purchase order lines after fully received');`. `:471-472` 의 「400 유지」 주석은 지운다. 재삽입(`:505-515`)에 `expectedArrival: line.expectedArrival ?? null` 추가.
- 파일 안에 `inboundService` 참조가 0이어야 한다: `grep -n inboundService purchase-order.manager.ts` → 없음.

- [ ] **Step 5: DTO·Reader**

`purchase-order.dto.ts` `UpdatePurchaseOrderLineDto`(`:74-88`)에 추가(`OrderPurchaseOrderLineDto:26` 과 같은 모양):
```ts
  @ApiPropertyOptional({ description: '도착예정일 (YYYY-MM-DD)' })
  @IsOptional()
  @Validate(IsCalendarDateConstraint)
  expectedArrival?: string;
```

`purchase-order-response.dto.ts` `PurchaseOrderLineDto` 에 추가(`unavailableReason` 아래):
```ts
  /** 받은 누계 (실발주 라인만 0 보다 클 수 있다) */
  receivedQty: number;
  /** 남은 수량 = ordered ∧ 잔량 포기 아님 일 때 orderedQty − receivedQty, 아니면 0 */
  outstandingQty: number;
  /** 입고 진행 — 카운터 파생(D9). requested/unavailable 은 null */
  receivingProgress: ReceivingProgress | null;
  closedReason: string | null;
  closedAt: Date | null;
```
`ReceivingProgress` 는 `../../services/purchase-order-status.rules` 에서 import. `@ApiProperty` 는 파일의 기존 스타일대로 각 필드에 단다(`enum: ['awaiting','received','short_closed'], nullable: true`).

`purchase-order.reader.ts`:
- `:9` import → `import { lineReceivingProgress, outstandingQty, purchaseOrderExpectedArrival } from './purchase-order-status.rules';`
- 두 라인 select(`:44-64`·`:138-174`)에 `receivedQty`·`closedReason`·`closedAt` 컬럼 추가.
- 두 매핑(`:88-100`·`:186-198`)에 추가:
```ts
          receivedQty: line.receivedQty,
          outstandingQty: outstandingQty(line),
          receivingProgress: lineReceivingProgress(line),
          closedReason: line.closedReason,
          closedAt: line.closedAt,
```
  `outstandingQty(line)` 은 select 결과에 `status`·`orderedQty`·`receivedQty`·`closedAt` 이 있으므로 그대로 넘어간다(구조적 타이핑).

- [ ] **Step 6: 스펙 삭제와 배선**

- `git rm` `purchase-order-single-plan.integration.spec.ts` · `purchase-order-closure.integration.spec.ts` · `purchase-order-closure.adapter.ts`.
- `inbound/inbound.module.ts:6` import 삭제, `:22` → `{ provide: PURCHASE_ORDER_CLOSURE, useValue: { onPlanClosed: async () => undefined } }` (임시 — Task 6 가 port 와 함께 지운다).
- 위 Files 의 배선 6곳: `new PurchaseOrderClosureAdapter()` → `{ onPlanClosed: async () => undefined }`, import 삭제.

- [ ] **Step 7: 통과 확인**

Run: `npm run type-check && npx jest apps/core/src/modules/inventory/procurement && COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-line-execution`
Expected: type-check 0 · 단위 PASS · 통합 PASS(skip 1 — 파이프라인 ①).

- [ ] **Step 8: 커밋**

```bash
git add -A apps/core/src/modules/inventory/procurement apps/core/src/modules/inventory/inbound scripts/local/seed-dev-core/index.ts scripts/qa/seed-qa7-dev.ts apps/core/src/modules/inventory/core/services/inventory-idempotency.integration.spec.ts
git commit -m "refactor(procurement): 헤더 파생 한 경로(PurchaseOrderHeaderDeriver)·관문 acceptsChanges·취소는 라인 잠금 후 received_qty 로 판정·PUT lines 가 예정일 보존·입고 계획 호출 제거

3층 파생(items → plan → PO)과 closure 어댑터·단일 계획 스펙 삭제. 라인 응답에 receivedQty·outstandingQty·receivingProgress·closedReason."
```

---
### Task 4: 커널 — `ArrivalOrigin` 판별 유니온 · `cancelLine` source 가드 · 회차 헤더 `FOR NO KEY UPDATE`

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.ts` (`:10-30` 타입 · `:36-40` `CancelLineInput` · `:87-103` 헤더 insert · `:166-234` `cancelLine` · `:374-382` `loadReceipt`)
- Modify: `apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.integration.spec.ts`
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound.service.ts` (`:934-968` `cancelInbound`)
- Modify: `apps/core/src/modules/inventory/inbound/mappers/inbound.mapper.ts:22` · `dto/inbound-response.dto.ts:72`

**Interfaces:**
- Produces:
```ts
export type InboundReceiptSource = 'direct' | 'purchase_order';
export type ArrivalOrigin =
  | { source: 'direct'; method: DirectArrivalMethod }
  | { source: 'purchase_order' };                       // 커널이 method='planned' 로 기록한다
export type RecordArrivalInput = ArrivalOrigin & { warehouseId; locationId?; reason; lines: ArrivalLineInput[] };
export interface CancelLineInput { receiptLineId: string; quantity?: number; expected: { source: InboundReceiptSource } }
```
`cancelLine(input, tx)` 는 라인 `source ≠ expected.source` 면 `ConflictException` — 메시지는 라인이 `purchase_order` 면 `'발주 입고는 발주에서 취소하세요'`, 그 외 `'이 회차 라인은 직접 입고가 아닙니다'`. 응답 DTO `InboundReceiptLineDto.planItemId` → `source: InboundReceiptSource`.
- Consumes: PR-A 커널 그대로.

- [ ] **Step 1: 실패하는 스펙 3건** — `inbound-receipt.kernel.integration.spec.ts` 에 추가. 기존 헬퍼(시드·`inRollbackTx`·`makeInboundReceiptKernel`)를 그대로 쓴다.

```ts
  it('source=purchase_order 도착은 method=planned 로 기록되고 라인 source 가 purchase_order 다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fx = await seedWarehouseAndSku(tx, randomUUID());   // 기존 헬퍼(:49) — (tx, suffix)
      const result = await kernel.recordArrival(
        {
          source: 'purchase_order',
          warehouseId: fx.warehouseId,
          reason: 'planned_inbound',
          lines: [{ skuId: fx.skuId, quantity: 4, eventKey: `k-${randomUUID()}` }],
        },
        tx,
      );
      expect(result.receipt.method).toBe('planned');
      expect(result.lines[0].source).toBe('purchase_order');
    });
  });

  it('cancelLine 은 expected.source 와 라인 source 가 다르면 409 — source 검증은 여기 한 곳뿐이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fx = await seedWarehouseAndSku(tx, randomUUID());
      const po = await kernel.recordArrival(
        { source: 'purchase_order', warehouseId: fx.warehouseId, reason: 'planned_inbound', lines: [{ skuId: fx.skuId, quantity: 1, eventKey: `k-${randomUUID()}` }] },
        tx,
      );
      await expect(
        kernel.cancelLine({ receiptLineId: po.lines[0].id, expected: { source: 'direct' } }, tx),
      ).rejects.toThrow('발주 입고는 발주에서 취소하세요');

      const direct = await kernel.recordArrival(
        { source: 'direct', method: 'simple', warehouseId: fx.warehouseId, reason: 'simple_inbound', lines: [{ skuId: fx.skuId, quantity: 1, eventKey: `k-${randomUUID()}` }] },
        tx,
      );
      await expect(
        kernel.cancelLine({ receiptLineId: direct.lines[0].id, expected: { source: 'purchase_order' } }, tx),
      ).rejects.toThrow('이 회차 라인은 직접 입고가 아닙니다');
      // 맞는 source 는 통과
      await kernel.cancelLine({ receiptLineId: direct.lines[0].id, expected: { source: 'direct' } }, tx);
    });
  });

  it('cancelLine 은 형제 라인이 남아 있어도 회차 헤더를 FOR NO KEY UPDATE 로 잠근다 (형제 동시 취소 시 voided 누락 경합)', async () => {
    // 두 커넥션: held 가 라인 A 를 취소한 채로 멈추고, probe 가 헤더에 FOR NO KEY UPDATE NOWAIT 를 건다.
    // FOR UPDATE NOWAIT 탐침은 같은 tx 의 작업로그 FK(KEY SHARE)에도 걸려 판별이 안 된다 —
    // NO KEY UPDATE 는 KEY SHARE 와 충돌하지 않으므로, 실패하면 명시적 헤더 잠금이 있는 것이다.
    // 파일에 이미 있는 `probe`(postgres.Sql, :40-46)와 `Rollback`(:47)을 쓴다 — 새로 만들지 않는다.
    {
      let receiptId = '';
      let lineAId = '';
      const seeded = await db.transaction(async (tx) => {
        const fx = await seedWarehouseAndSku(tx as unknown as DbTx, randomUUID());
        const r = await kernel.recordArrival(
          { source: 'direct', method: 'simple', warehouseId: fx.warehouseId, reason: 'simple_inbound',
            lines: [{ skuId: fx.skuId, quantity: 1, eventKey: `k-${randomUUID()}` }, { skuId: fx.skuId, quantity: 1, eventKey: `k-${randomUUID()}` }] },
          tx as unknown as DbTx,
        );
        return { receiptId: r.receipt.id, lineAId: r.lines[0].id, cleanup: fx };
      });
      receiptId = seeded.receiptId;
      lineAId = seeded.lineAId;

      const gate = deferred();
      let probeError: unknown;
      const held = db.transaction(async (tx) => {
        await kernel.cancelLine({ receiptLineId: lineAId, expected: { source: 'direct' } }, tx as unknown as DbTx);
        gate.resolve();
        await new Promise((r) => setTimeout(r, 300));
        throw new Rollback();
      }).catch(() => undefined);
      await gate.promise;
      try {
        await probe`SELECT id FROM inbound_receipts WHERE id = ${receiptId} FOR NO KEY UPDATE NOWAIT`;
      } catch (e) {
        probeError = e;
      }
      await held;
      expect((probeError as { code?: string })?.code).toBe('55P03');
    }
  });
```
이 세 번째 테스트는 **커밋형**(시드가 커밋된다) — 파일의 기존 `seedCommittedLine()`(`:158`)이 같은 방식이므로 그 정리 규약(있으면 따르고, 없으면 러너 DB `core` 가 픽스처 전용이라 남겨도 된다는 `core-integration-tests-local` 메모 근거)을 그대로 따른다. `deferred()` 는 `inbound-plan-concurrent-create.integration.spec.ts:52-60` 의 것을 옮겨온다(그 파일은 Task 6 에서 지워진다). 기존 `expectLineLockedDuring`(`:198`)이 라인 잠금 탐침 선례다 — 헤더 탐침만 `FOR NO KEY UPDATE NOWAIT` 로 다르다.

- [ ] **Step 2: 실패 확인**

Run: `npm run type-check`
Expected: FAIL — `source: 'purchase_order'` 는 `'direct'` 에 할당 불가 · `expected` 속성 없음.

- [ ] **Step 3: 커널 구현**

타입(`:10-30`)을 Interfaces 의 정의로 바꾼다. `recordArrival` 안:
```ts
    const method = input.source === 'direct' ? input.method : 'planned';
```
헤더 insert(`:95`)와 INBOUND 작업 로그(`:151`)의 `method: input.method` → `method`. 라인 insert(`:131`) `source: input.source` 그대로.

`loadReceipt`(`:374-382`)에 `.for('no key update')` 를 붙이고 docstring:
```ts
  /**
   * 회차 헤더를 `FOR NO KEY UPDATE` 로 잠근다 — 형제 라인 두 건이 동시에 취소될 때 둘 다
   * 「아직 남은 형제가 있다」고 읽어 voided 를 놓치는 경합을 직렬화한다.
   * `FOR UPDATE` 가 아니다: 적치·작업 로그 insert 의 FK `KEY SHARE` 와 교착한다(스펙 §7.1).
   */
```
`cancelLine`(`:166-234`): `lockLine` 직후에
```ts
    if (line.source !== input.expected.source) {
      throw new ConflictException(
        line.source === 'purchase_order' ? '발주 입고는 발주에서 취소하세요' : '이 회차 라인은 직접 입고가 아닙니다',
      );
    }
```
`ConflictException` 을 `@nestjs/common` import 에 추가. `:163` 의 「PR-A 에서는 source 를 검사하지 않는다」 주석은 「source 검증은 여기 한 곳뿐이다(스펙 §3.3·§8)」로 바꾼다. 형제 전량 취소 판정(`:220-229`)은 `loadReceipt` 를 **먼저** 부른 뒤 형제 라인을 읽는 순서인지 확인한다(헤더 락 → 형제 read).

- [ ] **Step 4: `/inbound/cancel` 과 응답**

`inbound.service.ts:942` → `this.receiptKernel.cancelLine({ receiptLineId: dto.lineId, quantity: dto.quantity, expected: { source: 'direct' } }, tx)`. `:944-961` 의 계획 품목 복원 블록과 주석을 **삭제**(라인의 `planItemId` 참조가 사라진다). 반환값은 그대로.

`inbound.mapper.ts:22` `planItemId: line.planItemId,` → `source: line.source,`. `inbound-response.dto.ts:72` `planItemId: string | null;` → `source: 'direct' | 'purchase_order';` (`@ApiProperty({ enum: ['direct', 'purchase_order'] })`).

- [ ] **Step 5: 통과 + 잠금 변이 확인**

Run: `npm run type-check && COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "inbound-receipt.kernel|arrival-characterization|same-day-cancel"`
Expected: 모두 PASS (특성화 스펙은 **단언 수정 없이** 초록 — §12 #10).

변이: `loadReceipt` 의 `.for('no key update')` 를 잠시 지우고 같은 명령 → 세 번째 새 테스트만 RED(`55P03` 대신 undefined). 되돌린다.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/inventory/inbound
git commit -m "feat(inbound): 커널 ArrivalOrigin 판별 유니온·cancelLine source 가드(409)·회차 헤더 FOR NO KEY UPDATE — 응답 planItemId → source

source 가드는 PR-B 부터 켠다(스펙 §11 PR-A 창). /inbound/cancel 의 계획 품목 복원 블록 삭제."
```

---
### Task 5: 조달 수령 · 수령 취소 · 잔량 포기 · 예정일 수정 (Manager + 라우트 + 통합 스펙 §12 #1a·#2·#3·#4·#5·#7)

**Files:**
- Create: `apps/core/src/modules/inventory/procurement/dto/purchase-order/receiving.dto.ts`
- Create: `apps/core/src/modules/inventory/procurement/services/purchase-order-receiving.manager.ts`
- Create: `apps/core/src/modules/inventory/procurement/services/purchase-order-receiving.integration.spec.ts`
- Modify: `procurement/services/purchase-order.service.ts` (위임 4) · `procurement/controllers/purchase-order.controller.ts` (라우트 4) · `procurement/procurement.module.ts` (provider) · `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts` (표 4행 추가, `manage (72)`→`(74)` · `operate (65)`→`(67)` 헤더 수)

**Interfaces:**
- Produces:
```ts
// receiving.dto.ts
export class ReceivePurchaseOrderLineDto { skuId: string; quantity: number /* int ≥ 1 */; memo?: string }
export class ReceivePurchaseOrderDto { idempotencyKey: string; warehouseId: string; locationId?: string; lines: ReceivePurchaseOrderLineDto[] /* ≥1, SKU 중복 금지 */ }
export class CancelPurchaseOrderReceiptLineDto { idempotencyKey: string }
export class ShortClosePurchaseOrderLineDto { reason: string /* trim, 1~500 */ }
export class UpdateLineExpectedArrivalDto { expectedArrival: string | null /* YYYY-MM-DD 또는 null */ }
export class PurchaseOrderReceiptResponseDto { receiptId: string; poId: string; lines: { receiptLineId: string; skuId: string; quantity: number }[] }
export class PurchaseOrderReceiptCancelResponseDto { poId: string; skuId: string; quantity: number; receiptLineId: string }

// PurchaseOrderReceivingManager
receive(poId: string, dto: ReceivePurchaseOrderDto, tx?: DbTx): Promise<PurchaseOrderReceiptResponseDto>
cancelReceiptLine(receiptLineId: string, dto: CancelPurchaseOrderReceiptLineDto, tx?: DbTx): Promise<PurchaseOrderReceiptCancelResponseDto>
shortCloseLine(poId: string, skuId: string, dto: ShortClosePurchaseOrderLineDto, userId: string, tx?: DbTx): Promise<PurchaseOrderResponse>
updateLineExpectedArrival(poId: string, skuId: string, dto: UpdateLineExpectedArrivalDto, tx?: DbTx): Promise<PurchaseOrderResponse>
```
- Consumes: `InboundReceiptKernel.recordArrival/cancelLine`(Task 4) · `PurchaseOrderHeaderDeriver.refresh`(Task 3) · `InventoryIdempotencyService.withIdempotency(endpoint, key, body, handler, tx?)` · `PurchaseOrderReader.findById` · 규칙 함수(Task 2).

- [ ] **Step 1: 실패하는 통합 스펙** — `purchase-order-receiving.integration.spec.ts`

시드는 `purchase-order-line-execution.integration.spec.ts:113-166` 의 `seedPrerequisites`/`seedPoWithThreeLines` 를 **복사**해 온다(공용 헬퍼가 없는 게 이 저장소의 규약). 서비스는 `inbound-harness` 의 `buildWiring` 이 private 이므로, `makeInboundReceiptKernel(db)` + `InventoryIdempotencyService(dbService)` + `PurchaseOrderHeaderDeriver` + `PurchaseOrderReader(dbService)` 로 `new PurchaseOrderReceivingManager(dbService, kernel, idempotency, deriver, reader)` 를 조립한다. `dbService` 는 `boundDbService(trx)`(`line-execution` 스펙 `:63-70`) 패턴.

```ts
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * 발주가 수령을 소유한다 (스펙 §12 #1a·#2·#3·#4·#5·#7).
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-receiving.integration
 */
describeIfDb('PurchaseOrderReceivingManager (DB integration)', () => {
  jest.setTimeout(120_000);
  // … beforeAll/afterAll: makeDb 패턴(postgres max 1 + drizzle) …

  async function receivedQtyOf(trx: DbTx, poId: string, skuId: string): Promise<number> { /* select receivedQty */ }
  async function headerStatusOf(trx: DbTx, poId: string): Promise<string> { /* select status */ }
  async function linkedSum(trx: DbTx, poId: string, skuId: string): Promise<number> {
    const [row] = await trx
      .select({ sum: sql<number>`COALESCE(SUM(${wmsTables.inboundReceiptLines.quantity} - ${wmsTables.inboundReceiptLines.canceledQty}), 0)::int` })
      .from(wmsTables.purchaseOrderReceiptLines)
      .innerJoin(wmsTables.inboundReceiptLines, eq(wmsTables.inboundReceiptLines.id, wmsTables.purchaseOrderReceiptLines.receiptLineId))
      .where(and(eq(wmsTables.purchaseOrderReceiptLines.poId, poId), eq(wmsTables.purchaseOrderReceiptLines.skuId, skuId)));
    return Number(row.sum);
  }
  /** 두 라인을 실행한 발주. A=skuIds[0], B=skuIds[1] 각 10. skuIds[2] 는 requested 로 남긴다. */
  async function seedOrderedPo(trx: DbTx) { /* seedPoWithThreeLines + orderLine ×2 via PurchaseOrderManager (Task 3 배선) */ }

  it('#3 수령 한 번 = 회차 1 + RECEIVE 이벤트 + 링크 + received_qty; 파리티 received_qty = Σ(링크 회차 라인 − 취소)', async () => {
    await inRollback(async (trx) => {
      const fx = await seedOrderedPo(trx);
      const res = await mgr.receive(fx.poId, {
        idempotencyKey: randomUUID(), warehouseId: fx.warehouseId,
        lines: [{ skuId: fx.skuIds[0], quantity: 4 }, { skuId: fx.skuIds[1], quantity: 10 }],
      });
      expect(res.lines).toHaveLength(2);
      const [receipt] = await trx.select().from(wmsTables.inboundReceipts).where(eq(wmsTables.inboundReceipts.id, res.receiptId));
      expect(receipt).toMatchObject({ method: 'planned', status: 'posted', totalQuantity: 14, warehouseId: fx.warehouseId });
      const events = await trx.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.warehouseId, fx.warehouseId));
      expect(events.filter((e) => e.transitionType === 'RECEIVE')).toHaveLength(2);
      expect(await receivedQtyOf(trx, fx.poId, fx.skuIds[0])).toBe(4);
      expect(await linkedSum(trx, fx.poId, fx.skuIds[0])).toBe(4);
      expect(await headerStatusOf(trx, fx.poId)).toBe('created'); // skuIds[2] 가 requested
    });
  });

  it('#2ㄱ 분할 발주 — A 전량 입고 뒤 B 실행 → B 가 남은 수량으로 살아 있고 헤더는 confirmed', async () => {
    await inRollback(async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      await poManager.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 10 }, USER_ID);
      await poManager.markLineUnavailable(fx.poId, fx.skuIds[2], {}, USER_ID);
      await mgr.receive(fx.poId, { idempotencyKey: randomUUID(), warehouseId: fx.warehouseId, lines: [{ skuId: fx.skuIds[0], quantity: 10 }] });
      expect(await headerStatusOf(trx, fx.poId)).toBe('created');      // B 아직 requested
      await poManager.orderLine(fx.poId, fx.skuIds[1], { orderedQty: 5 }, USER_ID);
      expect(await headerStatusOf(trx, fx.poId)).toBe('confirmed');    // B 에 남은 수량 5
      const po = await reader.findById(fx.poId, trx);
      expect(po.lines.find((l) => l.skuId === fx.skuIds[1])).toMatchObject({ outstandingQty: 5, receivingProgress: 'awaiting' });
    });
  });

  it('#2ㄴ A 입고 뒤 B 불가 → received (조달 쪽 라인 종결도 파생을 부른다)', async () => {
    await inRollback(async (trx) => {
      const fx = await seedPoWithThreeLines(trx);
      await poManager.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 10 }, USER_ID);
      await mgr.receive(fx.poId, { idempotencyKey: randomUUID(), warehouseId: fx.warehouseId, lines: [{ skuId: fx.skuIds[0], quantity: 10 }] });
      await poManager.markLineUnavailable(fx.poId, fx.skuIds[1], {}, USER_ID);
      await poManager.markLineUnavailable(fx.poId, fx.skuIds[2], {}, USER_ID);
      expect(await headerStatusOf(trx, fx.poId)).toBe('received');
    });
  });

  it('#2ㄷ·#1a received 발주의 당일 수령 취소 → confirmed 로 돌아오고 received_qty 가 준다 (관문 없음)', async () => {
    await inRollback(async (trx) => {
      const fx = await seedOrderedPo(trx);
      await poManager.markLineUnavailable(fx.poId, fx.skuIds[2], {}, USER_ID);
      const res = await mgr.receive(fx.poId, { idempotencyKey: randomUUID(), warehouseId: fx.warehouseId,
        lines: [{ skuId: fx.skuIds[0], quantity: 10 }, { skuId: fx.skuIds[1], quantity: 10 }] });
      expect(await headerStatusOf(trx, fx.poId)).toBe('received');
      const cancelled = await mgr.cancelReceiptLine(res.lines[0].receiptLineId, { idempotencyKey: randomUUID() });
      expect(cancelled).toMatchObject({ poId: fx.poId, skuId: fx.skuIds[0], quantity: 10 });
      expect(await headerStatusOf(trx, fx.poId)).toBe('confirmed');
      expect(await receivedQtyOf(trx, fx.poId, fx.skuIds[0])).toBe(0);
      expect(await linkedSum(trx, fx.poId, fx.skuIds[0])).toBe(0);       // 링크 행은 남고 canceled_qty 가 상쇄
    });
  });

  it('잔량 포기 — 받은 것 0 이어도 되고, 전 라인 잔량 포기면 received', async () => {
    await inRollback(async (trx) => {
      const fx = await seedOrderedPo(trx);
      await poManager.markLineUnavailable(fx.poId, fx.skuIds[2], {}, USER_ID);
      await mgr.receive(fx.poId, { idempotencyKey: randomUUID(), warehouseId: fx.warehouseId, lines: [{ skuId: fx.skuIds[0], quantity: 3 }] });
      const a = await mgr.shortCloseLine(fx.poId, fx.skuIds[0], { reason: '공급처 미발송' }, USER_ID);
      expect(a.lines.find((l) => l.skuId === fx.skuIds[0])).toMatchObject({ receivingProgress: 'short_closed', outstandingQty: 0, closedReason: '공급처 미발송', receivedQty: 3 });
      expect(a.status).toBe('confirmed');
      const b = await mgr.shortCloseLine(fx.poId, fx.skuIds[1], { reason: '단종' }, USER_ID);
      expect(b.status).toBe('received');
      await expect(mgr.shortCloseLine(fx.poId, fx.skuIds[1], { reason: 'x' }, USER_ID)).rejects.toThrow('잔량 포기된 품목입니다');
    });
  });

  it('잔량 포기된 라인의 수령을 취소해도 라인은 잔량 포기로 남는다 (받은 수만 준다)', async () => {
    await inRollback(async (trx) => {
      const fx = await seedOrderedPo(trx);
      const res = await mgr.receive(fx.poId, { idempotencyKey: randomUUID(), warehouseId: fx.warehouseId, lines: [{ skuId: fx.skuIds[0], quantity: 3 }] });
      await mgr.shortCloseLine(fx.poId, fx.skuIds[0], { reason: 'r' }, USER_ID);
      await mgr.cancelReceiptLine(res.lines[0].receiptLineId, { idempotencyKey: randomUUID() });
      const po = await reader.findById(fx.poId, trx);
      expect(po.lines.find((l) => l.skuId === fx.skuIds[0])).toMatchObject({ receivedQty: 0, receivingProgress: 'short_closed', outstandingQty: 0 });
    });
  });

  it('#4 초과 수령 409 + DB CHECK 가 직접 UPDATE 도 거절', async () => {
    await inRollback(async (trx) => {
      const fx = await seedOrderedPo(trx);
      await expect(
        mgr.receive(fx.poId, { idempotencyKey: randomUUID(), warehouseId: fx.warehouseId, lines: [{ skuId: fx.skuIds[0], quantity: 11 }] }),
      ).rejects.toMatchObject({ message: '남은 수량 10개를 넘습니다 — 넘는 분량은 간편입고로 받으세요' });
      await expect(
        trx.execute(sql`SAVEPOINT chk`).then(() =>
          trx.update(wmsTables.purchaseOrderLines).set({ receivedQty: 11 })
            .where(and(eq(wmsTables.purchaseOrderLines.poId, fx.poId), eq(wmsTables.purchaseOrderLines.skuId, fx.skuIds[0]))),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await trx.execute(sql`ROLLBACK TO SAVEPOINT chk`);
    });
  });

  it('#5 거절 표 — 창고 불일치 400 · cancelled 409 · requested/unavailable 409 · 전량 입고 409 · 없는 SKU 404', async () => {
    await inRollback(async (trx) => {
      const fx = await seedOrderedPo(trx);
      const key = () => randomUUID();
      const [otherWh] = await trx.insert(wmsTables.warehouses).values({ name: `rcv-other-${randomUUID().slice(0, 8)}` }).returning();
      await expect(mgr.receive(fx.poId, { idempotencyKey: key(), warehouseId: otherWh.id, lines: [{ skuId: fx.skuIds[0], quantity: 1 }] }))
        .rejects.toBeInstanceOf(BadRequestError);
      await expect(mgr.receive(fx.poId, { idempotencyKey: key(), warehouseId: fx.warehouseId, lines: [{ skuId: fx.skuIds[2], quantity: 1 }] }))
        .rejects.toMatchObject({ message: expect.stringContaining('아직 주문 전인 품목입니다') });
      await poManager.markLineUnavailable(fx.poId, fx.skuIds[2], {}, USER_ID);
      await expect(mgr.receive(fx.poId, { idempotencyKey: key(), warehouseId: fx.warehouseId, lines: [{ skuId: fx.skuIds[2], quantity: 1 }] }))
        .rejects.toMatchObject({ message: expect.stringContaining('발주 불가로 종결된 품목입니다') });
      await mgr.receive(fx.poId, { idempotencyKey: key(), warehouseId: fx.warehouseId, lines: [{ skuId: fx.skuIds[0], quantity: 10 }] });
      await expect(mgr.receive(fx.poId, { idempotencyKey: key(), warehouseId: fx.warehouseId, lines: [{ skuId: fx.skuIds[0], quantity: 1 }] }))
        .rejects.toMatchObject({ message: expect.stringContaining('이미 전량 입고된 품목입니다') });
      await expect(mgr.receive(fx.poId, { idempotencyKey: key(), warehouseId: fx.warehouseId, lines: [{ skuId: randomUUID(), quantity: 1 }] }))
        .rejects.toBeInstanceOf(NotFoundError);
      await mgr.cancelReceiptLine((await linkOf(trx, fx.poId, fx.skuIds[0])).receiptLineId, { idempotencyKey: key() });
      await poManager.cancelPurchaseOrder(fx.poId, { reason: 'x' }, USER_ID);
      await expect(mgr.receive(fx.poId, { idempotencyKey: key(), warehouseId: fx.warehouseId, lines: [{ skuId: fx.skuIds[0], quantity: 1 }] }))
        .rejects.toMatchObject({ message: '취소된 발주입니다' });
    });
  });

  it('#7 멱등 — 같은 키 재시도 = 회차 1개, 응답 동일', async () => {
    await inRollback(async (trx) => {
      const fx = await seedOrderedPo(trx);
      const dto = { idempotencyKey: randomUUID(), warehouseId: fx.warehouseId, lines: [{ skuId: fx.skuIds[0], quantity: 2 }] };
      const first = await mgr.receive(fx.poId, dto);
      const second = await mgr.receive(fx.poId, dto);
      expect(second.receiptId).toBe(first.receiptId);
      expect(await receivedQtyOf(trx, fx.poId, fx.skuIds[0])).toBe(2);
    });
  });

  it('예정일 수정 — requested 와 남은 수량 있는 ordered 만, null 로 비울 수 있다, received 발주는 409', async () => {
    await inRollback(async (trx) => {
      const fx = await seedOrderedPo(trx);
      const r1 = await mgr.updateLineExpectedArrival(fx.poId, fx.skuIds[2], { expectedArrival: '2026-10-05' });
      expect(r1.lines.find((l) => l.skuId === fx.skuIds[2])?.expectedArrival).toBe('2026-10-05');
      const r2 = await mgr.updateLineExpectedArrival(fx.poId, fx.skuIds[0], { expectedArrival: null });
      expect(r2.lines.find((l) => l.skuId === fx.skuIds[0])?.expectedArrival).toBeNull();
      await mgr.receive(fx.poId, { idempotencyKey: randomUUID(), warehouseId: fx.warehouseId, lines: [{ skuId: fx.skuIds[1], quantity: 10 }] });
      await expect(mgr.updateLineExpectedArrival(fx.poId, fx.skuIds[1], { expectedArrival: '2026-10-06' })).rejects.toBeInstanceOf(ConflictError);
    });
  });
});
```

`linkOf(trx, poId, skuId)` 는 링크 테이블에서 첫 행을 읽는 작은 헬퍼. `USER_ID = randomUUID()` 상수. `poManager` 는 Task 3 의 `new PurchaseOrderManager(dbService, reader, deriver)`.

- [ ] **Step 2: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-receiving.integration`
Expected: 컴파일 실패(모듈 없음).

- [ ] **Step 3: DTO**

`receiving.dto.ts` — class-validator. 한 요청 안 중복 SKU 는 커스텀 제약으로:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min, Validate, ValidateIf, ValidateNested,
  ValidatorConstraint, ValidatorConstraintInterface,
} from 'class-validator';
import { IsCalendarDateConstraint } from '../../../shared/dto/calendar-date.validator';

@ValidatorConstraint({ name: 'uniqueSkuIds' })
class UniqueSkuIdsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!Array.isArray(value)) return false;
    const ids: string[] = [];
    for (const line of value) {
      if (typeof line !== 'object' || line === null || !('skuId' in line) || typeof line.skuId !== 'string') return false;
      ids.push(line.skuId);
    }
    return new Set(ids).size === ids.length;
  }
  defaultMessage() {
    return '같은 품목이 두 번 들어 있습니다';
  }
}

export class ReceivePurchaseOrderLineDto {
  @ApiProperty() @IsUUID() skuId: string;
  @ApiProperty({ description: '1 이상 정수' }) @IsInt({ message: '수량은 1 이상의 정수여야 합니다' }) @Min(1, { message: '수량은 1 이상이어야 합니다' }) quantity: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) memo?: string;
}

export class ReceivePurchaseOrderDto {
  @ApiProperty() @IsString() @IsNotEmpty() idempotencyKey: string;
  @ApiProperty({ description: '요청한 현장의 창고. 발주 출발 창고와 같아야 한다' }) @IsUUID() warehouseId: string;
  @ApiPropertyOptional({ description: '비우면 입고기본존' }) @IsOptional() @IsUUID() locationId?: string;
  @ApiProperty({ type: [ReceivePurchaseOrderLineDto] })
  @IsArray() @ArrayMinSize(1, { message: '받을 품목이 없습니다' }) @ValidateNested({ each: true }) @Type(() => ReceivePurchaseOrderLineDto)
  @Validate(UniqueSkuIdsConstraint)
  lines: ReceivePurchaseOrderLineDto[];
}

export class CancelPurchaseOrderReceiptLineDto {
  @ApiProperty() @IsString() @IsNotEmpty() idempotencyKey: string;
}

export class ShortClosePurchaseOrderLineDto {
  @ApiProperty({ description: '잔량 포기 사유' })
  @IsString() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsNotEmpty({ message: '사유를 입력하세요' }) @MaxLength(500)
  reason: string;
}

export class UpdateLineExpectedArrivalDto {
  @ApiProperty({ nullable: true, description: 'YYYY-MM-DD 또는 null(비움)' })
  @ValidateIf((_, v) => v !== null) @Validate(IsCalendarDateConstraint)
  expectedArrival: string | null;
}

export class PurchaseOrderReceiptLineResultDto {
  @ApiProperty() receiptLineId: string;
  @ApiProperty() skuId: string;
  @ApiProperty() quantity: number;
}
export class PurchaseOrderReceiptResponseDto {
  @ApiProperty() receiptId: string;
  @ApiProperty() poId: string;
  @ApiProperty({ type: [PurchaseOrderReceiptLineResultDto] }) lines: PurchaseOrderReceiptLineResultDto[];
}
export class PurchaseOrderReceiptCancelResponseDto {
  @ApiProperty() poId: string;
  @ApiProperty() skuId: string;
  @ApiProperty() quantity: number;
  @ApiProperty() receiptLineId: string;
}
```

- [ ] **Step 4: Manager**

```ts
import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundReceiptKernel } from '../../inbound/kernel/inbound-receipt.kernel';
import { InventoryIdempotencyService } from '../../core/services/inventory-idempotency.service';
import { PurchaseOrderHeaderDeriver } from './purchase-order-header.deriver';
import { PurchaseOrderReader } from './purchase-order.reader';
import { acceptsChanges, outstandingQty } from './purchase-order-status.rules';
import { PurchaseOrderResponse } from '../dto/purchase-order.dto';
import {
  CancelPurchaseOrderReceiptLineDto, PurchaseOrderReceiptCancelResponseDto, PurchaseOrderReceiptResponseDto,
  ReceivePurchaseOrderDto, ShortClosePurchaseOrderLineDto, UpdateLineExpectedArrivalDto,
} from '../dto/purchase-order/receiving.dto';

const STATUS_LABEL: Record<'created' | 'confirmed' | 'received' | 'cancelled', string> = {
  created: '생성됨', confirmed: '확정됨', received: '입고완료', cancelled: '취소됨',
};

/**
 * 발주가 자기 수령을 소유한다(스펙 §6.1·§7). 현장 작업(회차·원장·작업 로그)은 커널이 한다.
 *
 * 🔴 잠금 순서 불변식: 발주 행 FOR UPDATE → 발주 라인 FOR UPDATE(sku_id 순) → 커널.
 * 커널은 발주 행·라인을 잠그지 않는다. 헤더 파생은 끝에서 한 번, 잠금 안에서.
 */
@Injectable()
export class PurchaseOrderReceivingManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly kernel: InboundReceiptKernel,
    private readonly idempotency: InventoryIdempotencyService,
    private readonly headerDeriver: PurchaseOrderHeaderDeriver,
    private readonly reader: PurchaseOrderReader,
  ) {}

  async receive(poId: string, dto: ReceivePurchaseOrderDto, tx?: DbTx): Promise<PurchaseOrderReceiptResponseDto> {
    return this.idempotency.withIdempotency('purchase_order.receive', dto.idempotencyKey, { poId, ...dto }, async (trx) => {
      const po = await this.lockHeader(trx, poId);
      if (po.status === 'cancelled') throw new ConflictError('취소된 발주입니다');
      if (po.sourceWarehouseId !== dto.warehouseId) {
        const [wh] = await trx.select({ name: wmsTables.warehouses.name }).from(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, po.sourceWarehouseId)).limit(1);
        throw new BadRequestError(`이 발주는 ${wh?.name ?? po.sourceWarehouseId}에서 받습니다`);
      }
      const skuIds = [...new Set(dto.lines.map((l) => l.skuId))].sort();
      const lines = await this.lockLines(trx, poId, skuIds);
      const bySku = new Map(lines.map((l) => [l.skuId, l]));
      for (const req of dto.lines) {
        const line = bySku.get(req.skuId);
        if (!line) throw new NotFoundError(`발주에 없는 품목입니다: ${req.skuId}`);
        if (line.status === 'requested') throw new ConflictError(`아직 주문 전인 품목입니다: ${req.skuId}`);
        if (line.status === 'unavailable') throw new ConflictError(`발주 불가로 종결된 품목입니다: ${req.skuId}`);
        if (line.closedAt !== null) throw new ConflictError(`잔량 포기된 품목입니다: ${req.skuId}`);
        const outstanding = outstandingQty(line);
        if (outstanding === 0) throw new ConflictError(`이미 전량 입고된 품목입니다: ${req.skuId}`);
        if (req.quantity > outstanding) throw new ConflictError(`남은 수량 ${outstanding}개를 넘습니다 — 넘는 분량은 간편입고로 받으세요`);
      }

      const arrival = await this.kernel.recordArrival(
        {
          source: 'purchase_order',
          warehouseId: dto.warehouseId,
          locationId: dto.locationId,
          reason: 'planned_inbound',
          lines: dto.lines.map((l, i) => ({ skuId: l.skuId, quantity: l.quantity, memo: l.memo, eventKey: `purchase_order.receive:${dto.idempotencyKey}:${i}` })),
        },
        trx,
      );
      await trx.insert(wmsTables.purchaseOrderReceiptLines).values(
        arrival.lines.map((l) => ({ poId, skuId: l.skuId, receiptLineId: l.id })),
      );
      for (const l of arrival.lines) {
        const line = bySku.get(l.skuId)!;   // 위 검증에서 존재 확인됨 (정당화 주석)
        await trx.update(wmsTables.purchaseOrderLines)
          .set({ receivedQty: line.receivedQty + l.quantity })
          .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.skuId, l.skuId)));
      }
      await this.headerDeriver.refresh(poId, trx);
      return { receiptId: arrival.receipt.id, poId, lines: arrival.lines.map((l) => ({ receiptLineId: l.id, skuId: l.skuId, quantity: l.quantity })) };
    }, tx);
  }

  async cancelReceiptLine(receiptLineId: string, dto: CancelPurchaseOrderReceiptLineDto, tx?: DbTx): Promise<PurchaseOrderReceiptCancelResponseDto> {
    return this.idempotency.withIdempotency('purchase_order.receipt.cancel', dto.idempotencyKey, { receiptLineId }, async (trx) => {
      const [link] = await trx.select().from(wmsTables.purchaseOrderReceiptLines).where(eq(wmsTables.purchaseOrderReceiptLines.receiptLineId, receiptLineId)).limit(1);
      if (!link) throw new NotFoundError('발주 입고 라인이 아닙니다');
      await this.lockHeader(trx, link.poId);             // 관문 없음 — received 에서 나가는 유일한 길(D10)
      const [line] = await this.lockLines(trx, link.poId, [link.skuId]);
      const cancelled = await this.kernel.cancelLine({ receiptLineId, expected: { source: 'purchase_order' } }, trx);
      await trx.update(wmsTables.purchaseOrderLines)
        .set({ receivedQty: line.receivedQty - cancelled.quantity })
        .where(and(eq(wmsTables.purchaseOrderLines.poId, link.poId), eq(wmsTables.purchaseOrderLines.skuId, link.skuId)));
      await this.headerDeriver.refresh(link.poId, trx);
      return { poId: link.poId, skuId: link.skuId, quantity: cancelled.quantity, receiptLineId };
    }, tx);
  }

  async shortCloseLine(poId: string, skuId: string, dto: ShortClosePurchaseOrderLineDto, userId: string, tx?: DbTx): Promise<PurchaseOrderResponse> {
    return this.dbService.run(async (trx) => {
      const po = await this.lockHeader(trx, poId);
      if (po.status === 'cancelled') throw new ConflictError('취소된 발주입니다');
      const [line] = await this.lockLines(trx, poId, [skuId]);
      if (!line) throw new NotFoundError(`발주에 없는 품목입니다: ${skuId}`);
      if (line.status === 'requested') throw new ConflictError('아직 주문 전인 품목입니다');
      if (line.status === 'unavailable') throw new ConflictError('발주 불가로 종결된 품목입니다');
      if (line.closedAt !== null) throw new ConflictError('이미 잔량 포기된 품목입니다');
      if (outstandingQty(line) === 0) throw new ConflictError('이미 전량 입고된 품목입니다');
      await trx.update(wmsTables.purchaseOrderLines)
        .set({ closedReason: dto.reason, closedAt: new Date(), closedBy: userId })
        .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.skuId, skuId)));
      await this.headerDeriver.refresh(poId, trx);
      return this.reader.findById(poId, trx);
    }, tx);
  }

  async updateLineExpectedArrival(poId: string, skuId: string, dto: UpdateLineExpectedArrivalDto, tx?: DbTx): Promise<PurchaseOrderResponse> {
    return this.dbService.run(async (trx) => {
      const po = await this.lockHeader(trx, poId);
      if (!acceptsChanges(po.status)) throw new ConflictError(`${STATUS_LABEL[po.status]} 발주는 예정일을 수정할 수 없습니다`);
      const [line] = await this.lockLines(trx, poId, [skuId]);
      if (!line) throw new NotFoundError(`발주에 없는 품목입니다: ${skuId}`);
      if (line.status !== 'requested' && outstandingQty(line) === 0) throw new ConflictError('더 받을 것이 없는 품목은 예정일을 수정할 수 없습니다');
      await trx.update(wmsTables.purchaseOrderLines)
        .set({ expectedArrival: dto.expectedArrival })
        .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.skuId, skuId)));
      return this.reader.findById(poId, trx);
    }, tx);
  }

  private async lockHeader(tx: DbTx, poId: string) {
    const [po] = await tx.select().from(wmsTables.purchaseOrders).where(eq(wmsTables.purchaseOrders.id, poId)).limit(1).for('update');
    if (!po) throw new NotFoundError(`발주를 찾을 수 없습니다: ${poId}`);
    return po;
  }

  /** sku_id 오름차순으로 잠근다 — 두 요청이 같은 두 라인을 다른 순서로 잡는 교착을 막는다. */
  private async lockLines(tx: DbTx, poId: string, skuIds: string[]) {
    if (skuIds.length === 0) return [];
    return tx.select().from(wmsTables.purchaseOrderLines)
      .where(and(eq(wmsTables.purchaseOrderLines.poId, poId), inArray(wmsTables.purchaseOrderLines.skuId, skuIds)))
      .orderBy(wmsTables.purchaseOrderLines.skuId)
      .for('update');
  }
}
```

`receivedQty` 갱신은 잠근 행의 값 + 수량이다(잠금 안이라 안전). `ck_po_lines_received` 가 마지막 방어선이다.

- [ ] **Step 5: Service 위임 · 컨트롤러 · 모듈 · 스코프 표**

`purchase-order.service.ts` 생성자에 `private readonly receiving: PurchaseOrderReceivingManager` 추가, 위임 4개:
```ts
  receive(poId: string, dto: ReceivePurchaseOrderDto, tx?: DbTx) { return this.receiving.receive(poId, dto, tx); }
  cancelReceiptLine(receiptLineId: string, dto: CancelPurchaseOrderReceiptLineDto, tx?: DbTx) { return this.receiving.cancelReceiptLine(receiptLineId, dto, tx); }
  shortCloseLine(poId: string, skuId: string, dto: ShortClosePurchaseOrderLineDto, userId: string, tx?: DbTx) { return this.receiving.shortCloseLine(poId, skuId, dto, userId, tx); }
  updateLineExpectedArrival(poId: string, skuId: string, dto: UpdateLineExpectedArrivalDto, tx?: DbTx) { return this.receiving.updateLineExpectedArrival(poId, skuId, dto, tx); }
```

`purchase-order.controller.ts` — `cancel`(`:251`) 뒤에 4 라우트. `receipt-lines/:receiptLineId/cancel` 은 `@Get(':id')` 와 메서드가 달라 충돌하지 않는다(`:213` 주석과 같은 이유); `@Post('receipt-lines/:receiptLineId/cancel')` 을 `@Post(':id/cancel')` **앞**에 둔다(둘 다 POST 이고 세그먼트 수가 3 으로 같다 — `:id/cancel` 은 2세그먼트라 실제로는 안 겹치지만 정적 세그먼트 우선 배치를 관례로).
```ts
  @Post(':poId/receipts')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '발주 수령 — 한 회차에 여러 SKU. 멱등키 필수' })
  @ApiResponse({ status: 201, type: PurchaseOrderReceiptResponseDto })
  @ApiResponse({ status: 409, description: '취소된 발주 · 주문 전/불가/전량 입고/잔량 포기 품목 · 남은 수량 초과' })
  async receive(@Param('poId') poId: string, @Body() dto: ReceivePurchaseOrderDto): Promise<PurchaseOrderReceiptResponseDto> {
    return this.purchaseOrderService.receive(poId, dto);
  }

  @Post('receipt-lines/:receiptLineId/cancel')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '발주 수령 취소 — 당일·전량·적치/회송 전. 발주 id 는 링크에서 찾는다' })
  @HttpCode(HttpStatus.OK)
  async cancelReceiptLine(@Param('receiptLineId') receiptLineId: string, @Body() dto: CancelPurchaseOrderReceiptLineDto): Promise<PurchaseOrderReceiptCancelResponseDto> {
    return this.purchaseOrderService.cancelReceiptLine(receiptLineId, dto);
  }

  @Post(':poId/lines/:skuId/short-close')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '잔량 포기 — 남은 수량 > 0 인 라인. 받은 것 0 이어도 된다' })
  @HttpCode(HttpStatus.OK)
  async shortCloseLine(@Param('poId') poId: string, @Param('skuId') skuId: string, @Body() dto: ShortClosePurchaseOrderLineDto, @User() user: JwtPayload): Promise<PurchaseOrderResponse> {
    return this.purchaseOrderService.shortCloseLine(poId, skuId, dto, user.userId);
  }

  @Patch(':poId/lines/:skuId/expected-arrival')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '예정일 수정 — requested 또는 남은 수량 > 0 인 ordered. null 로 비울 수 있다' })
  async updateLineExpectedArrival(@Param('poId') poId: string, @Param('skuId') skuId: string, @Body() dto: UpdateLineExpectedArrivalDto): Promise<PurchaseOrderResponse> {
    return this.purchaseOrderService.updateLineExpectedArrival(poId, skuId, dto);
  }
```
`Patch` 를 `@nestjs/common` import 에 추가. `procurement.module.ts` providers·exports 에 `PurchaseOrderReceivingManager`(InboundModule 이 `InboundReceiptKernel` 을 export 하므로 주입 가능; `InventoryIdempotencyService` 는 `CoreInventoryModule` 이 export 하는지 확인 — `inbound.module.ts` 가 같은 import 로 쓰고 있다).

`inventory-scope-coverage.spec.ts`: operate 블록에 `'POST /purchase-orders/:poId/receipts': S.OPERATE,` · `'POST /purchase-orders/receipt-lines/:receiptLineId/cancel': S.OPERATE,`; manage 블록(`:129-141`)에 `'POST /purchase-orders/:poId/lines/:skuId/short-close': S.MANAGE,` · `'PATCH /purchase-orders/:poId/lines/:skuId/expected-arrival': S.MANAGE,`. 헤더 주석의 숫자(`operate (65)`→`(67)`, `manage (72)`→`(74)`)는 Task 6 에서 삭제 5건을 반영해 최종값으로 다시 고친다.

- [ ] **Step 6: 통과 확인**

Run: `npm run type-check && npx jest apps/core/src/platform/auth/inventory-scope-coverage && COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "purchase-order-receiving.integration|purchase-order-line-execution"`
Expected: 모두 PASS (11 + 기존).

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/inventory/procurement apps/core/src/platform/auth/inventory-scope-coverage.spec.ts
git commit -m "feat(procurement): 발주 수령·수령 취소·잔량 포기·예정일 수정 — 발주 행→라인→커널 잠금, 한국어 거절, 멱등 purchase_order.receive/receipt.cancel

결함 ㄱ·ㄴ·ㄷ 회귀 스펙(§12 #2)·파리티(#3)·초과 수령 409+CHECK(#4)·거절 표(#5)·멱등(#7)."
```

---
### Task 6: 옛 입고예정 경로 삭제 — 서비스 메서드 · 라우트 5 · DTO · 포트 · 규칙 · 셀메이트 import · 스펙 · dev 시드

**Files:**
- Modify: `inbound/services/inbound.service.ts` (삭제: `getInboundPending` `:176-341` · `createInboundPlan` `:507-574` · `ensurePlanForPurchaseOrder` `:576-608` · `addInboundPlanItems` `:610-627` · `listInboundPlanItems` `:629-661` · `receiveFromPlan` `:663-779` · `closePlanItem` `:781-863` · `closePlanIfDone` `:865-888`; `listInboundWorkLogs:414` 의 `planItemId` 컬럼; 생성자 `:41-51`)
- Modify: `inbound/controllers/inbound.controllers.ts` (삭제 `:85-93` pending · `:272-322` plans 4 라우트와 `JwtPayload`·`User` import)
- Modify: `inbound/dto/simple-inbound.dto.ts` (삭제 `CreateInboundPlanDto`·`InboundPlanItemInputDto`·`AddInboundPlanItemsDto`·`ListPlanItemsQueryDto`·`ReceiveFromPlanDto`·`InboundPendingResponse`·`InboundPendingListResponse` `:160-320` 부근) · Delete `inbound/dto/close-plan-item.dto.ts`
- Delete: `inbound/services/inbound-plan-closure.rules.ts` (+`.spec.ts`) · `shared/ports/purchase-order-closure.port.ts` · `inbound/services/inbound-plan-port-invariant.integration.spec.ts` · `inbound-plan-concurrent-create.integration.spec.ts` · `inbound.service.cancel-plan-restore.integration.spec.ts` · `inbound.service.plan-receive.integration.spec.ts` · `apps/core/scripts/import-inbound-plans.ts`
- Modify: `inbound/inbound.module.ts` (`PURCHASE_ORDER_CLOSURE` 임시 provider 제거) · `inbound/services/__fixtures__/inbound-harness.ts:61-73` · `inbound.service.idempotency.spec.ts` · `inbound.controllers.spec.ts:79-88` · `core/services/inventory-idempotency.integration.spec.ts:56-65` · `procurement/services/purchase-order-line-execution.integration.spec.ts:78-89` · `procurement/dto/purchase-order.dto.spec.ts:27`(`InboundPlanItemInputDto` 케이스 삭제) · `inbound.service.same-day-cancel.integration.spec.ts:73-129`
- Modify: `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts` (5행 삭제, 헤더 수 최종: operate 65 −3 +2(Task 5) +1(Task 7) = **65**, manage 72 −2 +2 = **72**)
- Modify: `scripts/local/seed-dev-core/inbound.ts` · `index.ts:111-120,148` · `seed.integration.spec.ts:415-450` · `scripts/qa/seed-qa7-dev.ts:79-87`

**Interfaces:**
- Produces: `InboundService` 생성자 **5인자** `(dbService, skuCatalogService, eventStore, idempotency, receiptKernel)` — `commandService`·`locationService`(옛 `receiveFromPlan` 만 썼다)·`poClosure` 제거. `seedInbound(receiving: PurchaseOrderReceivingManager, tx: DbTx)`.
- Consumes: Task 5 `PurchaseOrderReceivingManager`.

- [ ] **Step 1: 실패하는 단언 — 컨트롤러·멱등 스펙**

`inbound.controllers.spec.ts:86-88` 의 「`POST /inbound/plans/receive` 핸들러는 남아 있다」 → 반대로:
```ts
  it.each(['receiveFromPlan', 'getInboundPending', 'addInboundPlanItems', 'listInboundPlanItems', 'closePlanItem'])(
    '%s 핸들러는 없다 — 입고예정은 발주 라인이고 수령은 발주 라우트가 소유한다(PR-B)',
    (handler) => {
      expect((InboundController.prototype as unknown as Handlers)[handler]).toBeUndefined();
    },
  );
```
describe 위 주석(`:75-78`)의 「`createInboundPlan` 메서드 자체는 남는다」 문장을 지운다.

`inbound.service.idempotency.spec.ts`: `CASES` 에서 `receiveFromPlan` 행 삭제, `build()` 의 생성자를 `new InboundService({} as never, {} as never, {} as never, idempotency, {} as never)` 로.

Run: `npx jest apps/core/src/modules/inventory/inbound/controllers apps/core/src/modules/inventory/inbound/services/inbound.service.idempotency`
Expected: 컨트롤러 스펙 5건 FAIL(핸들러가 아직 있다) · 멱등 스펙 컴파일 FAIL(인자 수).

- [ ] **Step 2: 삭제**

위 Files 목록대로 지운다. `inbound.service.ts` 에서 지운 뒤 남는 import 정리(`earliestExpectedDate`·`isItemClosed`·`PURCHASE_ORDER_CLOSURE`·DTO 타입). 생성자:
```ts
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly skuCatalogService: SkuCatalogService,
    private readonly eventStore: StockEventStore,
    private readonly idempotency: InventoryIdempotencyService,
    private readonly receiptKernel: InboundReceiptKernel,
  ) {}
```
`listInboundWorkLogs`(`:392-443`) select 에서 `planItemId` 줄 삭제. `inbound.module.ts` 에서 `PURCHASE_ORDER_CLOSURE` provider 와 import 삭제(Task 3 의 임시 stub). 배선 5곳을 5인자로 맞춘다(`inbound-harness.ts` `makeInboundService`: `new InboundService(dbService, skuCatalog as never, eventStore, idempotency, new InboundReceiptKernel(command, location, eventStore))`; `inventory-idempotency.integration.spec.ts` 같은 모양; `purchase-order-line-execution` 의 `buildInboundService` 는 **통째로 지운다** — Task 3 에서 Manager 가 더는 InboundService 를 받지 않는다; `seed-qa7-dev.ts`·`seed-dev-core/index.ts` 같은 모양).

`same-day-cancel` 스펙의 `seedReceivedLine`(`:73-129`): 계획·품목 insert 와 `receiveFromPlan` 을 지우고 `svc.simpleInbound({ warehouseId: warehouse.id, items: [{ skuId: sku.id, quantity: 20 }], idempotencyKey: randomUUID() }, tx)` 로 바꾼다(응답의 `lines[0].id` 가 `lineId`). 발주·공급처 시드는 더 이상 필요 없으니 지운다. 단언은 그대로.

`purchase-order.dto.spec.ts:27` 의 `InboundPlanItemInputDto` import 와 그 케이스(`expectedDate` 검증)를 지운다 — 남은 세 DTO 케이스는 그대로.

`inventory-scope-coverage.spec.ts`: `'GET /inbound/pending'`·`'GET /inbound/plans/items'`·`'POST /inbound/plans/receive'`(operate) · `'POST /inbound/plans/:planId/items/:itemId/close'`·`'POST /inbound/plans/items'`(manage) 5행 삭제. 헤더 주석 숫자 최종화(Task 5·7 의 추가분까지 합산: operate **65 − 3 + 2(Task 5) + 1(Task 7) = 65**, manage **72 − 2 + 2 = 72**).

- [ ] **Step 3: dev 시드를 새 모델로**

`scripts/local/seed-dev-core/inbound.ts` — 시그니처 `export async function seedInbound(receiving: PurchaseOrderReceivingManager, tx: DbTx)`. 계획·품목 insert 전부 삭제. 발주는 그대로(국내 2라인 `ordered` 40·25, 해외 1라인 `ordered` 60 — `executedLine()` 유지, `EXPECTED_DATE` 유지). 해외 발주 부분 수령 20 을 **수령 Manager 로**:
```ts
  // 해외 발주: 중국 창고에서 20 부분 수령 — 회차·원장·링크·received_qty 가 실제 경로로 생긴다.
  await receiving.receive(
    foreignPo.id,
    {
      idempotencyKey: `dev-seed-po-receive-${SEED_SKUS[2].code}`,
      warehouseId: SEED_IDS.warehouseChina,
      locationId: SEED_IDS.locChinaReceiving,
      lines: [{ skuId: SEED_SKUS[2].id, quantity: 20 }],
    },
    tx,
  );
```
국내 발주는 수령 없음(입고 대기 목록에 2라인이 떠야 한다). 옛 `sourcePlan.status='receiving'`/`destinationPlan` 갱신 삭제. 헤더 `status` 를 직접 insert 할 때는 `'confirmed'` 그대로 — `receive` 끝의 파생이 다시 계산한다(해외 발주는 20/60 이라 `confirmed` 유지).

`index.ts:111-120`: `InboundService` 5인자, 그리고
```ts
    const headerDeriver = new PurchaseOrderHeaderDeriver();
    const poReader = new PurchaseOrderReader(dbService);
    const receiving = new PurchaseOrderReceivingManager(
      dbService,
      new InboundReceiptKernel(wired.command, wired.location, wired.eventStore),
      idempotency,
      headerDeriver,
      poReader,
    );
```
`:148` → `await seedInbound(receiving, tx);`. `SEED_IDS.warehouseChina` 는 `constants.ts` 에 이미 있는 이름을 쓴다(`inbound.ts` 의 기존 해외 발주 `sourceWarehouseId` 값이 그것이다).

`seed.integration.spec.ts:415-450`: 계획 3건 단언을 지우고 대체:
```ts
    it('해외 발주는 20/60 부분 수령이고 국내 발주는 수령 0 이다', async () => {
      const lines = await db.select().from(wmsTables.purchaseOrderLines);
      const foreign = lines.find((l) => l.skuId === SEED_SKUS[2].id)!;
      expect(foreign).toMatchObject({ status: 'ordered', orderedQty: 60, receivedQty: 20, closedAt: null });
      const links = await db.select().from(wmsTables.purchaseOrderReceiptLines).where(eq(wmsTables.purchaseOrderReceiptLines.skuId, SEED_SKUS[2].id));
      expect(links).toHaveLength(1);
      expect(lines.filter((l) => l.skuId !== SEED_SKUS[2].id).every((l) => l.receivedQty === 0)).toBe(true);
    });
```

`apps/core/scripts/import-inbound-plans.ts` 를 `git rm` 한다(D6). 런북 갱신은 Task 12.

- [ ] **Step 4: 통과 확인**

Run: `npm run type-check && npx jest --maxWorkers=2 apps/core/src/modules/inventory apps/core/src/platform/auth && COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "inbound|purchase-order|inventory-idempotency"`
Expected: type-check 0 · 단위 0 실패 · 통합 새 실패 0. 그리고 `grep -rn "inboundPlans\|inboundPlanItems\|planItemId\|PURCHASE_ORDER_CLOSURE\|receiveFromPlan" apps/core/src scripts/ --include=*.ts` 의 결과가 **`inventory.schema.ts`(테이블·컬럼·relations)·`inbound-pipeline.reader.ts`·`lead-time-profile.refresher.ts`·`view-parity.integration.spec.ts`·`inbound-pipeline.integration.spec.ts`·`replenishment-suggestion.integration.spec.ts`·`lead-time-profile.refresher.integration.spec.ts`** 에만 남는다(Task 7 이 지운다).

dev 시드 재실행: `npm run dev:core:reset` → 성공. `npm run test:seed-dev-core:integration` → PASS.

- [ ] **Step 5: 커밋**

```bash
git add -A apps/core/src apps/core/scripts scripts/local/seed-dev-core scripts/qa/seed-qa7-dev.ts
git commit -m "refactor(inbound): 옛 입고예정 경로 삭제 — 계획 생성·품목·예정 수령·잎 종결·pending 라우트 5·종결 포트·셀메이트 import (D1·D6)

InboundService 생성자 5인자. dev 시드는 발주 수령 Manager 로 20/60 부분 수령을 만든다."
```

---
### Task 7: 읽기 전환 — 중립 `GET /inventory/expected-arrivals` · 파이프라인 ①·전사 · 리드타임 · 스토어프론트 동기화 · 파리티 스펙 (§9 · §12 #8·#12)

**Files:**
- Create: `procurement/services/purchase-order-outstanding.sql.ts`
- Create: `procurement/services/purchase-order-expected-arrival.reader.ts`
- Create: `stock-projection/dto/expected-arrivals.dto.ts` · `stock-projection/services/expected-arrivals.reader.ts` · `stock-projection/services/expected-arrivals-parity.integration.spec.ts`
- Modify: `stock-projection/controllers/stock-projection.controller.ts` (라우트 추가) · `services/stock-projection.service.ts` (위임) · `stock-projection.module.ts` (`ProcurementModule` import · provider) · `services/inbound-pipeline.reader.ts` (`readOnOrder`·`readOnOrderTotal` → 조달 reader) · `services/inbound-pipeline.integration.spec.ts` · `replenishment/suggestion/replenishment-suggestion.integration.spec.ts` · `shared/availability/view-parity.integration.spec.ts` · `replenishment/demand/lead-time-profile.refresher.ts:119-151` (+`.integration.spec.ts:85-120`) · `procurement/services/purchase-order-line-execution.integration.spec.ts`(Task 3 의 `it.skip` 해제) · `apps/channel-adapter/scripts/sync-restock-to-medusa.ts:34-50` · `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts`(operate +1)
- Modify: `procurement/procurement.module.ts` (reader export)

**Interfaces:**
- Produces:
```ts
// purchase-order-outstanding.sql.ts — drizzle SQL 조각. VIEW(Task 1)·동기화 스크립트와 같은 식.
export function outstandingLineWhere(): SQL   // pol.status='ordered' AND pol.closed_at IS NULL AND pol.received_qty < COALESCE(pol.ordered_qty,0) AND po.status <> 'cancelled'  (wmsTables.purchaseOrderLines·purchaseOrders 컬럼 참조)
export function outstandingQtySql(): SQL<number>  // COALESCE(pol.ordered_qty,0) - pol.received_qty

// purchase-order-expected-arrival.reader.ts
export interface ExpectedArrivalLineRow { skuId; skuName; skuCode; orderedQty; receivedQty; outstandingQty; expectedArrival: string | null }
export interface ExpectedArrivalRow { poId; type: 'domestic'|'foreign'; supplier: { id; name } | null; warehouseId; expectedDate: string | null /* 남은 수량 있는 라인의 MIN */; totalOutstandingQuantity; lines: ExpectedArrivalLineRow[] }
class PurchaseOrderExpectedArrivalReader {
  listByWarehouse(warehouseId: string, tx?: DbTx): Promise<ExpectedArrivalRow[]>          // 발주별 묶음, 남은 수량 있는 라인만, expectedDate ASC NULLS LAST, poId
  sumOutstandingBySku(skuIds: string[], scope: 'non_sellable_source' | 'all', tx?: DbTx): Promise<Map<string, { qty: number; eta: Date | null }>>
}

// stock-projection
export class ExpectedArrivalLineDto { skuId; skuName; skuCode; orderedQty; receivedQty; outstandingQty; expectedArrival: string | null }
export class ExpectedArrivalDto { source: 'purchase_order'; documentId: string; type; supplier: {id;name}|null; expectedDate: string|null; totalOutstandingQuantity; lines: ExpectedArrivalLineDto[] }
export class ExpectedArrivalsResponseDto { warehouseId: string; totalDocuments: number; totalOutstandingQuantity: number; arrivals: ExpectedArrivalDto[] }
class ExpectedArrivalsReader { listByWarehouse(warehouseId: string, tx?: DbTx): Promise<ExpectedArrivalsResponseDto> }  // 조달 reader 를 조합. 이동 지시서가 커널에 올라오면 여기 합류
GET /inventory/expected-arrivals?warehouseId=<uuid>  (OPERATE, ParseUUIDPipe)
```
- Consumes: Task 1 스키마 · Task 2 `outstandingQty`.

- [ ] **Step 1: 실패하는 파리티 스펙** — `expected-arrivals-parity.integration.spec.ts`

```ts
/**
 * 읽기 파리티(스펙 §12 #8) + 스토어프론트 동기화 SQL 실행(#12).
 * 입고 대기 잔량 = VIEW inbound_pending_qty = 파이프라인 ①(비판매 출발 창고)·전사 합계 = 헤더 도착예정일.
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- expected-arrivals-parity
 */
describeIfDb('입고예정 읽기 파리티 (DB integration)', () => {
  // 시드: 비판매 출발 창고(중국 역할)·판매 창고(부천 역할)·공급처·SKU 2 — 해외 발주(출발=비판매, 목적=판매) 라인 A ordered 10 ETA 2026-09-20, 라인 B ordered 5 ETA 2026-09-15, B 는 2 수령(receivedQty 직접 UPDATE 로 충분 — 회차는 파리티 대상이 아니다). 그리고 국내 발주(출발=판매 창고) 라인 A ordered 7. 취소된 발주 하나에 ordered 라인 3 을 심어 어디에도 안 잡히는지 본다.
  it('창고별 입고 대기 = VIEW inbound_pending_qty', async () => { /* expected-arrivals(비판매 창고) A 10 · B 3 ; VIEW (skuA, 비판매) 10 · (skuB, 비판매) 3 ; (skuA, 판매) 7 */ });
  it('파이프라인 ① = 비판매 출발 창고 남은 수량, 전사 = 창고 불문 합', async () => { /* readOnOrder A 10 B 3 eta A 2026-09-20 B 2026-09-15 ; total A 17 B 3 */ });
  it('헤더 도착예정일 = 목록의 expectedDate (남은 수량 있는 라인의 MIN)', async () => { /* 해외 발주: reader.findById expectedArrival 2026-09-15T00:00Z ; 목록 expectedDate '2026-09-15' */ });
  it('취소된 발주의 ordered 라인은 어디에도 잡히지 않는다', async () => {});
  it('#12 스토어프론트 동기화 SQL 이 실제 DB 에서 돈다', async () => {
    // sync-restock-to-medusa.ts 에서 RESTOCK_SQL 을 export 해 import 한다(스크립트 본문은 `require.main === module` 가드).
    const rows = await trx.execute(sql.raw(RESTOCK_SQL));
    expect(Array.isArray(rows)).toBe(true);   // product_* 조인이라 시드가 없으면 0행 — 실행 자체가 검증 대상이다
  });
});
```
각 it 의 본문은 위 주석의 수치를 단언으로 옮긴다. `RESTOCK_SQL` import 는 `apps/channel-adapter/scripts/sync-restock-to-medusa` 상대 경로(`../../../../../../channel-adapter/scripts/sync-restock-to-medusa`) — jest `moduleNameMapper` 에 걸리지 않는 상대 경로라 tsconfig path 문제가 없다. 스크립트 상단의 `dotenv`/env 읽기가 import 시점에 실행되면 안 되므로 Step 5 에서 `main()` 가드를 건다.

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- expected-arrivals-parity`
Expected: 컴파일 FAIL.

- [ ] **Step 2: 조달 SQL 조각 + reader**

`purchase-order-outstanding.sql.ts`:
```ts
import { sql, SQL } from 'drizzle-orm';
import { wmsTables } from '../../schema/inventory.schema';

const pol = wmsTables.purchaseOrderLines;
const po = wmsTables.purchaseOrders;

/**
 * 남은 수량이 있는 실발주 라인(스펙 §5.1). `purchase-order-status.rules.ts` 의 `outstandingQty` 와 같은 식이고,
 * `stock_summary_view` 의 inbound_pending 서브쿼리·`sync-restock-to-medusa.ts` 도 같은 식을 손으로 든다 —
 * 파리티는 `expected-arrivals-parity.integration.spec.ts` 가 고정한다. 호출자가 purchaseOrders 를 조인해야 한다.
 */
export function outstandingLineWhere(): SQL {
  return sql`${pol.status} = 'ordered' AND ${pol.closedAt} IS NULL AND ${pol.receivedQty} < COALESCE(${pol.orderedQty}, 0) AND ${po.status} <> 'cancelled'`;
}
export function outstandingQtySql(): SQL<number> {
  return sql<number>`COALESCE(${pol.orderedQty}, 0) - ${pol.receivedQty}`;
}
```

`purchase-order-expected-arrival.reader.ts`: `@Injectable`, `@InjectTypedDb` DbService. `listByWarehouse` 는 한 쿼리로 라인을 뽑아(`purchaseOrderLines ⋈ purchaseOrders ⋈ skus ⋈ suppliers(left)`, `where(and(eq(po.sourceWarehouseId, warehouseId), outstandingLineWhere()))`, `orderBy(po.id, pol.skuId)`) 메모리에서 발주별로 묶는다. `expectedDate` = 그 발주의 남은 라인 `expectedArrival` 중 최소(문자열 비교, null 제외). 정렬: `expectedDate` ASC NULLS LAST → `poId`. `sumOutstandingBySku(skuIds, scope)`:
```ts
    const rows = await trx
      .select({ skuId: pol.skuId, qty: sql<number>`SUM(${outstandingQtySql()})::int`, eta: sql<string | null>`MIN(${pol.expectedArrival})` })
      .from(pol)
      .innerJoin(po, eq(po.id, pol.poId))
      .where(and(outstandingLineWhere(), inArray(pol.skuId, skuIds),
        scope === 'non_sellable_source' ? not(inSellableWarehouse(po.sourceWarehouseId)) : undefined))
      .groupBy(pol.skuId);
    return new Map(rows.map((r) => [r.skuId, { qty: Number(r.qty), eta: r.eta ? new Date(r.eta) : null }]));
```
`inSellableWarehouse` 는 `shared/availability/sellable-warehouses.ts`(중립 층 — 조달이 import 해도 방향 위반이 아니다). `procurement.module.ts` providers·exports 에 추가.

- [ ] **Step 3: 중립 reader · DTO · 라우트 · 모듈**

`expected-arrivals.reader.ts`:
```ts
@Injectable()
export class ExpectedArrivalsReader {
  constructor(private readonly purchaseOrders: PurchaseOrderExpectedArrivalReader) {}
  /** 여러 문서를 합칠 자리(스펙 §9). 지금은 발주뿐이다 — 이동 지시서가 커널에 올라오면 여기 합류한다. */
  async listByWarehouse(warehouseId: string, tx?: DbTx): Promise<ExpectedArrivalsResponseDto> {
    const rows = await this.purchaseOrders.listByWarehouse(warehouseId, tx);
    const arrivals = rows.map((r) => ({ source: 'purchase_order' as const, documentId: r.poId, type: r.type, supplier: r.supplier, expectedDate: r.expectedDate, totalOutstandingQuantity: r.totalOutstandingQuantity, lines: r.lines }));
    return { warehouseId, totalDocuments: arrivals.length, totalOutstandingQuantity: arrivals.reduce((s, a) => s + a.totalOutstandingQuantity, 0), arrivals };
  }
}
```
DTO 클래스는 `inbound-pipeline.dto.ts` 스타일로 `@ApiProperty`. 컨트롤러(`stock-projection.controller.ts`) `getInboundPipeline`(`:120`) 아래:
```ts
  @Get('/expected-arrivals')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '입고 대기 목록 — 남은 수량이 있는 문서(지금은 발주)별 묶음', description: '옛 GET /inbound/pending 을 대체한다(PR-B).' })
  @ApiQuery({ name: 'warehouseId', required: true })
  @ApiResponse({ status: 200, type: ExpectedArrivalsResponseDto })
  async listExpectedArrivals(@Query('warehouseId', new ParseUUIDPipe()) warehouseId: string): Promise<ExpectedArrivalsResponseDto> {
    return this.stockProjection.listExpectedArrivals(warehouseId);
  }
```
`stock-projection.service.ts` 에 `listExpectedArrivals(warehouseId, tx?)` 위임 + 생성자 주입. `stock-projection.module.ts` imports 에 `ProcurementModule`, providers 에 `ExpectedArrivalsReader`. 순환 확인: Procurement → Inbound/Core/Shared 뿐이고 StockProjection 을 import 하는 건 Replenishment·InventoryModule — 순환 없음(계획 작성 시 확인).

`inventory-scope-coverage.spec.ts` operate 블록에 `'GET /inventory/expected-arrivals': S.OPERATE,`.

- [ ] **Step 4: 파이프라인 reader · 리드타임 · 스펙 이관**

`inbound-pipeline.reader.ts`: 생성자에 `private readonly purchaseOrders: PurchaseOrderExpectedArrivalReader` 추가. `readOnOrder`(`:74-108`) 본문 → `return this.purchaseOrders.sumOutstandingBySku(skuIds, 'non_sellable_source', trx);` · `readOnOrderTotal`(`:110-128`) → `const m = await this.purchaseOrders.sumOutstandingBySku(skuIds, 'all', trx); return new Map([...m].map(([k, v]) => [k, v.qty]));`. 클래스 docstring 의 「pending 계획」 표현을 「남은 수량이 있는 실발주 라인」으로. `TODO(#743 A+B)` 주석 삭제(계획이 없다). `wmsTables.inboundPlanItems`·`inboundPlans` 참조 0 확인. `stock-projection` 은 중립 층이라 조달 reader import 가 허용된다(ADR-0032 결정 4 방향).

`lead-time-profile.refresher.ts:121-129` CTE:
```sql
      WITH first_receipt AS (
        SELECT porl.po_id, porl.sku_id, MIN(ir.occurred_at) AS received_at
        FROM purchase_order_receipt_lines porl
        JOIN inbound_receipt_lines irl ON irl.id = porl.receipt_line_id AND irl.canceled_qty < irl.quantity
        JOIN inbound_receipts ir ON ir.id = irl.receipt_id AND ir.status = 'posted'
        GROUP BY porl.po_id, porl.sku_id
      ),
```
(취소된 회차 라인은 제외 — 옛 식엔 없던 조건이지만 취소된 수령을 도착으로 세는 건 틀렸다.) docstring `:119` 「같은 PO 계획의 같은 SKU 아이템에 붙은 첫 posted 입고」 → 「링크된 첫 posted 회차」.

스펙 이관(각각 옛 계획 insert → 새 모델):
- `lead-time-profile.refresher.integration.spec.ts:85-120`: 계획·품목 insert 삭제, 회차 라인 insert 뒤 `purchaseOrderReceiptLines` 에 `{ poId, skuId, receiptLineId: line.id }` insert, 회차 라인의 `planItemId` 제거.
- `inbound-pipeline.integration.spec.ts:96-360`: 계획·품목 insert → 발주(`sourceWarehouseId` 가 옛 `plans.warehouseId`, `destinationWarehouseId` 는 옛 값 그대로) + `purchaseOrderLines` `{ status: 'ordered', orderedQty: expectedQty, receivedQty, expectedArrival: expectedDate, quantity: expectedQty }`. 「아이템 예정일 없으면 계획 날짜로」 케이스(`:323-360`)는 계획 날짜가 없어졌으므로 「라인 예정일 없으면 ETA null」 한 케이스로 합친다. 단언 수치는 그대로.
- `replenishment-suggestion.integration.spec.ts:140-151`: 같은 방식. reader 생성(`:64`)에 `new PurchaseOrderExpectedArrivalReader(dbService)` 인자 추가.
- `view-parity.integration.spec.ts:144-219`: 계획·품목 → 발주 라인. 「도착 창고 쪽은 0」 단언은 `destinationWarehouseId` 로는 잡히지 않음(출발 창고 기준)을 그대로 검증한다.
- `purchase-order-line-execution.integration.spec.ts`: Task 3 의 `it.skip`(파이프라인 ①) 해제, `new InboundPipelineReader(dbService, transferReader, new PurchaseOrderExpectedArrivalReader(dbService))` 로 생성.

- [ ] **Step 5: 스토어프론트 동기화 스크립트**

`sync-restock-to-medusa.ts:34-50` `RESTOCK_SQL` 을 `export const` 로 바꾸고 본문:
```sql
  SELECT pmv.master_id, pm.variant_id,
         MIN(pol.expected_arrival) AS expected_date,
         bool_or(po.type = 'foreign') AS approximate
  FROM purchase_order_lines pol
  JOIN purchase_orders po ON po.id = pol.po_id
  JOIN product_variant_sku_links pvsl ON pvsl.sku_id = pol.sku_id
  JOIN product_matchings pm ON pm.id = pvsl.product_matching_id
  JOIN product_master_variants pmv ON pmv.variant_id = pm.variant_id
  WHERE pol.status = 'ordered'
    AND pol.closed_at IS NULL
    AND pol.received_qty < COALESCE(pol.ordered_qty, 0)
    AND po.status <> 'cancelled'
    AND pol.expected_arrival IS NOT NULL
  GROUP BY pmv.master_id, pm.variant_id
```
헤더 주석 `:5` 의 「입고예정(source plan)」 → 「남은 수량이 있는 발주 라인」. 실행 본문을 `async function main()` 으로 감싸고 파일 끝에 `if (require.main === module) void main();` — 스펙이 SQL 만 import 할 수 있게. env 읽기(`CORE_DB_URL` 등)가 `main()` 안으로 들어가야 한다.

- [ ] **Step 6: 통과 확인**

Run: `npm run type-check && npx jest apps/core/src/platform/auth/inventory-scope-coverage apps/core/src/modules/inventory/stock-projection && COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "expected-arrivals-parity|inbound-pipeline|replenishment-suggestion|view-parity|lead-time-profile|purchase-order-line-execution"`
Expected: 모두 PASS. `grep -rn "inboundPlans\|inboundPlanItems\|planItemId\|inbound_plan" apps/core/src scripts/ apps/channel-adapter --include=*.ts` 결과가 **`inventory.schema.ts` 와 `purchase-order-receiving-backfill-guard.integration.spec.ts` 뿐**이어야 한다.

- [ ] **Step 7: 커밋**

```bash
git add -A apps/core/src apps/channel-adapter/scripts
git commit -m "feat(stock-projection): GET /inventory/expected-arrivals(중립 입고 대기) + 파이프라인·리드타임·스토어프론트 동기화를 발주 라인 기준으로 — 읽기 파리티 스펙"
```

---

### Task 8: 동시성 스펙 — 두 커넥션 (§12 #6)

**Files:**
- Create: `procurement/services/purchase-order-receiving.concurrency.integration.spec.ts`

**Interfaces:**
- Consumes: Task 5 Manager · Task 4 커널 · `inbound-harness` 의 `makeInboundReceiptKernel`.

- [ ] **Step 1: 스펙 작성** — 커밋형(두 트랜잭션이 각자 커밋해야 경합이 재현된다). `postgres(DATABASE_URL, { max: 4 })` 로 `db`, Manager 두 개(`mgrA`·`mgrB`)를 **같은 db 로** 만든다 — `dbService.run` 이 각 호출마다 새 커넥션의 트랜잭션을 연다. 시드 행은 `afterEach` 에서 지운다(FK 순서: 링크 → 회차 라인 → 회차 → 저널/이벤트/원장은 `warehouseId` 로 · 라인 → 발주 → 공급처 · SKU · 홀더 · 로케이션 → 창고). 시드 이름 접두 `cc-po-`.

```ts
  it('같은 라인 동시 수령 2건(7+7 vs 남은 10) — 하나는 409, 합계 초과 없음, 40P01 없음', async () => {
    const fx = await seedCommitted();                        // ordered 10
    const call = (mgr: PurchaseOrderReceivingManager) => mgr.receive(fx.poId, { idempotencyKey: randomUUID(), warehouseId: fx.warehouseId, lines: [{ skuId: fx.skuId, quantity: 7 }] });
    const results = await Promise.allSettled([call(mgrA), call(mgrB)]);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect(results.some((r) => r.status === 'rejected' && /40P01/.test(String((r.reason as { code?: string }).code)))).toBe(false);
    expect(await receivedQtyOf(fx)).toBe(7);
    expect(await linkedSum(fx)).toBe(7);
  });
  it('수령 vs 잔량 포기 — 둘 다 성공하지 않는다(한쪽이 409), 결과 정합', async () => { /* receive 10 ∥ shortClose → 성공한 쪽에 따라 received_qty 10·closedAt null 또는 received_qty 0·closedAt 있음 */ });
  it('수령 vs 라인 실행(다른 SKU) — 둘 다 성공하고 헤더는 confirmed', async () => { /* B 는 requested; receive A 10 ∥ orderLine B 5 → 헤더 confirmed, A received 10, B outstanding 5 */ });
  it('적치 vs 발주 수령 취소 — 회차 라인 락에서만 만나 직렬화, 40P01 없음', async () => {
    // receive 10 → putaway 3 ∥ cancelReceiptLine → 적치가 먼저면 취소 400('putaway exists'), 취소가 먼저면 적치 400 — 어느 쪽이든 40P01 없음·카운터 정합
  });
```
`poManager` 는 Task 3 배선. 각 it 마지막에 `expect(pgErrorCodes).not.toContain('40P01')` — 거절 사유 객체의 `code`/`cause.code` 를 모아 검사하는 작은 헬퍼 `collectPgCodes(results)`.

- [ ] **Step 2: 실행**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-receiving.concurrency`
Expected: 4 PASS. 실패하면(특히 40P01) 잠금 순서 위반이다 — Manager 의 `lockHeader`→`lockLines` 순서와 커널이 발주 테이블을 안 만지는지부터 본다. 두 번 더 돌려 플레이키가 아닌지 확인한다.

- [ ] **Step 3: 커밋**

```bash
git add apps/core/src/modules/inventory/procurement/services/purchase-order-receiving.concurrency.integration.spec.ts
git commit -m "test(procurement): 발주 수령 동시성 — 동시 수령·수령 vs 잔량 포기·수령 vs 실행·적치 vs 취소, 40P01 없음 (§12 #6)"
```

---
### Task 9: arch 스펙 확장 — `inbound/` 전체 import 방향 · `PO_FORBIDDEN` 에 라인·링크 테이블 · `/inbound/cancel` source 거절 (§12 #9)

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound-kernel-boundary.arch.spec.ts`
- Modify: `apps/core/src/modules/inventory/inventory-write-boundary.arch.spec.ts:30-32`
- Create: `apps/core/src/modules/inventory/inbound/services/inbound.service.cancel-source-guard.integration.spec.ts`

- [ ] **Step 1: 실패하는 단언**

`inbound-kernel-boundary.arch.spec.ts` 에 `INBOUND_DIR = join(__dirname, 'inbound')` 를 추가하고 새 it:
```ts
  it('inbound/ 전체가 procurement/ · warehouse-transfer/ 를 import 하지 않는다 — 의존은 문서 → 커널 한 방향 (§12 #9a)', () => {
    const violations = collectTsFiles(INBOUND_DIR).flatMap((file) =>
      moduleSpecifiers(file).filter((s) => DOCUMENT_MODULES.test(s)).map((s) => `${file}: ${s}`),
    );
    expect(violations).toEqual([]);
  });
```
`collectTsFiles` 는 `.spec.ts` 를 건너뛰므로 통합 스펙의 procurement import 는 잡히지 않는다(의도). 기존 커널 3 it(트랜잭션 자가 개시·db.query)은 `KERNEL_DIR` 그대로.

`inventory-write-boundary.arch.spec.ts:32`:
```ts
// 발주 헤더·라인·수령 링크는 조달이 소유한다(ADR-0039). 입고·중립 층이 직접 쓰면
// received_qty 정산이 두 모듈로 갈라지고 잠금 취득 지점이 하나 늘어난다.
const PO_FORBIDDEN = [/\.(insert|update|delete)\(\s*(wmsTables\.)?(purchaseOrders|purchaseOrderLines|purchaseOrderReceiptLines)\b/];
```
it 이름 「procurement/ 밖에서 purchaseOrders 직접 쓰기 금지」 → 「procurement/ 밖에서 발주 헤더·라인·수령 링크 쓰기 금지」.

Run: `npx jest apps/core/src/modules/inventory/inbound-kernel-boundary apps/core/src/modules/inventory/inventory-write-boundary`
Expected: Task 6 까지 끝났으면 **둘 다 PASS 여야 한다**(inbound.module 의 adapter import 는 Task 3·6 에서 사라졌고, 테스트 밖에서 발주 테이블을 쓰는 곳은 procurement 뿐). 하나라도 FAIL 이면 위반 목록을 보고 그 파일을 고친다 — 스펙을 완화하지 않는다.

- [ ] **Step 2: `/inbound/cancel` 의 source 거절 통합 스펙(#9c)**

```ts
describeIfDb('POST /inbound/cancel 은 발주 입고 라인을 거절한다', () => {
  it('source=purchase_order 라인 → 409 「발주 입고는 발주에서 취소하세요」, 원장·카운터 불변', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouseId, skuId } = await seed(tx);       // 창고·홀더·SKU (same-day-cancel 스펙의 시드 축약)
      const arrival = await kernel.recordArrival({ source: 'purchase_order', warehouseId, reason: 'planned_inbound', lines: [{ skuId, quantity: 2, eventKey: `k-${randomUUID()}` }] }, tx);
      await expect(svc.cancelInbound({ lineId: arrival.lines[0].id, quantity: 2, idempotencyKey: randomUUID() }, tx))
        .rejects.toMatchObject({ status: 409, message: '발주 입고는 발주에서 취소하세요' });
      const [line] = await tx.select().from(wmsTables.inboundReceiptLines).where(eq(wmsTables.inboundReceiptLines.id, arrival.lines[0].id));
      expect(line.canceledQty).toBe(0);
    });
  });
});
```
`svc = makeInboundService(db)`, `kernel = makeInboundReceiptKernel(db)`. Nest `ConflictException` 은 `getStatus()` 가 409 — `toMatchObject({ status: 409 })` 대신 `expect(e.getStatus()).toBe(409)` 로 잡아도 된다.

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- cancel-source-guard`
Expected: PASS.

- [ ] **Step 3: 커밋**

```bash
git add apps/core/src/modules/inventory/inbound-kernel-boundary.arch.spec.ts apps/core/src/modules/inventory/inventory-write-boundary.arch.spec.ts apps/core/src/modules/inventory/inbound/services/inbound.service.cancel-source-guard.integration.spec.ts
git commit -m "test(inventory): arch 가드 확장 — inbound/ 전체 import 방향·발주 라인/링크 쓰기 금지·/inbound/cancel 의 발주 입고 409 (§12 #9)"
```

---
### Task 10: admin-web — 발주 드로어·목록·입고 대기 탭·이력 탭 (§10.2 · §12 #14)

admin-web 은 컴포넌트 테스트가 불가하다(jest `testRegex` 가 `.spec.ts` 만). **판정은 `.ts` 순수 함수**에 두고 `.tsx` 는 그것을 부르기만 한다. 게이트: `cd apps/admin-web && npx tsc --noEmit` · `npm run test:admin-web`.

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts` (`PurchaseOrderLineDto:1249-1267` 필드 추가 · `UpdatePurchaseOrderLinesRequest:1310` 에 `expectedArrival?` · `InboundReceiptLineDto:513` `planItemId`→`source` · 삭제 `ReceiveFromPlanDto:451`·`ListPlanItemsQueryDto:494`·`InboundPlanItemDto:572`·`InboundPlanItemsResponse:584`·`ReceiveFromPlanResponseDto:589`·`InboundPendingItemDto:594`·`InboundPendingDto:603`·`InboundPendingListResponseDto:623`·`ClosePlanItemRequest:1331`·`InboundPlanType:390`·`CreateInboundPlanDto`/`InboundPlanItemInputDto`/`AddInboundPlanItemsDto:431-449` · 추가: 수령/취소/잔량 포기/예정일 요청·응답 타입, `ExpectedArrivals*` 응답 타입)
- Modify: `apps/admin-web/src/lib/api/domains/inventory/purchase-orders.client.ts` (+`receive`·`cancelReceiptLine`·`shortCloseLine`·`updateLineExpectedArrival`) · `inbound.client.ts` (삭제 `pending:65`·`closePlanItem:104`·`plans:129-142`)
- Create: `apps/admin-web/src/lib/api/domains/inventory/expected-arrivals.client.ts` (`list(warehouseId)` → `GET /inventory/expected-arrivals?warehouseId=`)
- Modify: `apps/admin-web/src/lib/services/inventory/query-keys.ts` (삭제 `inboundPending:53`·`inboundPlanItems:61`; 추가 `expectedArrivalsRoot: ['expected-arrivals'] as const` · `expectedArrivals: (warehouseId: string) => ['expected-arrivals', warehouseId] as const`) · `queries.ts:211-243` (`useInboundPending`·`useInboundPlanItems` 삭제, `useExpectedArrivals(warehouseId: string | undefined)` 추가 — `enabled: !!warehouseId`) · `mutations.ts` (`useReceiveFromPlan:780`·`useClosePlanItem:667` 삭제; `useReceivePurchaseOrder`·`useCancelPurchaseOrderReceiptLine`(둘 다 `useIdempotentMutation`)·`useShortClosePurchaseOrderLine`·`useUpdatePurchaseOrderLineExpectedArrival` 추가, `onSettled` 에서 `lineExecutionInvalidationKeys(poId)` + `inventoryQueryKeys.expectedArrivalsRoot`) · `line-execution-invalidation.ts:22-24` (반환에 `inventoryQueryKeys.expectedArrivalsRoot` 추가) · `line-execution-invalidation.spec.ts`
- Modify: `apps/admin-web/src/features/inventory/purchase-orders/line-execution-model.ts` · `.spec.ts`
- Modify: `.../purchase-orders/components/line-list/index.tsx` · `purchase-order-detail-drawer/index.tsx` · `purchase-order-form-dialog/index.tsx`(라인 수정 시 `expectedArrival` 을 실어 보낸다 — `partitionLinesForEdit` 의 editable 라인 값을 그대로) · `apps/admin-web/src/hooks/table/columns/use-purchase-orders-table-columns.tsx`
- Create: `.../purchase-orders/components/line-execution/short-close-dialog.tsx` · `expected-arrival-dialog.tsx`
- Modify: `.../inbound/components/pending-tab/index.tsx` · `pending-tab/plan-detail-drawer/index.tsx`(→ 이름 `arrival-detail-drawer/index.tsx`) · `apps/admin-web/src/hooks/table/columns/use-inbound-pending-table-columns.tsx` · `history-tab/receipt-detail-drawer/index.tsx:153-158` · `line-action-menu/cancel-dialog.tsx`

**Interfaces (순수 함수 — `line-execution-model.ts`):**
```ts
export type ReceivingProgress = 'awaiting' | 'received' | 'short_closed';
export type LineProgress = { total; requested; ordered; unavailable; awaiting; received; shortClosed };
export function summarizeLines(lines: PurchaseOrderLineDto[]): LineProgress;        // 입고 진행 3 카운트 추가
export function formatLineProgress(p: LineProgress): string;                         // '2/3 실행 · 1 불가 · 입고 1/2 · 포기 1'
export function acceptsChanges(s: PurchaseOrderStatus): boolean;                    // 서버와 같은 exhaustive 표
export function isDerivationFrozen(s: PurchaseOrderStatus): boolean;
export function canExecuteLines(s: PurchaseOrderStatus): boolean;                   // = acceptsChanges
export function canCancel(po: Pick<PurchaseOrderDto, 'status' | 'lines'>): boolean; // acceptsChanges && lines.every(l => l.receivedQty === 0)
export function canShortClose(poStatus: PurchaseOrderStatus, line: PurchaseOrderLineDto): boolean;         // status!=='cancelled' && line.outstandingQty > 0
export function canEditExpectedArrival(poStatus: PurchaseOrderStatus, line: PurchaseOrderLineDto): boolean; // acceptsChanges && (line.status==='requested' || line.outstandingQty > 0)
export function formatLineReceiving(line: PurchaseOrderLineDto): string | null;     // '받음 3 (남음 2)' | '전량 입고' | '잔량 포기' | null
```
`isTerminalPoStatus` 는 **삭제**.

- [ ] **Step 1: 실패하는 `.spec.ts`** — `line-execution-model.spec.ts` 의 `line()` 픽스처(`:15-28`)에 `receivedQty: 0, outstandingQty: 0, receivingProgress: null, closedReason: null, closedAt: null` 을 넣고, `canCancel` describe(`:110-122`)를 바꾸고 새 describe 를 추가:

```ts
describe('관문 표 (서버 purchase-order-status.rules 와 같은 4×2)', () => {
  it.each([['created', true, false], ['confirmed', true, false], ['received', false, false], ['cancelled', false, true]] as const)(
    '%s → acceptsChanges=%s · isDerivationFrozen=%s', (s, a, f) => { expect(acceptsChanges(s)).toBe(a); expect(isDerivationFrozen(s)).toBe(f); });
});
describe('canCancel', () => {
  it('부분 입고된 발주는 화면에서 걸러진다 — receivedQty 로 판정', () => {
    expect(canCancel(po({ status: 'confirmed', lines: [line({ status: 'ordered', orderedQty: 10, receivedQty: 3, outstandingQty: 7, receivingProgress: 'awaiting' })] }))).toBe(false);
  });
  it('입고 0 이면 취소 가능, received/cancelled 는 불가', () => {
    expect(canCancel(po({ status: 'confirmed', lines: [line({ status: 'ordered', orderedQty: 10, outstandingQty: 10, receivingProgress: 'awaiting' })] }))).toBe(true);
    expect(canCancel(po({ status: 'received', lines: [] }))).toBe(false);
    expect(canCancel(po({ status: 'cancelled', lines: [] }))).toBe(false);
  });
});
describe('canShortClose / canEditExpectedArrival / formatLineReceiving', () => {
  const awaiting = line({ status: 'ordered', orderedQty: 10, receivedQty: 3, outstandingQty: 7, receivingProgress: 'awaiting' });
  const done = line({ status: 'ordered', orderedQty: 10, receivedQty: 10, outstandingQty: 0, receivingProgress: 'received' });
  const closed = line({ status: 'ordered', orderedQty: 10, receivedQty: 0, outstandingQty: 0, receivingProgress: 'short_closed', closedReason: 'x' });
  it('잔량 포기는 남은 수량 > 0 인 라인, cancelled 발주 제외', () => {
    expect(canShortClose('confirmed', awaiting)).toBe(true);
    expect(canShortClose('confirmed', done)).toBe(false);
    expect(canShortClose('received', awaiting)).toBe(true);     // 헤더 관문 없음(§5.3)
    expect(canShortClose('cancelled', awaiting)).toBe(false);
  });
  it('예정일 수정은 requested 또는 남은 수량 > 0, 그리고 acceptsChanges', () => {
    expect(canEditExpectedArrival('created', line())).toBe(true);
    expect(canEditExpectedArrival('confirmed', awaiting)).toBe(true);
    expect(canEditExpectedArrival('confirmed', done)).toBe(false);
    expect(canEditExpectedArrival('received', awaiting)).toBe(false);
  });
  it('입고 진행 문구', () => {
    expect(formatLineReceiving(awaiting)).toBe('받음 3 (남음 7)');
    expect(formatLineReceiving(done)).toBe('전량 입고');
    expect(formatLineReceiving(closed)).toBe('잔량 포기');
    expect(formatLineReceiving(line())).toBeNull();
  });
  it('라인 진행 문구에 입고 진행이 붙는다', () => {
    expect(formatLineProgress(summarizeLines([awaiting, done, closed, line({ status: 'unavailable' })]))).toBe('3/4 실행 · 1 불가 · 입고 1/3 · 포기 1');
  });
});
```
`line-execution-invalidation.spec.ts` 에 「`expected-arrivals` 루트 키가 포함된다」 단언 추가.

Run: `npm run test:admin-web -- line-execution`
Expected: FAIL(함수 없음·시그니처).

- [ ] **Step 2: 순수 함수 구현** — `line-execution-model.ts`. `isTerminalPoStatus`·docstring(`:48-59`) 삭제. `ACCEPTS_CHANGES`·`DERIVATION_FROZEN` 표는 서버 Task 2 와 글자 그대로. `canCancel` docstring 을 「새 응답은 라인에 `receivedQty` 를 실으므로 서버와 같은 판정을 한다」로. `summarizeLines` 는 `line.receivingProgress` 로 `awaiting`/`received`/`shortClosed` 를 센다. `formatLineProgress`: 기존 두 조각 뒤에 `ordered > 0` 이면 `입고 ${received}/${ordered}`, `shortClosed > 0` 이면 `포기 ${shortClosed}`.

- [ ] **Step 3: 타입·클라이언트·훅** — Files 대로. `expected-arrivals.client.ts`:
```ts
export const expectedArrivalsClient = {
  list: async (warehouseId: string): Promise<ExpectedArrivalsResponseDto> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/inventory/expected-arrivals?warehouseId=${encodeURIComponent(warehouseId)}`);
    return response.data;
  },
};
```
`purchase-orders.client.ts` 추가 4개(경로는 Global Constraints 의 신설 라우트; `receive` 는 `WithIdempotencyKey<ReceivePurchaseOrderRequest>` 본문 + `Idempotency-Key` 헤더는 `useIdempotentMutation` 관례대로 `inbound.client.ts:89-102` 와 같은 모양).

- [ ] **Step 4: 발주 화면** — `line-list/index.tsx:84-91` 문구를 「요청 7 → 실발주 5 · 받음 3 (남음 2) · 도착예정 9/20」 로: `formatLineReceiving(line)` 이 null 이 아니면 ` · ${…}` 를 붙인다. 버튼: `[실행][불가]` 는 `isLineExecutable` 그대로, 추가로 `canEditExpectedArrival(po.status, line)` 이면 `[예정일 수정]`, `canShortClose(po.status, line)` 이면 `[잔량 포기]`. 두 다이얼로그는 `unavailable-dialog.tsx`(사유 입력 + `getServerDenyMessage`)를 본떠 만든다 — `short-close-dialog.tsx` 는 사유 필수(`maxLength 500`), `expected-arrival-dialog.tsx` 는 `<input type="date">` + 「비우기」 버튼(`expectedArrival: null`). 드로어 `purchase-order-detail-drawer/index.tsx:69` `canCancel(po.status)` → `canCancel(po)`. 목록 컬럼은 `formatLineProgress` 를 그대로 쓰므로 변경 없음. 폼 다이얼로그(`purchase-order-form-dialog/index.tsx`)의 라인 수정 제출 본문에 `expectedArrival: line.expectedArrival ?? undefined` 를 싣는다.

- [ ] **Step 5: 입고 관리** —
- `pending-tab/index.tsx`: `useExpectedArrivals(warehouseId)`, rows = `data?.arrivals ?? []`, `getRowId: row.documentId`, 상단 문구 「입고 대기 {totalDocuments}건 / 남은 수량 {totalOutstandingQuantity}개」. 「바로 입고」 버튼 유지.
- `use-inbound-pending-table-columns.tsx`: 「계획 유형」·「이중 입고」 컬럼 삭제, `PLAN_TYPE_LABELS` 삭제. 컬럼: 공급처 · 발주 유형(`domestic`→국내/`foreign`→해외) · 입고 예정일(`expectedDate`, `DateCell`) · 품목 수 · 남은 수량.
- `arrival-detail-drawer/index.tsx`(옛 `plan-detail-drawer`): `planItemIdMap`·`useInboundPlanItems`(`:45-54`) 삭제. 품목 행 `예정 {orderedQty} / 입고 {receivedQty} / 잔여 {outstandingQty}`. `[입고]` → `useReceivePurchaseOrder().mutateAsync({ poId: row.documentId, warehouseId /* 목록 응답의 warehouseId를 드로어 prop으로 전달 */, locationId, lines: [{ skuId, quantity, memo }] })`. `[잔량 포기]` → `useShortClosePurchaseOrderLine().mutateAsync({ poId, skuId, reason })`. 「이중 입고 계획 — leg-1 상태」 블록(`:143-147`)·`PLAN_TYPE_LABELS`(`:16-19`) 삭제. 사무실 수령 경로는 유지(스펙 §10.2).
- `history-tab/receipt-detail-drawer/index.tsx:153-158`: `[취소]` 를 `line.source === 'purchase_order'` 면 `useCancelPurchaseOrderReceiptLine` 을 여는 `cancel-dialog`(prop `source` 로 분기 — 문구 「발주 입고입니다. 발주 수령을 취소합니다」), `direct` 면 기존 `useCancelInbound`. `cancel-dialog.tsx` 에 `source` prop 추가.

- [ ] **Step 6: 게이트**

Run: `cd apps/admin-web && npx tsc --noEmit && cd ../.. && npm run test:admin-web`
Expected: tsc 0 · jest 0 실패. `grep -rn "planItemId\|inboundPending\|InboundPlan\|plans/receive\|closePlanItem\|isTerminalPoStatus" apps/admin-web/src` → 0건.

- [ ] **Step 7: 커밋**

```bash
git add apps/admin-web/src
git commit -m "feat(admin-web): 발주 드로어 입고 진행·예정일 수정·잔량 포기, 입고 대기를 expected-arrivals 로, 이력 취소를 source 로 분기 — 관문 표는 서버와 같은 4×2"
```

---
### Task 11: 창고 앱 — 입고 대기 목록 · 발주 수령 화면 (§10.1 · §12 #15)

앱은 별도 패키지다: `cd native/warehouse-app && npm ci` 를 먼저(워크트리에 `node_modules` 없음). 테스트 `npm test`(vitest, jsdom). CI 에 없으므로 **로컬 실행이 유일한 게이트**다.

**Files:**
- Modify: `native/warehouse-app/src/domains/inbound/types.ts` (삭제 `PendingPlanItem`·`PendingPlan`·`PendingPlanListResult`·`ReceiveFromPlanInput`·`ReceiveFromPlanResult`; 추가 `ExpectedArrivalLine { skuId; skuName; skuCode; orderedQty; receivedQty; outstandingQty; expectedArrival: string|null }` · `ExpectedArrival { source: 'purchase_order'; documentId; type: 'domestic'|'foreign'; supplier: {id;name}|null; expectedDate: string|null; totalOutstandingQuantity; lines }` · `ExpectedArrivalsResult { warehouseId; totalDocuments; totalOutstandingQuantity; arrivals }` · `ReceivePurchaseOrderInput { poId; warehouseId; lines: {skuId; quantity; memo?}[]; idempotencyKey }` · `ReceivePurchaseOrderResult { receiptId; poId; lines: {receiptLineId; skuId; quantity}[] }` · `CancelPurchaseOrderReceiptInput { receiptLineId; idempotencyKey }`)
- Modify: `queries.ts` (`usePendingPlans`→`useExpectedArrivals(warehouseId)`: `queryKey ['expected-arrivals', warehouseId]`, path `/inventory/expected-arrivals?warehouseId=`) · `mutations.ts` (`useReceiveFromPlan`→`useReceivePurchaseOrder`: `POST /purchase-orders/${poId}/receipts` body `{ idempotencyKey, warehouseId, lines }`, header `idempotencyKey`; 추가 `useCancelPurchaseOrderReceipt`: `POST /purchase-orders/receipt-lines/${receiptLineId}/cancel` body `{ idempotencyKey }`; `invalidateAfterLedgerWrite` 의 `'inbound-pending'` → `'expected-arrivals'`)
- Rename+Modify: `PendingPlanListScreen.tsx`→`ExpectedArrivalListScreen.tsx` · `PlanReceiveScreen.tsx`→`PurchaseOrderReceiveScreen.tsx` (+ 테스트 파일 이름 동일)
- Modify: `ReceiveSheet.tsx`(`PendingPlanItem`→`ExpectedArrivalLine`, 잔여 = `outstandingQty`) · `src/app/routeTree.tsx:125-129` (`/inbound/purchase-orders/$poId`) · `src/app/routes/PlanReceiveRoute.tsx`→`PurchaseOrderReceiveRoute.tsx` · `src/app/routes/InboundRoute.tsx` · `src/core/data/errorMessage.ts`
- Modify: 테스트 `queries.test.tsx` · `mutations.test.tsx` · `PendingPlanListScreen.test.tsx`→`ExpectedArrivalListScreen.test.tsx` · `PlanReceiveScreen.test.tsx`→`PurchaseOrderReceiveScreen.test.tsx` · `src/app/router.handheld.test.tsx:108`

**행동 변화(테스트에 그대로 적는다):**
- 목록 카드 = 발주: 공급처(없으면 「발주처 미상」) · `formatDate(expectedDate)` · `N품목` · 「남은 M」. **「잔여 없는 카드 숨기기」 필터(`:31-33`)는 삭제** — 서버가 남은 수량 있는 문서만 준다.
- 수령 화면: 라우트 파라미터 `poId`; 목록 응답에서 `documentId === poId` 로 고른다. 스캔·탭 → `ReceiveSheet` → `useReceivePurchaseOrder` `lines: [{ skuId, quantity }]`. 응답 `lines[0].receiptLineId` 가 배너의 `lineId`.
- **초과 수령은 서버가 거절한다(D7).** 옛 「초과분 확인 후 그 수량으로 입고」 흐름(`:245-283`)은 **시트가 `outstandingQty` 를 상한으로 막고**, 넘으면 시트 안에 「남은 수량 N개를 넘습니다 — 넘는 분량은 간편입고로 받으세요」 를 보여 제출하지 않는다. 확인 다이얼로그 삭제.
- 취소 = `useCancelPurchaseOrderReceipt({ receiptLineId, idempotencyKey })`. 서버 409(발주 입고인데 `/inbound/cancel` 로 간 경우)는 이 화면에서 나올 수 없다.
- `errorMessage.ts`: `ErrorContext` 에 `'po-receive'` 추가. `ConflictError` 이고 `context === 'po-receive'` 면 **서버 메시지(`error.message`)를 그대로** 돌려준다(한국어 문구가 현장이 읽을 답이다). `CONTEXTUAL['po-receive'] = { 400: '이 발주는 다른 창고에서 받습니다. 창고 선택을 확인해 주세요.', 404: '발주를 찾을 수 없어요. 목록을 새로고침 해주세요.' }`. `httpClient.ts:51-69` 의 409 1회 재시도는 멱등키 덕에 안전 — 그대로.
- 간편입고·적치 대기·적치 시트: 변경 없음.

- [ ] **Step 1: 실패하는 테스트** — 기존 테스트의 픽스처와 경로 단언을 새 API 로 바꾼다. 핵심 it 만 적는다(나머지는 이름 그대로 두고 픽스처만 교체):

`ExpectedArrivalListScreen.test.tsx`:
```tsx
const ARRIVALS: ExpectedArrivalsResult = {
  warehouseId: 'w-1', totalDocuments: 1, totalOutstandingQuantity: 12,
  arrivals: [{ source: 'purchase_order', documentId: 'po-1', type: 'domestic', supplier: { id: 's-1', name: '알몬드상사' }, expectedDate: '2026-09-20', totalOutstandingQuantity: 12,
    lines: [{ skuId: 'sku-1', skuName: '아몬드 1kg', skuCode: 'A-1', orderedQty: 20, receivedQty: 8, outstandingQty: 12, expectedArrival: '2026-09-20' }] }],
};
it('창고별 GET /inventory/expected-arrivals 를 부르고 발주 카드를 남은 수량과 함께 보여준다', …)   // path 단언 '/inventory/expected-arrivals?warehouseId=w-1', 텍스트 '알몬드상사'·'남은 12'
it('카드는 /inbound/purchase-orders/$poId 로 간다', …)
```
「잔여 항목이 없는 예정은 감춘다」 it(`:114-118`) 은 **삭제**.

`PurchaseOrderReceiveScreen.test.tsx` — `:195` it 을:
```tsx
it('입고하면 POST /purchase-orders/:poId/receipts 에 lines 1개를 보내고 결과 배너를 남긴다', async () => {
  // … 스캔 → 시트 → 확인
  expect(receive?.path).toBe('/purchase-orders/po-1/receipts');
  expect(receive?.body).toMatchObject({ warehouseId: 'w-1', lines: [{ skuId: 'sku-1', quantity: 12 }] });
  expect(receive?.idempotencyKey).toBeTruthy();
});
it('남은 수량을 넘는 값은 제출하지 않고 시트 안에 안내한다 (초과 수령은 서버가 거절한다)', …)   // '남은 수량 12개를 넘습니다' 텍스트, request 미호출
it('결과 배너의 취소는 POST /purchase-orders/receipt-lines/:id/cancel 로 간다', …)               // path '/purchase-orders/receipt-lines/rl-1/cancel'
it('서버 409 메시지는 그대로 보인다', …)  // stub 이 ConflictError('이미 전량 입고된 품목입니다: sku-1') → alert 텍스트 동일
```
옛 `'잔여보다 많은 수량을 입력하면 초과분을 명시한 확인 후 그 수량으로 입고한다'`·`'초과 확인 다이얼로그가 뜬 동안 …'` 두 it 삭제.

`queries.test.tsx`·`mutations.test.tsx`·`router.handheld.test.tsx:108`: 경로·키 문자열 교체(`'/inbound/pending?warehouseId=w-1'`→`'/inventory/expected-arrivals?warehouseId=w-1'`, `'inbound-pending'`→`'expected-arrivals'`, `useReceiveFromPlan`→`useReceivePurchaseOrder` 로 `/purchase-orders/po-1/receipts`).

Run: `cd native/warehouse-app && npm test`
Expected: 새 it 들 FAIL.

- [ ] **Step 2: 구현** — Files·행동 변화대로. `routeTree.tsx:125-129`:
```tsx
const inboundPurchaseOrderRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/inbound/purchase-orders/$poId',
  component: PurchaseOrderReceiveRoute,
});
```
`PurchaseOrderReceiveRoute.tsx` 는 `useParams({ strict: false })` 의 `poId`. 화면 안 `keyFor(skuId, quantity)`·`cancelKeyFor(receiptLineId)` 멱등키 회전 로직은 옛 것을 그대로 옮긴다(`:51-71`).

- [ ] **Step 3: 게이트**

Run separately: `cd native/warehouse-app && npm test`; `cd native/warehouse-app && npx tsc -b --noEmit`. 두 명령의 exit code를 각각 확인한다. 테스트 실패를 `||` fallback으로 숨기지 않는다.
Expected: 테스트 0 실패 · 타입 0. `grep -rn "planId\|planItemId\|inbound/pending\|plans/receive\|PendingPlan" native/warehouse-app/src` → 0건.

- [ ] **Step 4: 커밋**

```bash
git add native/warehouse-app/src
git commit -m "feat(warehouse-app): 입고 대기를 expected-arrivals 로, 수령 화면을 발주 수령 라우트로 — 초과 수령은 시트가 막고 서버 409 문구를 그대로 보인다"
```

---
### Task 12: 문서 — ADR-0039 · ADR-0032 표시 · CONTEXT.md · domain.md · 런북 (§13)

**Files:**
- Create: `docs/adr/0039-document-owns-receipt-settlement-kernel-does-arrival.md`
- Modify: `docs/adr/0032-procurement-inbound-transfer-boundaries.md` (결정 1·4 헤더 아래 대체 표시) · `CONTEXT.md:69-76` · `docs/agents/domain.md:5` · `docs/runbooks/selmate-stock-pipeline.md:30,36,71,538-550,782-800,943` · `docs/superpowers/specs/2026-09-14-purchase-order-owns-receiving-design.md`(머리의 자리표시 줄은 이슈가 열린 뒤 링크로 — Task 13)

- [ ] **Step 1: ADR-0039** — `ls docs/adr | tail -3` 로 0039 가 비어 있는지 다시 확인(계획 작성 시 최고 번호 0038). 형식은 `docs/adr/0037*.md` 를 따른다. 내용:
  - 제목: 「문서가 수령 정산을 소유하고, 현장 입고는 공통 커널이 한다」
  - Status: Accepted (2026-09-14). Supersedes ADR-0032 결정 1·4(결정 2·3 유지). 항목 7 스펙(`docs/superpowers/specs/2026-08-27-purchase-order-closure-derivation-design.md`)의 파생 사슬을 대체.
  - Context: 결함 ㄱ·ㄴ·ㄷ 과 8월 ABBA 교착 — 뿌리는 `items → plan → PO` 역류 파생(스펙 §1 표를 요약).
  - Decision: D1~D11 표(스펙 §2)를 **그대로** 옮긴다 — 기각 대안 열 포함.
  - Consequences: 잠금 순서 불변식 한 줄 · 커널 `tx` 필수 · source 가드 한 곳 · `received` 의 뜻 「더 받을 것이 없다」 · 옛 테이블은 PR-C 가 지운다 · 이동 지시서 편입은 범위 밖(§14).
  - 참조: 스펙 경로 · PR-A #867 · 이 PR(번호는 Task 13 뒤 채운다 — 「PR-B: (머지 후 번호)」 자리표시).

- [ ] **Step 2: ADR-0032** — 결정 1 헤더(`:24`)와 결정 4 헤더(`:62`) 바로 아래에 각각:
```
> **대체됨 (2026-09-14, ADR-0039).** 입고 계획 헤더·품목이 사라지고 발주 라인이 입고예정이다. 아래 본문은 역사 기록으로 남긴다.
```
`:16` 표의 `inbound_plans` 행에 「(ADR-0039 로 폐지)」, `:93` 「컬럼은 남긴다」 문장에 「→ PR-C 에서 테이블째 삭제」.

- [ ] **Step 3: CONTEXT.md** — `:69` 헤더의 「입고 계획 (Inbound Plan)」 → 「입고예정 (Expected Arrival)」. `:72` 를 아래로 교체하고 새 용어를 넣는다:
```
- **입고예정**: 남은 수량이 있는 실발주 라인(`ordered ∧ 잔량 포기 아님 ∧ received_qty < ordered_qty`). 별도 문서가 아니다 — 발주 라인이 곧 입고예정이다(ADR-0039). 입고 대기 목록은 `GET /inventory/expected-arrivals` 가 문서를 합쳐 낸다.
- **회차**: 한 번의 입고 기록(`inbound_receipts` + 라인). 입고 커널이 소유한다. 회차 라인은 어느 문서인지 모르고 문서에 묶였다는 사실(`source`)만 안다.
- **입고 커널**: 저널·회차·원장 `RECEIVE`·적치·회송·당일 취소·작업 로그를 하는 입고 모듈의 공통 층. 문서(발주)가 커널을 부르고 커널은 문서를 부르지 않는다.
- **잔량 포기**: 실발주 라인의 남은 수량을 더 받지 않기로 하는 사람의 결정(`closed_at`). 받은 것이 0 이어도 된다.
- **수령 취소**: 발주 입고 회차 라인의 당일·전량 취소. 발주 라우트로만 한다 — `received` 발주에서 나가는 유일한 길이다.
```
`:70` 의 발주 정의 끝에 「`received` 는 **「더 받을 것이 없다」**(전 라인이 전량 입고 또는 잔량 포기)이다.」 `:76` _Avoid_ 줄에서 「한 발주에 입고 계획을 둘 만들기」를 지우고 「입고예정을 발주 밖의 문서로 다시 만들기」를 넣는다.

- [ ] **Step 4: domain.md:5** — 「(Neither exists yet — …)」 괄호를 지우고 「Both exist at the repo root.」로.

- [ ] **Step 5: 런북** — `:30` 파이프라인 줄 「core: inbound_plans / inbound_plan_items」 → 「core: purchase_orders / purchase_order_lines (발주 라인이 입고예정, ADR-0039)」. `:36`·`:943` ③ 설명 「입고예정 → Medusa」 → 「발주 라인 남은 수량·예정일 → Medusa」. `:71` 의 `<import-inbound|match-sku|sync-restock>` → `<match-sku|sync-restock>`(`scripts/sellmate/inbound-run.sh` 의 `import-inbound` 분기도 지운다). **§① 전체(`:538-550`)를 삭제**하고 자리에 「① 입고예정 적재는 폐지됐다(D6, 2026-09-14). 예정일은 core 발주 입력으로만 들어온다.」 한 단락. §③(`:782-800`)의 「source plan 중 가장 이른 expected_date」 → 「남은 수량이 있는 발주 라인의 가장 이른 `expected_arrival`」.

- [ ] **Step 6: 확인·커밋**

Run: `grep -rn "inbound_plans\|import-inbound-plans\|입고 계획" CONTEXT.md docs/runbooks/selmate-stock-pipeline.md docs/agents/domain.md` → 0건(ADR-0032 는 역사 기록이라 제외).

```bash
git add docs/adr CONTEXT.md docs/agents/domain.md docs/runbooks/selmate-stock-pipeline.md scripts/sellmate/inbound-run.sh
git commit -m "docs: ADR-0039 문서가 수령 정산을 소유·커널이 도착을 한다 — ADR-0032 결정 1·4 대체, 용어집·런북 갱신"
```

---
### Task 13: 전체 게이트 · 통합 기준선 · dev 스모크(PR-A 5항목 합침) · PR

**Files:** 없음(검증과 PR 본문). 이슈·PR 본문의 수치는 **도출 명령**으로 적는다(CLAUDE.md 이슈 트래커 규약).

- [ ] **Step 1: 전체 게이트**

Run: `npm run type-check && npx jest --maxWorkers=2 && (cd apps/admin-web && npx tsc --noEmit) && npm run test:admin-web && (cd native/warehouse-app && npm test)`
Expected: 전부 0 실패.

- [ ] **Step 2: core 통합 전체와 develop 기준선 비교**

기준선을 **이 세션에서 다시 잰다**(메모의 8 suite 는 8/25 것, PR-A 는 10 이었다):
1. 메인 체크아웃(`/home/pauseb/workspace/almondyoung-server`, develop `c4705d274`)에서 `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local 2>&1 | grep -E "^(FAIL|PASS)" | sort > $SCRATCH/base.txt` — 사용자가 돌리거나, 워크트리 세션이면 `git worktree` 가 아니라 **메인 체크아웃에서 별도 셸**로.
2. 이 브랜치에서 같은 명령 → `$SCRATCH/head.txt`.
3. `diff base.txt head.txt` — **FAIL 이 새로 생긴 suite 0**. 삭제된 suite 는 diff 에 `PASS` 가 사라진 것으로 나온다(정상).
결과 요약(통과/실패 suite 수·삭제 suite 목록·기준선 대비 차이)을 PR 본문에 붙인다 — CI 는 DB 스펙을 skip 한다.

- [ ] **Step 3: dev 스모크 — PR-A 5항목 + PR-B 시나리오** (브라우저 + 창고 앱)

준비: `dev_core` 에 마이그레이션 적용됨(Task 1 Step 8) · `npm run dev:core:reset`(Task 6 시드) · core 를 **직접 재시작**(`--watch` 가 실제 프로세스에 안 붙은 전력) · admin-web dev · 창고 앱 `npm run dev`(또는 `tauri:dev`).

**PR-A 이월(`/inventory/inbound`):**
1. 간편입고 2품목 → 이력 탭에 회차 1건·수량 합계
2. 그 라인 적치 1개 → 적치 대기 수량 감소
3. 다른 간편입고 라인 회송 1개 → 성공
4. 또 다른 간편입고 라인 당일 취소 → 회차 voided
5. 개별입고(로케이션 지정) → 이력 수량

**PR-B(스펙 §12 「증거로 인정하는 것」 시나리오):**
6. `/inventory/purchase-orders` 발주 생성(공급처 기본창고 = 부천, 라인 A·B)
7. A 실행(10, 예정일 지정) → 발주 「생성됨」(B requested) · 입고 대기 탭에 이 발주 1건, 라인 A 남음 10
8. 창고 앱 `/inbound` → 카드 → A 스캔/탭 수령 10 → 앱 목록에서 발주 사라짐(B 는 requested) · admin 발주 드로어 A 「전량 입고」
9. admin 에서 B 실행(5) → 입고 대기에 다시 등장(B 남음 5) — **결함 ㄱ 회귀 확인**
10. 앱에서 B 부분 수령 2 → 드로어 「받음 2 (남음 3)」
11. admin 드로어 B [잔량 포기] 사유 입력 → 발주 「입고완료」 — **결함 ㄴ**
12. 이력 탭에서 A 회차 라인 [취소](source=purchase_order 분기) → 발주 「확정됨」 복귀 · 입고 대기 재등장 — **결함 ㄷ**
13. 앱에서 A 에 11 입력 → 시트가 막고 「남은 수량 10개를 넘습니다 — …」 문구
14. admin [예정일 수정] → 목록·드로어 반영, 그리고 `CORE_DB_URL=postgresql://postgres:postgres@localhost:5432/dev_core MEDUSA_API_URL=http://localhost:9000 MEDUSA_API_KEY=x npx ts-node -r tsconfig-paths/register apps/channel-adapter/scripts/sync-restock-to-medusa.ts`(dry-run) 출력에 그 날짜
15. `/inventory/status` 「입고 예정」 컬럼이 남은 수량과 같다(VIEW)

체크리스트 결과(✅/❌ + 메모)를 PR 본문에 남긴다. ❌ 는 고치고 다시 본다.

- [ ] **Step 4: 사용자 확인 후 이슈·푸시·PR**

**푸시·PR·이슈 생성은 사용자에게 먼저 묻는다.** 승인되면:
1. 이슈 생성(`gh issue create`) — 제목 「발주가 수령을 소유하고 현장 입고는 공통 커널이 한다 (PR-A/B/C)」, 본문은 스펙 링크 + 결정 표 링크 + PR 목록. 스펙 머리의 「이슈는 스펙 리뷰가 끝난 뒤 연다」 줄을 이슈 링크로 바꾸고, ADR-0039 의 자리표시도 채운다(추가 커밋 1).
2. `git push -u origin feat/purchase-order-owns-receiving-codex`
3. `gh pr create --base develop` 본문에 반드시:
   - 스펙 링크 · 「PR-B — expand + 코드 전환」 선언 · ADR-0039
   - **마이그레이션 2파일과 배포 순서 `migrate → deploy`**. **사람이 적는 문장:** 「기존 행을 좁히는 CHECK 3개(`ck_po_lines_received`·`ck_po_lines_closed`·`ck_po_lines_ordered_qty`)와 백필 가드 ⓪(`RAISE EXCEPTION`)가 있다 — `migration-safety.yml` 은 이 패턴을 라벨링하지 못한다. 사전 확인 쿼리 P1~P3 결과: 로컬 `dev_core`·`core` 0행/0행/0행(2026-09-14), 라이브 ___(사용자 기입).」
   - CHECK 를 생성 DDL 에 둔 이유(Task 1 머리의 「의도한 차이」) 한 단락
   - 게이트 결과 · 통합 기준선 비교(Step 2) · 스모크 체크리스트(Step 3)
   - 알려진 기존 결함: 멱등 재전송 500(`inbound.mapper.ts` toISOString) — 이 PR 회귀 아님, 이슈는 따로
   - 다음: **PR-C(contract) 는 이 PR 의 라이브 배포 완료 뒤**. PR-C 전 확인 쿼리 3종은 스펙 §11.
   - 과거 Claude 세션 링크는 현재 실행의 출처로 싣지 않는다.
4. 이슈 #724 본문의 「§4 항목 7 — received 파생」 절과 작업 순서 표 4번 행, #745 본문 항목 6 을 스펙 §13 대로 교정(`gh issue edit`) — 사용자 승인 뒤.

---

## Self-Review 결과 (작성 시 점검)

- **스펙 커버리지 (§11 PR-B 전부):** §4.1 컬럼·CHECK → T1 · §4.2 링크 테이블 → T1 · §4.3 source 판별 유니온 → T4 · §5.1 카운터 파생 → T2 · §5.2 헤더 함수 하나·도착예정일 필터 → T2/T3 · §5.3 술어 둘·조작별 관문 표 → T2/T3/T5 · §6.1 라우트 4·검증 층·한국어 거절·`PUT lines` 예정일 → T3/T5 · §6.2 삭제 5·`cancel` source·응답 `source` → T4/T6 · §6.3 중립 읽기 → T7 · §7.1 잠금 순서·회차 헤더 NO KEY UPDATE → T4/T5 · §7.2 멱등 → T5 · §8 `tx` 필수 → T4/T5 · §9 읽기 7행 → T3(응답)/T7 · §10.1 → T11 · §10.2 → T10 · §11 마이그레이션 2파일·가드·백필·dev 시드·셀메이트 import 삭제 → T1/T6 · §12 #1 T2 · #1a T3/T5 · #2 T5 · #3 T5 · #4 T5 · #5 T5 · #6 T8 · #7 T5 · #8 T7 · #9 T9 · #10 T4 · #11 T5/T6/T7 · #12 T7 · #13 T1 · #14 T10 · #15 T11 · §13 → T12/T13.
- **PR-A 이월 4건:** 형제 라인 동시 취소 voided 경합(회차 헤더 `FOR NO KEY UPDATE`) → T4 · §12 #6 두 커넥션 적치-vs-취소 → T8 · arch 가드 `inbound/` 전체 → T9 · `ArrivalOrigin` 판별 유니온 → T4.
- **스펙과의 의도한 차이(PR 본문에 적는다):** ① CHECK 3개가 백필 앞의 생성 DDL 에 있다(T1 머리) ② `purchaseOrderExpectedArrival` 이 `shared/dates` 에서 `procurement/…status.rules.ts` 로 옮겨간다(T2 Step 3 사유) ③ 링크 테이블의 `receipt_line_id` 는 UNIQUE 가 아니라 PK(UNIQUE 를 함의) ④ 남은 수량 술어에 「헤더 `cancelled` 제외」를 명시(§5.1 은 라인만 말한다 — 취소된 발주의 ordered 라인이 입고 대기·VIEW 에 잡히지 않게) ⑤ 라인 실행·라인 수정의 종결 거절이 400 → 409(#745 가 미룬 것을 `acceptsChanges` 도입과 함께 정리).
- **플레이스홀더 점검:** 각 Task 에 코드 블록·실행 명령·기대 결과가 있다. T5·T7·T8·T10·T11 의 일부 it 은 본문 대신 「단언 수치·경로」를 주석으로 적었다 — 시드 헬퍼가 기존 스펙에서 복사되는 부분이라 그 파일 좌표를 명시했다.
- **타입 일관성:** `LineSettlement`(T2) = Reader select 결과(T3) = Manager 잠금 행(T5) 구조적 일치 · `ReceivingProgress` 이름을 core 응답 DTO(T3)·admin-web 타입(T10)에서 동일 사용 · `ExpectedArrivalRow.lines` 필드명(T7) = 창고 앱 `ExpectedArrivalLine`(T11) = admin-web `ExpectedArrivalLineDto`(T10) · 멱등 endpoint 문자열 `purchase_order.receive`/`purchase_order.receipt.cancel` (T5 구현 = T5 스펙) · `InboundService` 5인자 순서 `(dbService, skuCatalogService, eventStore, idempotency, receiptKernel)` 를 T6 의 배선 5곳에 동일 적용 · 라우트 문자열은 Global Constraints 표 = T5 컨트롤러 = T10/T11 클라이언트.
