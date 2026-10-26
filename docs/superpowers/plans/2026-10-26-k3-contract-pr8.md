# K3 PR 8 — contract: 옛 FO 단위 직배를 걷는다 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 옛 FO 단위 직배(`direct-ship.service.ts`·`ship()`·옛 라우트 10개·`direct_ship_status`·FO 모드 `drop_ship`·알릴 취소의 `holder_id`)를 코드와 스키마에서 지운다. 직배는 입점사 상자 하나로만 남는다. 운영 동작은 바뀌지 않는다 — 지우는 것은 전부 라이브 0 인 경로다(Task 0 이 확인).

**Architecture:** 세 겹이다. ① 코드에서 옛 경로 삭제(서비스·라우트·`ship()`·`adminAvailableActions`) — 스키마는 그대로라 커밋마다 초록. ② `inventory.schema.ts` 에서 칸·enum 값을 빼고 contract 마이그 하나를 만든다. 그 마이그가 실제로 도는지는 «직전까지 적용 → 행 심기 → 마지막 적용» 통합 테스트로 굳힌다. ③ admin-web 의 같은 어휘 정리와 운영 문서(개통 점검표·ADR). 배포는 `deploy → migrate`.

**Tech Stack:** NestJS(core), Drizzle(drizzle-kit generate), Postgres enum 재생성, Jest(unit + `DATABASE_URL` 통합), Next.js(admin-web, 타입·라벨만).

**Spec:** `docs/superpowers/specs/2026-10-25-k3-drop-ship-supplier-shipments-design.md` (§4.1 마지막 두 문단, §6 contract, §7 PR 8 줄, «PR 8 구현자에게» 세 묶음). ADR `docs/adr/0050-drop-ship-is-a-supplier-shipment.md`. 앞 계획 `2026-10-26-k3-admin-web-pr7.md`.

## 코드에서 확인한 것 (develop `f8f8e50a4`)

- **🔴 FO `'shipped'` 는 옛 `ship()` 만 쓰는 값이 아니다.** 셀메이트 수기 출고 스크립트 `scripts/ops/cellmate-local/mark-core-shipped.sql.js` 가 **매일** `update fulfillment_orders set status='shipped'` 를 보낸다(과도기, #923). PR 1 가드(`fulfillment-order-status-writes.guard.spec.ts`)는 `apps/core/src` 만 훑어서 이걸 못 봤다. `scripts/sellmate/close-shipped-shipments.ts`·`scripts/ops/outbound-cutover-preflight.ts` 도 이 값을 읽는다. 스펙 §6 의 «`'shipped'` 값 제거»는 이 사실을 몰랐을 때의 결정이다 → N1.
- **투영(`fulfillment-progress.service.ts`)은 `'shipped'` 를 내지 않는다** — 8개 어휘에 없다. 코드 안 FO `'shipped'` 쓰기는 `fulfillments.service.ts` `ship()`(:397) 하나고, 부르는 곳은 `direct-ship.service.ts` `markOrdersAsCompleted`(:345) 하나다.
- **`fulfillment_mode` enum 은 칸 둘이 쓴다:** `fulfillment_orders.fulfillment_mode` 와 `delivery_profiles.supported_fulfillment_modes`(배열, :976). admin-web 배송 프로필 화면이 «위탁 직배송»(`drop_ship`)을 고를 수 있게 보여 준다 — 라이브 프로필에 이 값이 있을 수 있다(Task 0). 입점사 상자는 배송 프로필을 읽지 않는다.
- **enum 값을 지운 뒤 그 값을 raw SQL·파라미터로 비교하면 Postgres 가 런타임에 22P02 로 throw 한다.** drizzle 의 `inArray`/`notInArray`/`eq` 는 칸 타입으로 묶여 tsc 가 잡지만, `sql\`${…}\`` 파라미터와 SQL 문자열 리터럴은 못 잡는다. 지금 `'drop_ship'` 을 SQL 로 비교하는 운영 코드는 `direct-ship.service.ts`(지울 파일)뿐이고, `scripts/ops/k7-pr5-predeploy-check.js` 가 `direct_ship_status` 를 읽는다(일회성 점검, 지운다).
- **옛 라우트 10개를 부르는 admin-web 코드는 0 이다**(`grep -rnE "direct-ship/(dashboard|companies|orders|export)" apps/admin-web/src` 0줄). 남길 라우트 10개는 Task 1 이 목록으로 굳힌다. PR 7 이 더한 `GET /direct-ship/suppliers/:supplierId/handoffs` 와 넘김 POST 의 `readPiiExportReason` 은 남긴다.
- `scripts/security/pii-routes.ts` 는 `GET /direct-ship/export/:companyName` 에 «레포 밖 호출자 확인 전까지 사유를 강제하지 않는다»를 달아 두었다 — 레포 밖 호출자가 있는지 Task 0 이 로그로 잰다.
- `seedShippedBeforeBoxingFulfillment`(`sales-order/cancellation-record/__support__/cancellation-scenarios.ts:61`)는 «상자 없이 `'shipped'` 인 FO» 를 만든다 — 바로 셀메이트가 만드는 라이브 상태다. N1 이면 그대로 둔다.
- 마이그 사슬 통합 테스트의 본보기: `inventory/schema/__fixtures__/purchase-order-receiving-contract-harness.ts`(`readMigrationFiles` → `applyMigrations` 로 앞부분만 적용 → 행 심기 → 나머지 적용).

## 이름 붙은 결정 (⛔ 사용자 확인)

- **N1. FO status enum 의 `'shipped'` 는 지우지 않는다.** 셀메이트 스크립트가 매일 쓰는 라이브 값이다. 이번에는 `ship()`(코드 안 유일한 쓰기)만 지우고, `inventory.schema.ts:209-211` 주석과 상태 쓰기 가드 주석에 «`'shipped'` 는 셀메이트 과도기 스크립트가 쓴다 — 셀메이트 컷오버(#923) 때 걷는다»를 적는다. 대안(스크립트를 `'completed'` 로 바꾸고 라이브 `'shipped'` 행을 백필한 뒤 값 제거)은 사용자가 매일 돌리는 도구를 바꾸므로 K3 밖이다.
- **N2. 한 PR, Core + admin-web, contract 마이그 하나, `deploy → migrate`.** CLAUDE.md 의 «column drop 2 PR» 은 «코드가 먼저 칸을 안 쓰고, 그 배포가 끝난 뒤 DROP» 이 핵심이다. 이 PR 의 코드는 지울 칸을 이미 안 읽으므로 «이 PR 배포 → 롤아웃 확인 → migrate» 가 같은 순서를 지킨다(스펙 §7 표도 한 PR). **대가: migrate 뒤에는 Core 를 이 PR 이전으로 롤백할 수 없다** — 옛 코드는 FO 를 읽을 때마다 `direct_ship_status` 를 select 해서 FO 조회가 전부 죽는다. 또 이 PR 은 **expand 마이그가 있는 PR 과 같은 배치에 실을 수 없다**(`deploy:preflight` 가 섞임으로 1 을 낸다).
- **N3. 마이그 내용(`npm run db:generate:core -- --name drop-legacy-drop-ship`):**
  - `fulfillment_orders.direct_ship_status` DROP, enum 타입 `direct_ship_status` DROP.
  - `direct_ship_cancel_notices`: `holder_id`(FK·`idx_direct_ship_cancel_notices_pending`·`ck_direct_ship_cancel_notices_party` 함께) DROP, `supplier_id` SET NOT NULL. 스키마 주석(:1791-1794, :1811)을 «입점사(suppliers) 하나»로.
  - `fulfillment_mode` enum 에서 `'drop_ship'` 제거(타입 재생성 — 두 칸 모두 `text`/`text[]` 를 거쳐 다시 묶인다). **생성된 SQL 의 타입 변경 문 앞에** `UPDATE delivery_profiles SET supported_fulfillment_modes = array_remove(supported_fulfillment_modes::text[], 'drop_ship')::…` 한 줄을 손으로 더한다(아직 어디에도 적용 안 된 새 마이그라 손대도 된다). `['drop_ship']` 뿐이던 프로필은 `[]` 가 된다 — 지금도 `in_house` 를 지원하지 않아 창고 출고에 못 쓰던 프로필이라 동작이 같다.
  - FO status enum 은 건드리지 않는다(N1).
- **N4. 지우는 코드:** `direct-ship.service.ts` 와 그 스펙 둘(`direct-ship.service.spec.ts`·`direct-ship.canceled-demand.integration.spec.ts`), 컨트롤러의 옛 라우트 10개와 그 zod 스키마·`DirectShipService` 주입, 모듈 provider, `FulfillmentsService.ship()`·`computeAdminAvailableActions`·응답의 `adminAvailableActions`(늘 빈 배열이 된다), 게이트 키 `'fulfillment.drop_ship'` 을 쓰는 스펙 줄, `scripts/ops/k7-pr5-predeploy-check.js`. `computeBlockedReasons` 는 남긴다.
- **N5. FO 모드 `drop_ship` 을 읽는 곳을 함께 걷는다:** 요청·응답 DTO 의 enum, 목록 쿼리 `fulfillmentMode`, `allocation.locks.ts:211`·`shipment-planning.service.ts:1764` 의 FO 모드 판별(같은 자리의 `stockType === 'drop_shipped'`·입점사 상자 가드가 남는다), 응답 `directShipStatus`. `seedFo({ dropShip })` 옵션을 지우고, 그 옵션을 «옛 모드는 더는 읽지 않는다»를 증명하려고 쓰던 케이스는 지운다(그 상태가 더는 존재할 수 없다). 우연히 «예약 없는 FO» 를 만들려고 쓰던 케이스는 옵션만 빼고 단정은 그대로 둔다.
- **N6. 개통 점검표를 이 PR 에 싣는다** — `docs/runbooks/k3-drop-ship-activation.md`(스펙 §6 이 요구, 아직 없다). Task 4.
- **N7. PR 8 밖으로 넘기는 것**(이 PR 에서 고치지 않는다, 이슈 하나로 묶을지 사용자에게 묻는다): PR 7 이 남긴 ① 섞인 FO 의 라인 구성 편집 버튼이 입점사 라인에도 뜨는 것, ② 되돌린 합포장 상자가 대기에서 주문 하나로만 보이는 것, N9 공급사 상품코드, 새 택배사 8개의 추적 URL `null`, 정정이 이벤트를 다시 내지 않는 것, 이슈 #1136(채널 택배사 매핑).

## Global Constraints

- **FO status enum(`fulfillment_status`)과 FOI `status` 값은 바꾸지 않는다**(N1). 셀메이트 스크립트 세 문장(`mark-core-shipped.sql.js`)이 마이그 뒤에도 그대로 돌아야 한다.
- 마이그는 **하나**, 이름 `drop-legacy-drop-ship`. `schema.ts` + 새 `drizzle/<timestamp>_drop-legacy-drop-ship.sql` + `drizzle/meta/` 를 **한 커밋**에(CLAUDE.md). 생성은 이 PC 에서(rename 프롬프트가 뜨면 «새로 만들기 아님/지우기» 를 고른다 — 이 PR 에 rename 은 없다).
- 남는 `/direct-ship` 라우트는 정확히 10개(Task 1 목록). 권한·PII 데코레이터는 그대로.
- FO·FOI status 쓰기 허용 목록은 투영 파일 하나로 줄어든다(`fulfillment-order-status-writes.guard.spec.ts`).
- 트랜잭션·쿼리 규칙(ADR-0025, CLAUDE.md Inventory) 그대로. 이 PR 은 새 쿼리를 거의 안 만든다.
- 통합 테스트는 **새 스크래치 DB `k3_pr8_it`** 에서 돈다 — `k3_pr2_it` 에 contract 마이그를 적용하면 다른 브랜치의 테스트가 깨진다. 만들기: `docker exec almondyoung-server-postgres-1 createdb -U postgres k3_pr8_it && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k3_pr8_it npx drizzle-kit migrate --config apps/core/drizzle.config.ts`. 실행: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k3_pr8_it npx jest --runInBand --runTestsByPath <파일…>`. 꺼져 있으면 `docker start almondyoung-server-postgres-1`.
- 기준선: 브랜치 시작 때(마이그 적용 전) `k3_pr8_it` 에서 `apps/core/src/modules/fulfillment apps/core/src/modules/sales-order apps/core/src/modules/inventory/delivery-profile scripts/ops/cellmate-local` 의 `*.integration.spec.ts` 를 한 번 돌려 실패 목록을 scratchpad 에 둔다.
- 워크트리(`.claude/worktrees/feat-k3-pr8`)는 node_modules 심볼릭 링크(루트·`apps/*`·`web/*`·`native/warehouse-app`)가 있어야 jest 매퍼가 산다.
- 검증 게이트: `npm run type-check` 에러 0, `npx jest` 실패 0(이 PC 의 admin-web attendance spec 4개는 ICU 환경 실패 — 비교만), `npm run test:admin-web` 실패 0, 통합 기준선 외 실패 0.

## Review Focus

- **셀메이트 스크립트가 마이그 뒤에도 돈다** — `mark-core-shipped.integration.spec.ts` 가 `k3_pr8_it`(마이그 적용 뒤)에서 통과하고, FO 가 `'shipped'` 가 된다. Task 5 실행 목록.
- **배송 프로필의 `drop_ship` 이 마이그로 사라진다** — `['in_house','drop_ship']` → `['in_house']`, `['drop_ship']` → `[]`, `NULL` → `NULL`. 마이그가 실패하지 않는다. Task 2 마이그 사슬 케이스.
- **지운 enum 값을 SQL 문자열로 비교하는 곳이 남지 않는다** — 런타임 22P02. Task 2 Step 6 의 grep 이 0줄.
- **남길 라우트를 같이 지우지 않는다** — 특히 PR 7 의 `GET suppliers/:supplierId/handoffs` 와 넘김 POST 의 사유 선검사. Task 1 의 라우트 목록 테스트와 기존 `direct-ship.controller.handoff-reason.integration.spec.ts`.
- **알릴 취소는 입점사 없이 못 쓴다** — `supplier_id` 없는 insert 는 23502, 기존 쓰기(`recordSupplierCancelNotices`)는 그대로 통과. Task 2 스키마 케이스와 기존 `sales-orders.supplier-cancel-notice.integration.spec.ts`.

---

## 배포

- **`deploy → migrate`**(contract). 순서: develop 머지 → 배치 배포(`npm run deploy:preflight -- --stage live` 가 이 마이그를 contract 로 보여야 한다, 같은 배치에 expand 마이그가 있으면 따로 낸다) → Core ECS 롤아웃 완료 확인 → `npm run db:migrate -- --stage live --deployment lcnine-services --yes` → `--mark-deployed`.
- 🔴 **migrate 뒤에는 Core 를 이 PR 이전으로 롤백하지 않는다**(N2). migrate 전이면 롤백해도 된다 — 칸·값이 아직 있다.
- admin-web 은 같은 배치. admin-web 이 먼저 떠도, Core 가 먼저 떠도 문제없다(admin-web 은 옛 라우트를 안 부르고, 지운 응답 칸은 `?? []` 로 읽는다).
- 셀메이트 스크립트는 바뀌지 않는다 — 운영자에게 알릴 것 없음.

---

### Task 0: 착수 전 라이브 실측 (사용자 터널)

**Files:** 없음(결과는 PR 본문에).

- [ ] **Step 1: 사용자에게 터널을 부탁한다** — `npx sst tunnel --stage live`. 터널은 사용자가 띄운다.
- [ ] **Step 2: 읽기 전용으로 잰다**

```sql
SELECT count(*) FILTER (WHERE fulfillment_mode = 'drop_ship') AS drop_ship_fo,
       count(*) FILTER (WHERE direct_ship_status IS NOT NULL) AS direct_ship_status_set
  FROM fulfillment_orders;
SELECT count(*) FILTER (WHERE holder_id IS NOT NULL) AS holder_notices,
       count(*) FILTER (WHERE supplier_id IS NULL) AS no_supplier_notices
  FROM direct_ship_cancel_notices;
SELECT id, name, supported_fulfillment_modes FROM delivery_profiles
 WHERE 'drop_ship' = ANY(supported_fulfillment_modes::text[]);
SELECT status, count(*) FROM fulfillment_orders GROUP BY status ORDER BY status;
```

Expected: 앞의 넷은 0. 프로필 목록은 몇 행이든 된다(N3 의 `array_remove` 가 처리) — 행을 PR 본문에 적는다. 마지막 줄은 N1 의 근거(`shipped` 가 많을 것)로 PR 본문에 적는다. **앞의 넷 중 하나라도 0 이 아니면 멈추고 사용자에게 보고한다.**

- [ ] **Step 3: 옛 라우트 호출을 잰다(최근 30일)** — Core 로그그룹(`aws logs describe-log-groups --log-group-name-prefix /sst/cluster/` 로 확인)에 Logs Insights 로 `filter @message like /direct-ship\/(dashboard|companies|orders|export)/`. 요청 경로가 로그에 안 남으면 Grafana Tempo 에서 `http.route` 로 같은 패턴을 찾는다(`grafana-cloud-query-access` 메모: `/tempo/api/…`). Insights `@timestamp` 는 UTC. Expected: 0건. 있으면 호출자(IP·UA)를 적고 멈춘다.

### Task 1: 옛 직배 경로를 코드에서 지운다 (스키마는 그대로)

**Files:**
- Delete: `apps/core/src/modules/fulfillment/services/direct-ship.service.ts`, `…/services/direct-ship.service.spec.ts`, `…/services/direct-ship.canceled-demand.integration.spec.ts`, `scripts/ops/k7-pr5-predeploy-check.js`
- Modify: `apps/core/src/modules/fulfillment/controllers/direct-ship.controller.ts` — 옛 라우트 10개(:223-414)와 `ForwardOrdersSchema`·`CompleteOrdersSchema`·`ExportOrdersSchema`, `DirectShipService` 주입, 쓰지 않게 된 import
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts` — provider
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts` — `ship()`(:397-487), `computeAdminAvailableActions`(:489-507)와 그 호출(:600, :717), 쓰지 않게 된 의존(`fulfillmentsV1`·`reservationLifecycle` 등은 다른 메서드가 쓰는지 확인 후)
- Modify: `apps/core/src/modules/fulfillment/dto/fulfillment-order-response.dto.ts` — `adminAvailableActions`(:252)
- Modify: `apps/core/src/modules/fulfillment/controllers/fulfillments.controller.ts:90` — 요약 문구
- Modify: 컨트롤러 스펙 셋(`direct-ship.controller.cancel-notices.spec.ts`·`.uploads.spec.ts`·`.handoff-reason.integration.spec.ts`) — `{ provide: DirectShipService … }` 줄
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts` — `ship()`·`adminAvailableActions` 케이스 삭제
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-workflow-gate.service.spec.ts:70` — 다른 키로 바꾸거나 줄 삭제
- Modify: `apps/core/src/modules/fulfillment/fulfillment-order/fulfillment-order-status-writes.guard.spec.ts` — 허용 목록을 투영 파일 하나로, 테스트 이름 «status 를 쓰는 파일은 투영 하나뿐», 머리 주석에 «`apps/core/src` 밖의 셀메이트 스크립트가 FO `'shipped'` 를 쓴다(N1)» 한 줄
- Modify: `scripts/security/pii-routes.ts`(:22-23, :25-26, :111), `scripts/security/route-classification.spec.ts:52` — 지운 라우트 항목
- Test: `apps/core/src/modules/fulfillment/controllers/direct-ship.controller.routes.spec.ts`(새)

**Interfaces:**
- Produces: `/direct-ship` 라우트는 아래 10개뿐. `FulfillmentsService` 에 `ship` 이 없다. FO 상세 응답에 `adminAvailableActions` 가 없다.

- [ ] **Step 1: 라우트 목록 테스트** — `direct-ship.controller.routes.spec.ts`: `DirectShipController.prototype` 의 메서드마다 `Reflect.getMetadata(PATH_METADATA, …)`·`METHOD_METADATA` 를 읽어 `"<METHOD> <path>"` 집합을 만들고 정확히 같은지 본다:

```ts
expect(routes).toEqual(new Set([
  'GET supplier-queue',
  'GET supplier-queue/:supplierId/shipments',
  'GET suppliers/:supplierId/handoffs',
  'POST suppliers/:supplierId/handoffs',
  'GET handoffs/:handoffId/sheet',
  'POST suppliers/:supplierId/uploads/preview',
  'POST suppliers/:supplierId/uploads/apply',
  'GET cancel-notices',
  'POST cancel-notices/export/file',
  'POST cancel-notices/notified',
]));
```

- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/fulfillment/controllers/direct-ship.controller.routes.spec.ts` → FAIL(옛 10개가 더 있다)
- [ ] **Step 3: 위 Files 대로 지운다**
- [ ] **Step 4: 통과** — 새 스펙·`fulfillment-order-status-writes.guard.spec.ts`·`scripts/security/pii-routes.spec.ts`·`scripts/security/route-classification.spec.ts`·컨트롤러 스펙 셋(`.handoff-reason` 은 `k3_pr8_it` 로) PASS, `npm run type-check` 에러 0, `grep -rn "DirectShipService\|\.ship(\|adminAvailableActions" apps/core/src --include=*.ts | grep -v warehouse-transfer | grep -v "inventory.ship("` 0줄
- [ ] **Step 5: Commit** — `git commit -m "K3 PR8 — 옛 FO 단위 직배 경로를 지운다(direct-ship.service·ship()·옛 라우트 10개·adminAvailableActions)"`

### Task 2: 스키마 contract — `direct_ship_status`·FO 모드 `drop_ship`·알릴 취소 `holder_id`

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` — `directShipStatusEnum`(:232)과 FO 칸(:1754), `fulfillmentModeEnum` 에서 `'drop_ship'`(:223), 알릴 취소의 `holderId`·`idxPending`·`ckParty`(:1812, :1829-1834)와 `supplierId` `.notNull()`, 주석(:209-211 은 N1 문구로, :1791-1794·:1811)
- Create: `apps/core/drizzle/<timestamp>_drop-legacy-drop-ship.sql` + `drizzle/meta/` (generate, N3 의 `array_remove` 한 줄만 손으로)
- Create: `apps/core/src/modules/inventory/schema/drop-legacy-drop-ship.migration.integration.spec.ts`
- Modify(컴파일·N5): `fulfillment/dto/create-fulfillment-order.dto.ts:70`, `dto/list-fulfillments-query.dto.ts:16-19`, `dto/fulfillment-order-response.dto.ts:192-196`, `controllers/fulfillments.controller.ts:138`, `picking/allocation/allocation.locks.ts:211`, `services/shipment-planning.service.ts:1764-1766`, `inventory/delivery-profile/**`(enumValues 에서 저절로 빠진다 — 스펙만 확인), `direct-ship-cancel-notice/direct-ship-cancel-notice.reader.ts:44` 주석, `sales-order/line-quantities/line-quantities.sql.ts:110`·`line-composition-edit/line-composition-edit.reader.ts:102` 주석(«옛 판별은 PR 8 이 걷었다»)
- Modify(픽스처·N5): `fulfillment/order-progress/__support__/order-progress.fixtures.ts:74-93`(`dropShip` 옵션 삭제), 그 옵션을 쓰는 스펙 다섯(`fulfillment-order-projection.integration.spec.ts`·`unboxed-demand-cancellation.integration.spec.ts`·`sales-orders-stats.integration.spec.ts`·`sales-orders.cancellation-reads.integration.spec.ts` — 도출: `grep -rln "dropShip:" apps/core/src`; `order-reconcile.gate.spec.ts` 의 `dropShip` 은 변수 이름이라 그대로), `'drop_ship'`·`directShipStatus` 를 쓰는 스펙(`grep -rlnE "'drop_ship'|directShipStatus" apps/core/src --include=*.spec.ts`), `fulfillment/shipment/supplier-shipment.schema.integration.spec.ts:193-217`(holder 케이스 → 아래 Step 1 케이스로 바꾼다)

**Interfaces:**
- Consumes: Task 1(지운 파일은 더는 칼럼을 안 읽는다).
- Produces: `FulfillmentMode = 'in_house' | '3pl'`(`(typeof fulfillmentModeEnum.enumValues)[number]`), `directShipCancelNotices.supplierId: string`(NOT NULL), FO 행에 `directShipStatus` 없음.

- [ ] **Step 1: 테스트 둘을 먼저 쓴다**
  - `drop-legacy-drop-ship.migration.integration.spec.ts`(`describeIfDb`, 본보기 `purchase-order-receiving-contract-harness.ts` — 자기 DB 를 만들고 지운다): 저널에서 `_drop-legacy-drop-ship` 으로 끝나는 태그를 찾아(없으면 `throw new Error('drop-legacy-drop-ship migration must exist')`) 그 직전까지 적용 → 프로필 셋(`{in_house,drop_ship}`·`{drop_ship}`·`NULL`), `status='shipped'` FO 하나를 raw SQL 로 심기 → 마지막 적용. 케이스:
    - `배송 프로필의 drop_ship 이 빠진다 — {in_house}·{}·NULL`
    - `셀메이트가 쓴 shipped FO 는 그대로다(N1)` — 행 `status = 'shipped'`, 그리고 마이그 뒤 `MARK_FULFILLMENT_ORDERS_SHIPPED`(`scripts/ops/cellmate-local/mark-core-shipped.sql.js`)를 그 DB 에 돌려도 에러 없음
    - `칸과 타입이 없다` — `information_schema.columns` 에 `fulfillment_orders.direct_ship_status`·`direct_ship_cancel_notices.holder_id` 0행, `pg_type` 에 `direct_ship_status` 0행, `enum_range(NULL::fulfillment_mode)::text = '{in_house,3pl}'`
  - `supplier-shipment.schema.integration.spec.ts`: `알릴 취소는 입점사가 필수` — `supplier_id` 없이 raw insert → `code: '23502'`
- [ ] **Step 2: 실패 확인** — 두 파일을 `k3_pr8_it` 로 실행 → 마이그 스펙은 «must exist» 로, 스키마 케이스는 insert 성공으로 FAIL
- [ ] **Step 3: `inventory.schema.ts` 를 고치고 생성** — `npm run db:generate:core -- --name drop-legacy-drop-ship`. 생성된 SQL 을 읽고 N3 의 `UPDATE delivery_profiles … array_remove …` 를 `supported_fulfillment_modes` 의 타입 변경 문 **앞**에 넣는다. SQL 에 FO status·`fulfillment_status` 가 나오면 멈춘다(N1 위반).
- [ ] **Step 4: 컴파일·픽스처 정리** — `npm run type-check` 가 가리키는 곳을 위 Files 대로. N5 규칙: «옛 모드를 읽지 않는다» 를 증명하던 케이스는 지우고, 나머지는 `dropShip` 인자만 뺀다.
- [ ] **Step 5: 적용과 통과** — `k3_pr8_it` 에 `npx drizzle-kit migrate --config apps/core/drizzle.config.ts`(에러 없음) → Step 1 두 파일 PASS, Files 의 통합 스펙 전부 PASS, `npm run type-check` 에러 0
- [ ] **Step 6: 남은 리터럴 0 확인** — `grep -rnE "'drop_ship'|direct_ship_status|directShipStatus" apps/core/src scripts --include=*.ts --include=*.js | grep -v "drop-legacy-drop-ship"` 가 0줄(주석은 «PR 8 이 걷었다» 류만 허용). 알릴 취소의 holder 는 `grep -rn "holder" apps/core/src/modules/fulfillment/direct-ship-cancel-notice apps/core/src/modules/fulfillment/supplier-shipment` 로 따로 본다.
- [ ] **Step 7: Commit**(schema.ts·마이그·meta 한 커밋) — `git commit -m "K3 PR8 — contract 마이그: direct_ship_status·FO 모드 drop_ship·알릴 취소 holder_id 를 걷는다(배송 프로필의 drop_ship 도 빠진다, FO 'shipped' 는 셀메이트가 써서 남긴다)"`

### Task 3: admin-web — 같은 어휘를 걷는다

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/fulfillment.ts` — `FulfillmentMode`(:8)에서 `'drop_ship'`, `DirectShipStatus`(:22)와 `directShipStatus`(:69), `adminAvailableActions`(:85-89)
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts:1899` — `FulfillmentMode`
- Modify: `apps/admin-web/src/features/inventory/delivery-profiles/lib/labels.ts:14` — «위탁 직배송» 줄(프로필 다이얼로그의 선택지가 저절로 빠진다)
- Modify: `apps/admin-web/src/components/table/table-cells/fulfillment/fo-status-cell.tsx:51`, `features/order/fulfillments/components/detail/index.tsx:29, :75`
- Modify: `apps/admin-web/src/features/order/line-composition/line-composition-view.ts:33-39` — `canEditLineComposition` 을 지우고 호출처(`features/order/fulfillments/detail/line-compositions.tsx:22`)는 `canEdit` 을 그대로 쓴다. 문구표의 `DROP_SHIP_NOT_SUPPORTED`(:122)는 남긴다 — 서버가 입점사 라인에 여전히 낸다(N7 ①)
- Test: `apps/admin-web/src/features/order/line-composition/line-composition-view.spec.ts:66` 근처 케이스 삭제

- [ ] **Step 1: 지우고 고친다** — 위 Files 대로. `grep -rnE "drop_ship\b|directShipStatus|DirectShipStatus|adminAvailableActions|canEditLineComposition" apps/admin-web/src --include=*.ts --include=*.tsx | grep -v drop_shipped` 0줄
- [ ] **Step 2: 통과** — `(cd apps/admin-web && npx tsc --noEmit)` 에러 0(CI 가 admin-web tsc 를 안 돌린다 — 직접 돌린다), `npm run test:admin-web` 실패 0(attendance 4개 제외)
- [ ] **Step 3: Commit** — `git commit -m "K3 PR8 — admin-web 에서 FO 모드 drop_ship·직배 상태·adminAvailableActions 를 걷는다"`

### Task 4: 문서 — 개통 점검표·ADR·감사 문서

**Files:**
- Create: `docs/runbooks/k3-drop-ship-activation.md`
- Modify: `docs/adr/0050-drop-ship-is-a-supplier-shipment.md` — :15·:46·:48 의 «PR 8 이 걷는다» 를 지금 사실로, FO `'shipped'` 가 남는 이유(N1) 한 줄
- Modify: `docs/superpowers/specs/2026-10-25-k3-drop-ship-supplier-shipments-design.md` — §6 contract 줄에 «`'shipped'` 는 셀메이트 스크립트가 써서 남겼다(PR 8 N1)», §7 표 8번 줄 같은 정정(산출물을 고쳤으면 원본을 고친다)
- Modify: `docs/order-logistics-architecture-audit-2026-10.md` §8.1 K3(:305) — «예외는 옛 직배 `fulfillments.service.ts` 하나» → «투영 하나, FO `'shipped'` 는 셀메이트 스크립트(코드 밖)»

- [ ] **Step 1: 점검표를 쓴다** — 순서대로 체크박스, 각 항목에 확인 방법(화면 경로 또는 읽기 전용 SQL):
  1. 입점사를 공급사로 등록하고 «직배»(`purchaseSettings.isDirectDelivery`)를 켠다. 확인: `SELECT id, name FROM suppliers WHERE is_direct_delivery`.
  2. **그 입점사의 상품을 셀메이트에서 내린다** — 한 입점사는 셀메이트와 새 시스템 중 한쪽에만(같은 주문이 두 번 간다).
  3. SKU 를 재고 유형 «직배»(`drop_shipped`) + 그 입점사로 등록한다. 🔴 `physical` 로 잘못 등록하면 창고 FO 가 없는 재고를 기다리며 멈춘다. 확인 SQL: 그 입점사와 연결됐는데 `stock_type <> 'drop_shipped'` 인 SKU 0, `drop_shipped` 인데 직배 공급사 연결이 정확히 하나가 아닌 SKU 0.
  4. 외부 채널(네이버·쿠팡)에 그 SKU 를 올리지 않는다(비목표 — 채널 발송은 manual 로 빠진다).
  5. 쇼핑몰 게시.
  6. 첫 주문 스모크: 주문 → 직배송 운영 «대기»에 상자 → 내려받기(사유 입력) → «넘긴 것» → 송장 시트 올리기 미리보기 → 적용 → 고객 추적 화면에 택배사·송장 → 발송 알림 문자. 새 택배사 8개는 추적 링크가 없다(N7).
  7. 취소 스모크: 넘긴 뒤 관리자 취소 → «알릴 취소»에 행 → 내려받기 → 완료 표시.
- [ ] **Step 2: ADR·스펙·감사 문서를 고친다** — 위 Files 대로
- [ ] **Step 3: Commit** — `git commit -m "K3 PR8 — 직배 개통 점검표, ADR-0050·설계·감사 문서를 contract 뒤 사실로"`

### Task 5: 전체 검증

- [ ] **Step 1:** `npm run type-check` 에러 0
- [ ] **Step 2:** `npx jest` 실패 0(attendance 4개는 비교만)
- [ ] **Step 3:** `k3_pr8_it`(마이그 적용 뒤)에서 기준선과 같은 통합 묶음 + `scripts/ops/cellmate-local/mark-core-shipped.integration.spec.ts` + `apps/core/src/modules/inventory/delivery-profile/services/delivery-profile.manager.integration.spec.ts` → 기준선 외 실패 0
- [ ] **Step 4:** `npm run deploy:preflight -- --stage live` 를 사용자 터널로 돌릴 수 있으면 이 마이그가 `contract` 로 분류되는지 본다(배포 직전 사용자 몫이면 PR 본문 체크리스트로)
- [ ] **Step 5:** PR 본문에 Task 0 결과, N1~N7, 배포 절(🔴 롤백 금지 포함)을 싣는다
