# K3 PR 5 — 직배 발송 명령 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영자가 입점사별 발송 시트를 받아(= 넘김) 입점사에 보내고, 입점사가 채워 돌려준 시트를 올리면(미리보기 → 적용) 송장이 있는 줄은 **입점사 상자 발송**(필요하면 나누기·합포장), 사유가 있는 줄은 **못 보냄**, 바뀐 송장은 **정정**으로 기록된다. 잘못 반영된 발송은 창고와 같은 되돌리기 명령으로 draft 로 돌린다. 발송은 창고와 같은 이벤트(`ShipmentShipped`·`SalesOrderShipmentDispatched`·`FulfillmentProgressed`·`FulfillmentShipped` v1)를 내고, core 의 «옛 6개 택배사» 문(`CONSUMER_ROLLOUT_CARRIERS`)을 지운다. **동작은 휴면이다** — 직배 SKU 가 라이브 0 이다.

**Architecture:** 입점사 상자의 쓰기는 `fulfillment/supplier-shipment/` 한 폴더의 커널 함수(발송·나누기·합포장·정정·못 보냄·되돌리기)가 하고, 시트 적용 서비스가 그 함수들을 부른다. 창고 발송 서비스의 «발송 뒤 효과»(FOI `shipped_qty`·FO `shipped_at`·이벤트 넷)는 주인(창고/입점사)을 인자로 받는 모듈로 꺼내 두 경로가 같이 쓴다 — 이벤트 모양이 갈라지지 않게. 상태 전이는 K2 `transitionShipments` 로만, `draft → shipped` 는 입점사 상자 전용 행으로 전이표에 더한다. 시트는 **서버가 JSON 으로 내고 admin-web(PR 7)이 XLSX 로 쓴다** — 열 정의는 core 한 곳이고, 고객 개인정보 접속기록은 기존 `@PiiResponse`·`@PiiExport` 가 남긴다. 올리기는 XLSX 를 서버가 읽는다(`readWorkbookUpload`), 미리보기와 적용은 같은 판정 함수를 돌리고 토큰으로 묶는다(테이블 없음).

**Tech Stack:** NestJS(core, Fastify multipart), Drizzle, Postgres, exceljs(파싱), zod 계약(`packages/event-contracts`, 이 PR 은 읽기만), Jest(unit + `DATABASE_URL` 통합).

**Spec:** `docs/superpowers/specs/2026-10-25-k3-drop-ship-supplier-shipments-design.md` (§4.3-3~9, §4.4, §4.6, §4.9 권한·PII, §7 PR 5 와 그 아래 «PR 5 구현자에게» 두 묶음). ADR `docs/adr/0050-drop-ship-is-a-supplier-shipment.md`. 앞 계획: `2026-10-25-k3-event-contracts-pr3.md`(E3·E4·E5), `2026-10-25-k3-fo-creates-supplier-shipments-pr4.md`(«다음 PR 에 넘기는 것»).

## 코드에서 확인한 것 (설계와 다르거나 설계가 말하지 않은 것)

- **창고 발송·송장·되돌리기는 입점사 상자를 받지 못한다.** `dispatchLocked`(`shipment-dispatch.service.ts:666`)·`WaybillManager.registerManual`(`waybill.manager.ts:252`, `planned` 요구·`loadIssueContext` 가 `warehouseIdOf`)·`ShipmentRecallService.report`(`shipment-recall.service.ts:150` `lockShipmentGraphForDispatch` 가 `warehouseIdOf`, :196 이 `stockJournalId` 요구)가 모두 막는다. 그래서 입점사 갈래는 «재사용»이 아니라 **옆 경로 + 공유 효과 모듈**이다.
- **합배송은 라인을 «복사»한다**(`consolidation.service.ts` `activateConsolidation` — 새 상자에 `addLine`, 원래 상자는 라인을 지닌 채 `superseded`). 라인을 옮기면 빈 상자가 생기고 예약 재계산이 던진다(`shipment-reservation.service.ts:1030`). 그래서 **합포장 뒤에는 상자 라인 id 가 바뀐다** → 시트 행 키는 라인 id 가 아니라 FOI id 다(N3).
- **정합성 점검이 입점사 시도를 위반으로 잡는다.** `fulfillment-invariant.service.ts:325-388` 은 정산된 모든 시도에 재고 원장 이벤트를 요구하고 `kind` 를 읽지 않는다(:646 스냅샷).
- **나누기 경로(`editShipmentManifest`)는 입점사 상자에 안전하다.** 예약 재계산(`recompute`)은 `warehouseIdOf` 를 부르지 않고 예약 0 상자에서 무해하다. 단 `NewShipment` 에 `supplierHandoffId` 가 없어 나눈 상자가 넘김 기록을 잃는다. 활성 송장이 있는 상자는 편집을 거절하므로(:85-88) **나누기·합포장은 송장 등록 전에** 한다.
- **고객에게 파일로 개인정보를 내주는 라우트가 core 에 없다.** `PiiMaskingInterceptor` 는 객체 본문만 가리고 기록한다(`StreamableFile`·`@Res` 는 그대로 통과, `pii-routes.spec.ts:87-89` 가 `@Res` 를 막는다). → N2.
- **택배사 한글 이름 표가 이미 있다** — `store-sales-orders.service.ts:1140`(`CARRIER_NAME_BY_CODE`, 14개)·`:1159-1203`(`CARRIER_CODE_ALIASES`). 모듈 비공개라 꺼낸다.
- **#1136(네이버 KDEXP·쿠팡 CJGLS 매핑 누락)은 이 PR 의 선행이 아니다.** 두 값은 지금도 수기 송장에 열려 있고, 새 8개는 외부 채널에서 manual 로 간다(PR 3 E4, `shipment-dispatch-inbox.worker.ts:480`). 이 PR 이 그 문제를 넓히지 않는다 — 한진 개통 전 선행인 것은 그대로다.

## 이름 붙은 결정 (⛔ 사용자 확인)

- **N1. 한 PR, Core 만, 마이그 없음.** 필요한 칸(`dispatch_attempts.kind`, `supplier_handoffs`, 라인 `unfulfillable_*`, 수기 송장)은 PR 2 가 다 만들었다. 커널(Task 1~7)과 시트(Task 8~10)를 두 PR 로 나눌 수도 있지만 둘 다 휴면·같은 배포라 나눌 이득이 리뷰 크기뿐이다.
- **N2. 시트는 JSON 으로 낸다 — XLSX 는 admin-web(PR 7)이 쓴다.** 응답 `{ handoffId, fileName, columns: {key, header}[], rows }`. 열 정의(`SUPPLIER_SHEET_COLUMNS`)는 core 한 곳이고 올리기 파서도 같은 상수를 읽는다. 이유: 서버가 XLSX 를 내면 접속기록·«기록 실패 시 가림» 규칙(ADR-0048 §29~36)을 손으로 다시 짜고 `pii-routes` 게이트에 새 예외를 열어야 한다. 대가: 권한 부족으로 가려진 값이 시트에 실리면 그 시트는 못 쓴다 — 다시 받기(N5)로 복구한다.
- **N3. 행 키 = FOI id**(스펙 §4.3-4 의 «라인 id» 대신). 합포장이 라인 id 를 바꾸고(위 확인), 입점사는 옛 시트에 계속 채워 온다. 한 FOI 의 «살아 있는 입점사 라인»(canceled·superseded 가 아닌 상자의 라인)은 하나다 — FO 생성이 FOI 하나를 라인 하나로 넣고, 나누기는 라인을 통째로 옮기고, 합포장은 FOI 당 라인 하나로 합친다. 둘 이상이면 프로그래밍 오류(`Error`).
- **N4. 줄 판정(미리보기와 적용이 같은 함수):** `ship`(송장, 그 송장의 줄이 한 상자) · `merge`(같은 (택배사, 송장)이 같은 입점사의 상자 둘 이상) · `unfulfillable` · `waiting`(송장·사유 둘 다 빔) · `correct`(발송된 상자에 다른 송장) · `unchanged`(발송된 상자에 같은 송장, 같은 사유가 이미 기록됨) · `error`(코드 하나). **`unchanged` 는 스펙에 없다** — 입점사는 누적 시트를 보내므로 «이미 보낸 줄»을 오류로 보이면 정상 파일이 매번 빨갛다. 오류 코드:
  `UNKNOWN_ROW_KEY`(uuid 아님·FOI 없음·살아 있는 입점사 라인 없음) · `OTHER_SUPPLIER` · `CANCELED`(FOI 미결 0) · `NOT_HANDED_OFF` · `IN_RECOVERY`(`recovery_code` 있음) · `ROW_MISMATCH`(주문번호 또는 공급사 상품코드가 행 키와 안 맞음) · `QTY_MISMATCH`(수량을 고침 — 부분 발송 표현은 받지 않는다) · `DUPLICATE_ROW` · `UNKNOWN_CARRIER` · `CARRIER_WITHOUT_TRACKING`/`TRACKING_WITHOUT_CARRIER` · `TRACKING_AND_REASON` · `TRACKING_IN_USE`(그 번호의 살아 있는 송장이 이 묶음 밖 상자에 있음 — 이미 발송된 합포장에 더하려면 먼저 되돌린다) · `MERGE_RECIPIENT_MISMATCH`(`canonicalConsolidationRecipient` 가 다름) · `CORRECTION_PARTIAL`(발송된 상자의 줄들이 서로 다른 새 송장) · `REASON_ON_SHIPPED` · `GROUP_HAS_ERROR`.
  **(택배사, 송장) 묶음은 전부 적용하거나 전부 오류다** — 한 줄이 오류면 묶음의 나머지가 `GROUP_HAS_ERROR`. 일부만 합쳐 발송하면 다음 파일의 남은 줄이 `TRACKING_IN_USE` 로 영영 막힌다. 송장번호는 앞뒤 공백·하이픈·내부 공백을 지워 비교·저장한다.
- **N5. 넘김 = `POST /direct-ship/suppliers/:supplierId/handoffs`.** 그 입점사의 넘기지 않은 상자(draft, `supplier_handoff_id IS NULL`, `recovery_code IS NULL`, 판매주문 라인 있음) 전부에 새 묶음을 찍고 시트를 돌려준다. 0 개면 409 `SUPPLIER_HANDOFF_EMPTY`. **다시 받기 = `GET /direct-ship/handoffs/:handoffId/sheet`** — 그 묶음을 가리키는 draft 상자(`recovery_code IS NULL`)의 줄, 이미 알린 «못 보냄» 사유는 채운 채로. 발송된 상자는 싣지 않는다. 둘 다 `order.order.export` + `@PiiResponse` + `@PiiExport`(사유 헤더 필수).
- **N6. 적용은 파일 전체를 한 트랜잭션으로.** 스펙의 «상자 단위로 한 트랜잭션»보다 강하다. 관련 상자를 id 순으로 `FOR UPDATE` 잠근 뒤 판정을 다시 돌려 미리보기 토큰과 비교, 다르면 409 `SUPPLIER_UPLOAD_PREVIEW_STALE`. 경합으로 한 상자가 실패하면 파일 전체가 롤백되고 운영자는 다시 미리보기 한다 — 판정이 멱등(`unchanged`)이라 다시 올려도 안전하다. 토큰 = 판정 목록 + 관련 상자 `manifest_version` 의 sha256(선례 `stocktaking-preview-token.ts`).
- **N7. 합포장 상자의 넘김 기록 = 원래 상자들 중 가장 이른 묶음.** 나눈 상자는 원래 상자의 묶음을 물려받는다(`NewShipment.supplierHandoffId`). 합포장은 운영 기록(`shipment_operations` 류)을 남기지 않는다 — 새 라인의 `createdFromLineId` 가 원래 라인을 가리킨다.
- **N8. 발송된 줄의 «못 보냄» 기록은 지운다.** 기록은 «지금 입점사가 못 보낸다는 주장»이다. 빈 줄(`waiting`)은 기존 기록을 지우지 않는다 — 옛 시트가 다시 올라와도 기록이 안 사라지게. 사유가 바뀌면 덮어쓴다(`unfulfillable`).
- **N9. 정정은 이벤트를 다시 내지 않는다.** 옛 수기 송장 `used → voided`, 새 수기 송장 `used`, 시도의 `waybill_id` 를 새 송장으로. 고객 추적(`buildV2TrackingShipments`)은 core 를 읽으므로 바로 바뀐다. Medusa `coreShipmentAttempts`·`FulfillmentShipped` 메타데이터와 고객 발송 문자는 옛 번호로 남는다(자동 리뷰 자격은 번호를 안 본다). 정정 이벤트가 필요해지면 그때 계약을 넓힌다.
- **N10. 되돌리기는 같은 라우트·같은 명령(`shipment.dispatch.recall`)·같은 권한, `report` 첫머리에서 갈린다.** 입점사 상자면 원장 잠금·역분개·예약 복구·추적 게이트(자동 조회가 없다)를 건너뛰고 한 트랜잭션에서 `shipped → recovery_required(DISPATCH_RECALL_PENDING) → draft`, 시도 `dispatched → recalled`, 수기 송장 `voided`, FOI `shipped_qty` 감소, FO `shipped_at` NULL, 투영, `ShipmentDispatchRecalled`·`FulfillmentReopened` 를 창고와 같이 낸다. DTO 의 `physicalRecoveryConfirmed: true` 는 그대로 요구한다(«입점사와 확인함»). 회수 대기가 트랜잭션 밖에 보이지 않으므로 PR 4 가 넘긴 «보드의 회수 대기 입점사 상자» 질문은 없어진다.
- **N11. 문 제거: `CONSUMER_ROLLOUT_CARRIERS`·`isConsumerRolloutCarrier`·`ConsumerRolloutCarrier` 를 지운다.** 송장 DTO 셋(발급·수기·일괄 발급)은 `carrierEnum.enumValues`(14개)를 받는다 — 발급은 어차피 게이트웨이 레지스트리가 모르는 택배사를 거절한다. 계약↔core 타입 동치 가드는 남긴다.
- **N12. K6 `forwarded` 는 «못 보냄» 라인을 계속 포함한다**(고객에게 「배송 중」). 관리자가 건마다 고객에게 연락한다(스펙 D6). 바꾸려면 PR 4 의 읽기를 고치는 별건.
- **N13. 옛 직배 쓰기 경로(`direct-ship.service.ts` 넘김·완료, `ship()`, `computeAdminAvailableActions`)는 그대로 둔다** — admin-web 버튼이 쓰고 있어 PR 7 이 화면을 바꾼 뒤 PR 8 이 지운다.

## Global Constraints

- **마이그 없음.** 새 칸·인덱스가 필요해 보이면 멈추고 사용자에게 묻는다.
- 입점사 상자 상태는 `transitionShipments` 로만 바뀐다. `draft → shipped` 는 입점사 상자 전용(CAS 에 `supplier_id IS NOT NULL`).
- 창고 흐름 진입 함수(`supplier-shipment-entry.guard.spec.ts` `WAREHOUSE_FLOW_ENTRIES`)는 줄이지 않는다. 입점사 갈래는 그 함수에 들어가기 **전에** 가른다.
- FO·FOI status 는 `reprojectFulfillmentOrders` 만 쓴다(`fulfillment-order-status-writes.guard.spec.ts` 허용 목록 그대로).
- 업로드는 취소·환불을 정하지 않는다(스펙 반목표). «못 보냄»은 라인 수량을 바꾸지 않는다.
- 이벤트 계약(`packages/event-contracts/**`)은 바꾸지 않는다. 입점사 발송 이벤트는 PR 3 계약 그대로 맞는다(`ShipmentShipped.supplierId`, `dispatchAttemptId` = `kind='supplier'` 시도).
- 트랜잭션·쿼리 규칙(ADR-0025, CLAUDE.md Inventory): `tx` 전파, `db.query.*`·`with`·`any`/`as` 금지(raw `execute` 결과 캐스트는 기존 파일과 같은 문서화된 캐스트만). 새 에러는 `ApplicationException` 하위 클래스(선례 `shipment/shipment-owner.ts`).
- 새 라우트는 `@RequirePermission`(`route-classification.spec.ts`), 개인정보 응답은 `@PiiResponse` + `scripts/security/pii-routes.ts` 한 줄(`pii-routes.spec.ts`). POST 넘김은 본문에 개인정보가 없으므로 `PII_WRITE_EXEMPT`. 응답 DTO 는 중첩 클래스.
- 시트 머리글(한국어, 입점사가 본다) — `SUPPLIER_SHEET_COLUMNS` 순서 그대로: `행 키(지우지 마세요)` · `주문번호` · `상품명` · `공급사 상품코드` · `수량` · `수령인` · `연락처` · `주소` · `공동현관 비밀번호` · `배송 메모` · `택배사` · `송장번호` · `못 보냄 사유`. 파서는 위치가 아니라 머리글 글자로 찾는다(앞뒤 공백 무시). 빠진 머리글이 있으면 400 `SUPPLIER_SHEET_HEADER_MISSING`(빠진 이름들). 줄 상한 2,000(초과 400 `SUPPLIER_SHEET_TOO_MANY_ROWS`), 파일 상한은 기존 10MB.
- 통합 테스트: 스크래치 DB `k3_pr2_it`. `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k3_pr2_it npx jest --runInBand --runTestsByPath <파일…>`. 꺼져 있으면 `docker start almondyoung-server-postgres-1`. develop 에 새 마이그가 생겼으면 먼저 `DATABASE_URL=… npx drizzle-kit migrate --config apps/core/drizzle.config.ts`. 입점사 상자는 실제 생성 경로로 만든다(본보기 `services/fulfillments.supplier-shipments.integration.spec.ts` 의 `wireLogistics` + `wired.fulfillments.create`).
- 기준선: 브랜치 시작 때 `k3_pr2_it` 에서 `apps/core/src/modules/fulfillment apps/core/src/modules/sales-order` 의 `*.integration.spec.ts` 를 한 번 돌려 실패 목록을 scratchpad 에 둔다.
- 워크트리: node_modules 심볼릭 링크(루트·`apps/*`·`web/*`·`native/warehouse-app`)가 있어야 jest 매퍼가 산다(PR 4 메모).
- 검증 게이트: `npm run type-check` 에러 0, `npx jest` 실패 0(이 PC 의 admin-web attendance spec 4개는 ICU 환경 실패 — 비교만), 통합 기준선 외 실패 0.

## Review Focus

- **입점사가 같은 시트를 두 번 올림** — 두 번째는 전부 `unchanged`/`waiting`, 쓰기 0, 이벤트 0. Task 10 케이스.
- **합포장 뒤 옛 시트로 정정** — 행 키(FOI)가 합친 상자의 라인을 찾아 `correct`. 합친 상자의 줄 일부만 새 번호면 `CORRECTION_PARTIAL`. Task 9 케이스.
- **섞인 FO 에서 직배분만 발송** — 창고 상자가 아직 draft 여도 FO `shipped_at` 은 비고, FOI 투영은 직배 FOI 만 `shipped`, `FulfillmentShipped` v1 은 안 나간다. Task 4 케이스.
- **되돌린 직배 상자가 다음 시트에서 다시 발송** — 시도 번호 2, 같은 송장번호 재사용 가능(옛 송장은 `voided`라 `uq_waybills_tracking_live` 밖). Task 7 케이스.
- **넘김 직후 그 주문이 취소 재계획 중(`recovery_code` 있음)** — 넘김·다시 받기에 실리지 않고, 올라오면 `IN_RECOVERY`. Task 8·9 케이스.

---

## 배포

- 배포 단위: **Core 만**, 마이그 없음. **PR 3 라이브(태그 `deploy/live/20261025-1717`) 뒤에만** 배포한다 — 충족됨. 그 전에 core 가 새 택배사·`supplierId` 를 내면 옛 소비자가 zod 로 throw 한다.
- 🔴 **이 PR 라이브 뒤에는 channel-adapter·notification 을 PR 3 이전으로 롤백하지 않는다** — 새 값을 거절해 DLQ 로 간다(PR 3 계획에서 옮겨 적음).
- Core 롤백(PR 4 로): 입점사 발송 시도가 0 인 동안 안전하다. 하나라도 생긴 뒤면 옛 정합성 점검이 그 시도를 `DISPATCH_*_CARDINALITY` 위반으로 잡고(소음), 옛 되돌리기는 입점사 상자를 409 로 거절한다. 개통(첫 직배 SKU)은 PR 1~7 라이브 뒤다.

---

### Task 0: 착수 전 라이브 실측 (사용자 터널)

**Files:** 없음(결과는 PR 본문에).

- [ ] **Step 1: 사용자에게 터널을 부탁한다** — `npx sst tunnel --stage live`. 터널은 사용자가 띄운다.
- [ ] **Step 2: 읽기 전용으로 잰다**

```sql
SELECT count(*) AS supplier_shipments FROM shipments WHERE supplier_id IS NOT NULL;
SELECT count(*) AS supplier_attempts FROM dispatch_attempts WHERE kind = 'supplier';
SELECT count(*) AS handoffs FROM supplier_handoffs;
SELECT count(*) AS new_carrier_waybills FROM waybills
 WHERE carrier NOT IN ('CJ','HANJIN','LOTTE','LOGEN','KDEXP','CJGLS');
```

Expected: 넷 다 0. 하나라도 0 이 아니면 **멈추고 사용자에게 보고한다** — 롤백 절과 «휴면» 전제다.

### Task 1: 문 제거 · 택배사 이름 표 하나

**Files:**
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/carrier-gateway.interface.ts:12-17` — 셋 삭제
- Modify: `apps/core/src/modules/fulfillment/waybill/dto/waybill.dto.ts:3,10,19,48` — N11
- Rename: `waybill/carrier/consumer-rollout-carriers.spec.ts` → `waybill/carrier/carrier-contract-equality.spec.ts` — 타입 동치(:6-15)만 남기고 6개 단언(:18-20) 삭제
- Modify: `apps/core/src/modules/fulfillment/services/shipment-dispatch.service.ts:50,1160-1164` — 가드 삭제
- Modify: `services/shipment-dispatch.service.spec.ts:380-393` — «refuses to emit a carrier outside…» → `emits ShipmentShipped with an EPOST waybill`(같은 셋업, `EPOST` 송장 → `ShipmentShipped.invoice.carrier === 'EPOST'`)
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:87-88` — 주석을 «14개 모두 이벤트 계약과 같다(`carrier-contract-equality.spec.ts`)»로
- Create: `apps/core/src/modules/fulfillment/waybill/carrier/carrier-names.ts`, `carrier-names.spec.ts`
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:1140-1212` — 표를 새 파일에서 import, `normalizeCarrierCode` 동작(모르면 원값/`'UNKNOWN'`)은 그대로

**Interfaces:**
- Produces: `export const CARRIER_NAME_BY_CODE: Record<CarrierCode, string>`, `export const CARRIER_CODE_ALIASES: Readonly<Record<string, CarrierCode>>`(지금 표 그대로), `export function parseCarrierName(raw: string): CarrierCode | null` — 앞뒤 공백·내부 공백 무시, 코드(대소문자 무시)·한글 이름·별칭을 받고 모르면 `null`.

- [ ] **Step 1: spec** — `parseCarrierName`: `'우체국'`·`'우체국택배'`·`'epost'`·`' EPOST '` → `EPOST`; `'CJ 대한통운'` → `CJ`; `CARRIER_NAME_BY_CODE` 의 14개 이름이 전부 자기 코드로 돌아온다; `'없는택배'`·`''` → `null`. DTO: `validate(plainToInstance(RegisterManualWaybillDto, { expectedManifestVersion: 1, carrier: 'EPOST', trackingNo: '1' }))` 에러 0, `carrier: 'NOPE'` 에러 1
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — `npx jest apps/core/src/modules/fulfillment/waybill apps/core/src/modules/fulfillment/services/shipment-dispatch.service.spec.ts apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts` PASS, `grep -rn "CONSUMER_ROLLOUT\|ConsumerRollout\|isConsumerRolloutCarrier" apps packages libs --include=*.ts` 0줄, `npm run type-check` 에러 0
- [ ] **Step 3: Commit** — `git commit -m "K3 PR5 — 옛 6개 택배사 문을 지운다(PR 3 라이브 뒤), 택배사 이름 표 하나"`

### Task 2: 발송 뒤 효과를 주인 중립 모듈로 꺼낸다 (동작 그대로)

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/dispatch-effects.ts`
- Modify: `services/shipment-dispatch.service.ts` — `incrementFulfillmentItems`(:1024)·`loadFulfillmentSummaries`(:1042)·`loadEventLineIdentities`(:1084)·`emitDispatchEvents`(:1145)·`enqueueCustomerShipmentNotices`(:1235)·FO `shippedAt` 루프(:866-873)를 새 모듈 호출로
- Test: 기존 `services/shipment-dispatch.service.spec.ts`·발송 통합 spec 들이 그대로 통과(새 spec 없음 — 행동 보존 리팩터)

**Interfaces:**
- Produces(전부 `export async function`, 첫 인자 `tx: DbTx`, 이벤트를 내는 함수는 지금 서비스가 쓰는 outbox 의존을 인자로 받는다):
  - `incrementFulfillmentItems(tx, lines: ShipmentLineRow[], at: Date): Promise<void>` — 지금 본문 그대로(초과 발송 가드 포함)
  - `markFullyShippedOrders(tx, lines: ShipmentLineRow[], at: Date): Promise<FulfillmentSummary[]>` — 요약을 읽고 전량이면 FO `shipped_at`
  - `emitShipmentDispatched(deps: DispatchEventDeps, tx, e: DispatchedShipmentFacts): Promise<void>` — `DispatchedShipmentFacts = { origin: { warehouseId: string } | { supplierId: string }; shipmentId; attemptId; attemptNo; dispatchedAt; waybill: { id; carrier: CarrierCode; trackingNo: string }; summaries: FulfillmentSummary[] }`. 안에서 `loadEventLineIdentities` 를 부르고 지금의 이벤트 넷을 같은 키·같은 페이로드로 낸다. `ShipmentShipped` 의 출처 칸은 `origin` 을 그대로 펼친다
  - `DispatchEventDeps` = 지금 `emitDispatchEvents` 가 쓰는 서비스 의존(outbox writer 등) — 이름은 지금 필드 그대로

- [ ] **Step 1: 옮긴다** — 창고 경로는 `origin: { warehouseId: warehouseIdOf(aggregate.shipment) }`
- [ ] **Step 2: 회귀** — `npx jest apps/core/src/modules/fulfillment/services` PASS, 발송 통합 spec(`grep -rlE "dispatchLocked|inspectionScan|forceDispatch" apps/core/src/modules/fulfillment --include=*.integration.spec.ts`) 기준선과 같음, `npm run type-check` 에러 0. `supplier-shipment-entry.guard.spec.ts` 가 빨개지면(진입 함수 목록이 함수 이름을 본다) 목록을 줄이지 말고 `dispatchLocked` 가 여전히 `warehouseIdOf` 를 부르는지 본다
- [ ] **Step 3: Commit** — `git commit -m "K3 PR5 — 발송 뒤 효과(수량·FO 발송 시각·이벤트 넷)를 주인 중립 모듈로"`

### Task 3: 커널 — 입점사 `draft → shipped`, 넘김 상속, 정합성 점검, 쓰기 가드

**Files:**
- Modify: `apps/core/src/modules/fulfillment/shipment/shipment-transitions.ts` — `TransitionRule.owner?: 'supplier'`, 행 `{ from: 'draft', to: 'shipped', owner: 'supplier' }`
- Modify: `shipment/shipment-lifecycle.ts` — `validate`/CAS: 적용된 행에 `owner: 'supplier'` 가 있으면 CAS 에 `supplier_id IS NOT NULL`(창고 상자는 0행 → `stale` 정책). `NewShipment.supplierHandoffId?: string | null` 을 `insertShipment` 가 쓴다
- Modify: `shipment/shipment-manifest-edit.ts` — `writer.createShipment` 가 `supplierHandoffId` 를 넘긴다
- Modify: `services/fulfillment-invariant.service.ts` — 스냅샷 시도에 `kind`, :325 루프는 `kind === 'warehouse'` 만. 새 위반 종류 없이 `kind === 'supplier'` 이면서 원천 행이 있거나 원장 id 가 있으면 `DISPATCH_SOURCE_CARDINALITY`
- Modify: `shipment/shipment-writes.guard.spec.ts` — `supplier-shipment/` 폴더 파일에만 `supplierHandoffId`(shipments)·`unfulfillableReason`·`unfulfillableReportedAt`·`unfulfillableReportedBy`(lines) 허용
- Test: `shipment/shipment-transitions.spec.ts`, `shipment/shipment-lifecycle.integration.spec.ts`, `services/fulfillment-invariant.service.spec.ts`

- [ ] **Step 1: spec** — 전이: `draft → shipped` 는 `owner: 'supplier'` 행으로만 합법(`assertLegalTransition('draft','shipped',{})` 통과, 행의 owner 가 `supplier`); 통합: 입점사 draft 상자 `draft→shipped` 1행·`shipped_at` 찍힘, **창고 draft 상자는 같은 호출에 0행**(`stale: 'unreachable'` 이면 throw); `openShipment({ …, supplierHandoffId })` 가 칸을 쓴다; 점검: `kind='supplier'` 정산 시도(원천 0·원장 NULL) → 위반 0, 원천 1행 붙이면 `DISPATCH_SOURCE_CARDINALITY`; 창고 시도 기존 케이스 그대로
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — 세 spec + `npx jest apps/core/src/modules/fulfillment/shipment` PASS, `npm run type-check` 에러 0
- [ ] **Step 3: Commit** — `git commit -m "K3 PR5 — 입점사 상자만 draft에서 바로 발송, 나눈 상자는 넘김을 물려받고, 점검은 입점사 시도에 원장을 요구하지 않는다"`

### Task 4: 입점사 상자 발송 (상자 하나, 송장 하나)

**Files:**
- Create: `apps/core/src/modules/fulfillment/supplier-shipment/supplier-dispatch.ts`, `supplier-dispatch.integration.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.repository.ts` — `insertSupplierManualUsed`
- Create: `supplier-shipment/supplier-shipment.errors.ts` — 이 폴더의 에러 클래스(Task 4~10)

**Interfaces:**
- Produces:
  - `export async function shipSupplierShipment(deps: SupplierDispatchDeps, tx: DbTx, cmd: { shipmentId: string; carrier: CarrierCode; trackingNo: string; actorId: string; at: Date }): Promise<{ attemptId: string; attemptNo: number; waybillId: string }>`
  - `SupplierDispatchDeps = DispatchEventDeps & { audit: <창고 발송 서비스의 audit 의존 타입> }` — Nest provider 가 아니라 호출자(Task 10 서비스)가 주입받아 넘긴다
  - `WaybillRepository.insertSupplierManualUsed(tx, row: { shipmentId; carrier; trackingNo; manifestVersion; createdBy }): Promise<{ id: string }>` — `source='manual'`, `status='used'`. `uq_waybills_tracking_live` 위반은 `SupplierTrackingInUseError`(409 `TRACKING_IN_USE`)
- 순서(한 트랜잭션, 호출자가 상자를 이미 잠갔다고 가정하지 않는다 — 상자 `FOR UPDATE`):
  1. 상자 = 입점사·`draft`·`recovery_code IS NULL`·`supplier_handoff_id IS NOT NULL`·라인 ≥1, 아니면 409 `SUPPLIER_SHIPMENT_NOT_SHIPPABLE`(상태 포함). 활성 송장 있음 → 같은 에러
  2. 수기 송장(`manifestVersion` = 상자의 지금 값 — `ACTIVE_INVOICE_VERSION` 점검)
  3. 시도: `kind='supplier'`, `attemptNo = max+1`, `idempotencyKey = supplier-dispatch:${shipmentId}:${attemptNo}`, `status='dispatched'`, `dispatchedAt = at`, `waybillId`, 원장 NULL(CHECK 들이 받는지는 통합 spec 이 판정)
  4. `transitionShipments({ from: ['draft'], to: 'shipped', at, stale: 'unreachable' })`
  5. `incrementFulfillmentItems` → 라인의 `unfulfillable_*` NULL(N8) → `reprojectFulfillmentOrders(tx, foIds)` → `markFullyShippedOrders` → `emitShipmentDispatched({ origin: { supplierId } … })` → 창고와 같은 감사 기록(`logUserActionRequired('shipment.dispatch', …)`, 메시지 «supplier»)

- [ ] **Step 1: 통합 spec** (`wired.fulfillments.create` 로 섞인 주문을 만들고 `seedHandoff` 로 넘김)
  - `넘긴 입점사 상자를 EPOST 송장으로 발송하면 상자 shipped, 시도 kind supplier·원장 NULL, 송장 manual·used, FOI shipped_qty = 수량` 
  - `고객 추적에 상자별 택배사·송장번호가 나온다` — `buildV2TrackingShipments`(또는 그것을 부르는 공개 메서드)에 그 상자 `{ status: 'shipped', carrier: 'EPOST', trackingNo }`. 발송 전 draft 입점사 상자는 창고 draft 상자와 같은 모양(`status: 'draft'`, 송장 없음)이다(PR 4 가 넘긴 확인)
  - `outbox 에 ShipmentShipped(supplierId, warehouseId 없음)·SalesOrderShipmentDispatched·FulfillmentProgressed` — 실제 outbox 행을 읽어 계약 zod(`ShipmentShippedSchema` 등)로 parse 통과
  - `섞인 FO 에서 직배분만 발송하면 FO shipped_at NULL, FulfillmentShipped v1 없음`; `직배분만인 FO 면 shipped_at 찍히고 v1 이 실제 택배사·송장으로`
  - `못 보냄 기록이 있던 라인은 발송 뒤 기록이 비어 있다`
  - `넘기지 않은 상자·창고 상자·recovery_code 상자는 SUPPLIER_SHIPMENT_NOT_SHIPPABLE`, `다른 상자에서 살아 있는 송장번호는 TRACKING_IN_USE 이고 아무것도 남지 않는다`
  - `정합성 점검 위반 0`(발송 직후 그 FO)
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — spec PASS, `npm run type-check` 에러 0
- [ ] **Step 3: Commit** — `git commit -m "K3 PR5 — 입점사 상자 발송: 수기 송장·입점사 시도·창고와 같은 이벤트"`

### Task 5: 나누기 · 합포장

**Files:**
- Create: `supplier-shipment/supplier-manifest.ts`, `supplier-manifest.integration.spec.ts`

**Interfaces:**
- Produces:
  - `export async function splitOffSupplierLines(deps: ManifestEditDeps, tx: DbTx, shipmentId: string, lineIds: readonly string[]): Promise<string>` — 그 라인들을 새 draft 입점사 상자로 옮기고 새 상자 id. 라인이 상자의 전부면 옮기지 않고 원래 id 를 돌려준다. `editShipmentManifest(allow: ['draft'])` + `writer.createShipment`(주인·수령인·공동현관 비번·배송 프로필 NULL·`supplierHandoffId` 를 원래 상자에서) + `writer.moveLine`
  - `export async function mergeSupplierShipments(deps: ManifestEditDeps, tx: DbTx, shipmentIds: readonly string[]): Promise<string>` — 둘 이상, 전부 같은 입점사·`draft`·`recovery_code NULL`, `canonicalConsolidationRecipient` 같음(다르면 409 `MERGE_RECIPIENT_MISMATCH`). 새 상자 하나에 FOI 당 라인 하나(`addLine`, qty 합, `createdFromLineId`), 공동현관 비번은 `selectEntrancePasswordForMerge`, 넘김은 N7, 원래 상자 `draft → superseded`. 새 상자 id

- [ ] **Step 1: 통합 spec**
  - `라인 셋 중 둘을 떼면 새 상자에 둘(같은 라인 id), 원래 상자에 하나, 둘 다 같은 넘김·수령인`
  - `전부를 떼면 원래 상자 그대로`
  - `같은 입점사의 두 주문 상자를 합치면 새 상자 하나, 원래 둘 superseded, 새 라인 createdFromLineId, 넘김은 더 이른 묶음`
  - `수령인이 다르면 MERGE_RECIPIENT_MISMATCH`, `다른 입점사면 409`, `창고 상자를 섞으면 409`
  - `합친 상자를 발송하면 두 판매주문 각각에 SalesOrderShipmentDispatched`(Task 4 의 `shipSupplierShipment` 로)
  - 나누기·합치기 뒤 정합성 점검 위반 0, 예약 행 0
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — spec PASS, `npm run type-check` 에러 0
- [ ] **Step 3: Commit** — `git commit -m "K3 PR5 — 입점사 상자 나누기·합포장(창고 합배송과 같은 표현)"`

### Task 6: 정정 · 못 보냄

**Files:**
- Create: `supplier-shipment/supplier-line-reports.ts`, `supplier-line-reports.integration.spec.ts`

**Interfaces:**
- Produces:
  - `export async function correctSupplierWaybill(deps, tx: DbTx, cmd: { shipmentId; carrier: CarrierCode; trackingNo: string; actorId; at }): Promise<{ waybillId: string }>` — N9. 상자 `shipped`·입점사가 아니면 409. 같은 (택배사, 번호)면 아무것도 안 하고 지금 송장 id
  - `export async function reportUnfulfillable(tx: DbTx, cmd: { shipmentLineId; reason: string; actorId; at }): Promise<'recorded' | 'unchanged'>` — 라인의 상자가 입점사·`draft` 가 아니면 409 `REASON_ON_SHIPPED`. 사유는 trim, 빈 문자열이면 400. 같은 사유면 `'unchanged'`(시각·사람 안 바꿈)

- [ ] **Step 1: 통합 spec** — 정정: 발송된 상자에 새 번호 → 옛 송장 `voided`, 새 송장 `used`, 시도 `waybill_id` = 새 송장, 고객 추적이 새 번호, outbox 새 행 0, 상자 상태·`manifest_version` 그대로, 점검 위반 0. 못 보냄: 기록 세 칸 채움·라인 수량 그대로·보드 `drop_ship_unfulfillable`(PR 4 판정 SQL), 같은 사유 다시 → `'unchanged'`, 발송된 상자 라인 → 409
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — spec PASS, `npm run type-check` 에러 0. 시도의 `waybill_id` 갱신을 막는 트리거·가드가 있으면 **멈추고 사용자에게 묻는다**(N9 의 전제)
- [ ] **Step 3: Commit** — `git commit -m "K3 PR5 — 직배 송장 정정과 못 보냄 기록"`

### Task 7: 발송 되돌리기 — 입점사 갈래

**Files:**
- Create: `supplier-shipment/supplier-recall.ts`
- Modify: `apps/core/src/modules/fulfillment/services/shipment-recall.service.ts` `report`(:112) — `commands.execute` 안, `lockShipmentGraphForDispatch`(:150) **앞**에서 상자 주인을 읽어 입점사면 `recallSupplierShipment` 로. 작업 기록 행(:150 뒤의 operation·member)은 창고와 같이 쓴다
- Test: `supplier-shipment/supplier-recall.integration.spec.ts`, 기존 `shipment-recall` spec 회귀

**Interfaces:**
- Produces: `SupplierRecallDeps` = 리콜 서비스가 지금 이벤트를 낼 때 쓰는 outbox 의존 그대로. `export async function recallSupplierShipment(deps: SupplierRecallDeps, tx: DbTx, cmd: { shipmentId; dispatchAttemptId; recallOperationId: string; actorId; at: Date }): Promise<void>` — N10 의 순서. 시도는 `kind='supplier'`·`dispatched`·`waybillId`·`dispatchedAt` 필수(원장 요구 없음). 이벤트는 창고 경로의 `ShipmentDispatchRecalled`·`FulfillmentReopened` 생성자를 같은 키로(필요하면 Task 2 처럼 `dispatch-effects.ts` 로 꺼낸다)

- [ ] **Step 1: 통합 spec** — 발송된 입점사 상자 되돌리기 → 상자 `draft`(넘김 그대로, `recovery_code` NULL), 시도 `recalled`, 송장 `voided`, FOI `shipped_qty` 원래대로, FO `shipped_at` NULL·투영 되돌림, outbox `ShipmentDispatchRecalled`(+전량이었으면 `FulfillmentReopened`) 계약 parse 통과, 원장 이벤트 0; **같은 번호로 다시 발송하면 시도 2·성공**; 합친 상자 되돌리기 → 합친 상자 그대로 draft; 권한·멱등 키·`physicalRecoveryConfirmed` 검증은 창고와 같다(같은 키로 두 번 → 두 번째는 첫 결과); 창고 되돌리기 기존 spec 그대로
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — spec PASS, `npx jest apps/core/src/modules/fulfillment/services/shipment-recall` PASS, `supplier-shipment-entry.guard.spec.ts` 초록(목록 그대로), `npm run type-check` 에러 0
- [ ] **Step 3: Commit** — `git commit -m "K3 PR5 — 직배 발송 되돌리기: 창고와 같은 명령, 원장·예약 갈래를 건너뛴다"`

### Task 8: 넘김 · 시트 내려받기

**Files:**
- Create: `supplier-shipment/supplier-sheet.columns.ts` — `SUPPLIER_SHEET_COLUMNS`(Global Constraints 의 순서·머리글)
- Create: `supplier-shipment/supplier-handoff.service.ts`, `supplier-handoff.integration.spec.ts`
- Create: `apps/core/src/modules/fulfillment/dto/supplier-sheet.dto.ts`
- Modify: `controllers/direct-ship.controller.ts` — 라우트 둘, 모듈 providers
- Modify: `scripts/security/pii-routes.ts` — `PII_ROUTES` 두 줄(`'core POST /direct-ship/suppliers/:supplierId/handoffs'`, `'core GET /direct-ship/handoffs/:handoffId/sheet'`), `PII_WRITE_EXEMPT` 에 POST 한 줄(«본문 없음»)

**Interfaces:**
- Produces:
  - `export const SUPPLIER_SHEET_COLUMNS: readonly { key: SupplierSheetKey; header: string }[]`, `export type SupplierSheetKey = 'rowKey' | 'orderNo' | 'productName' | 'supplierSku' | 'qty' | 'recipientName' | 'recipientPhone' | 'address' | 'entrancePassword' | 'deliveryMemo' | 'carrier' | 'trackingNo' | 'unfulfillableReason'`
  - `SupplierHandoffService.handOff(supplierId: string, actorId: string, tx?: DbTx): Promise<SupplierSheet>` / `.sheet(handoffId: string, tx?: DbTx): Promise<SupplierSheet>`
  - `SupplierSheet = { handoffId; supplierId; fileName: string; columns; rows: SupplierSheetRow[] }`, `fileName = 직배_${입점사 이름}_${KST yyyyMMdd-HHmm}.xlsx`. `SupplierSheetRow` = 열 키 전부(`rowKey` = FOI id, `carrier`·`trackingNo` 는 빈 문자열, `unfulfillableReason` 은 기록이 있으면 그 값) + `salesOrderId`(PII 대상 식별자, 시트 열은 아님). 수령인 칸은 상자 `recipient_snapshot` 을 창고 송장과 같은 방식(`parseRecipient`)으로 읽는다. 줄 순서: 주문번호, 상품명
- 라우트(N5): `POST /direct-ship/suppliers/:supplierId/handoffs`, `GET /direct-ship/handoffs/:handoffId/sheet` — `@RequirePermission('order.order.export')`, `@PiiExport()`, `@PiiResponse({ fields: 'rows[].recipientName' 등 수령인·연락처·주소·공동현관 비번, subjects: [{ path: 'rows[].salesOrderId', type: 'sales_order' }], rawWithByField: OPEN_WITH_RECIPIENT })` — 선례 `direct-ship.controller.ts:184-207`. id 는 `ParseUUIDPipe`

- [ ] **Step 1: 통합 spec** — 입점사 A: 넘기지 않은 상자 2(그중 하나 `recovery_code` 있음), 넘긴 상자 1; 입점사 B 상자 1
  - `넘김은 A 의 넘기지 않은 정상 상자 하나에만 새 묶음을 찍고 그 줄만 시트에` — 행 키 = FOI id, 공급사 상품코드 = A 와의 `supplier_sku`, 수령인·공동현관 비번 채움, B 상자 그대로
  - `넘길 상자가 없으면 SUPPLIER_HANDOFF_EMPTY`(두 번째 넘김)
  - `다시 받기는 같은 줄, 못 보냄 사유가 채워져 있고, 발송된 상자는 빠진다`
  - 컨트롤러 유닛 또는 e2e 없이: `npx jest libs/authorization scripts/security` 초록(`route-classification`·`pii-routes`·`pii-write-routes`·`permission-wiring`)
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — spec PASS, `npm run type-check` 에러 0
- [ ] **Step 3: Commit** — `git commit -m "K3 PR5 — 넘김과 직배 시트: 입점사별 넘기지 않은 상자에 묶음을 찍고 시트를 JSON 으로"`

### Task 9: 올린 시트 읽기 · 줄 판정 (미리보기)

**Files:**
- Create: `supplier-shipment/supplier-sheet.parser.ts`, `supplier-sheet.parser.spec.ts` — exceljs, `bulk-upload.parser.ts` 의 로딩 방식을 따른다
- Create: `supplier-shipment/supplier-sheet.judge.ts`, `supplier-sheet.judge.integration.spec.ts`
- Create: `supplier-shipment/supplier-sheet-preview-token.ts`

**Interfaces:**
- Produces:
  - `export async function parseSupplierSheet(buffer: Buffer): Promise<ParsedSupplierRow[]>` — 첫 시트, 첫 줄 = 머리글. `ParsedSupplierRow = { rowNumber: number; rowKey; orderNo; supplierSku; qty: number | null; carrierRaw; trackingNo; reason }`(나머지 열은 읽지 않는다). 모든 칸이 빈 줄은 건너뛴다. 숫자·날짜 칸은 표시 문자열로(`supplierSku`·`orderNo`·`trackingNo` 가 숫자로 들어와도 앞자리 0 이 사라지지 않게 셀 `text` 를 쓴다)
  - `export async function judgeSupplierSheet(tx: DbTx, supplierId: string, rows: readonly ParsedSupplierRow[], opts: { lock: boolean }): Promise<SupplierSheetJudgement>` — `{ rows: RowVerdict[]; plan: SupplierApplyPlan; token: string }`. `RowVerdict = { rowNumber; rowKey; orderNo; verdict: 'ship'|'merge'|'unfulfillable'|'waiting'|'correct'|'unchanged'|'error'; code?: SupplierRowErrorCode; carrier?: CarrierCode; trackingNo?: string }` — 개인정보 없음. `lock` 이면 관련 상자를 id 순 `FOR UPDATE`
  - `SupplierApplyPlan = { shipGroups: { carrier; trackingNo; boxes: { shipmentId; lineIds: string[] }[] }[]; corrections: { shipmentId; carrier; trackingNo }[]; reports: { shipmentLineId; reason }[] }` — 적용(Task 10)은 이것만 실행한다
  - `export function supplierSheetPreviewToken(rows: readonly RowVerdict[], manifestVersions: ReadonlyMap<string, number>): string` — 정렬된 정규 JSON 의 sha256
  - `SupplierRowErrorCode` = N4 의 코드 목록 그대로(문자열 유니온)

- [ ] **Step 1: 파서 spec** — exceljs 로 `SUPPLIER_SHEET_COLUMNS` 머리글 시트를 만들어: 정상 2줄 → 2개; 열 순서를 섞어도 같다; `송장번호` 머리글 없음 → `SUPPLIER_SHEET_HEADER_MISSING`(`['송장번호']`); 2,001줄 → `SUPPLIER_SHEET_TOO_MANY_ROWS`; 송장번호 숫자 셀 `012345` 텍스트 서식 → `'012345'`; 빈 줄 건너뜀
- [ ] **Step 2: 판정 통합 spec** — N4 의 판정·코드마다 한 케이스, 그리고:
  - `한 상자의 줄 셋 중 둘만 송장 T → ship 둘·waiting 하나, plan 은 그 상자에서 두 라인`
  - `두 주문 상자의 줄이 같은 T → merge, plan 의 묶음에 상자 둘`
  - `묶음 한 줄이 QTY_MISMATCH 면 나머지는 GROUP_HAS_ERROR, plan 에 그 묶음 없음`
  - `합포장 뒤 발송된 상자의 옛 행 키 + 새 번호 → correct`; `그 상자 줄 일부만 새 번호 → CORRECTION_PARTIAL`
  - `같은 시트를 발송 뒤 다시 → 전부 unchanged/waiting, plan 빔`
  - `'우체국' 은 EPOST, '12-34 56' 은 '123456'`
  - `토큰은 같은 입력에 같고, 상자 manifest_version 이 바뀌면 다르다`
- [ ] **Step 3: 실패 확인 → 구현 → 통과** — 두 spec PASS, `npm run type-check` 에러 0
- [ ] **Step 4: Commit** — `git commit -m "K3 PR5 — 직배 시트 읽기와 줄 판정(발송·합포장·못 보냄·아직·정정·그대로·오류)"`

### Task 10: 올리기 — 미리보기 · 적용 라우트

**Files:**
- Create: `supplier-shipment/supplier-sheet-apply.service.ts`, `supplier-sheet-apply.integration.spec.ts`
- Modify: `controllers/direct-ship.controller.ts` — 라우트 둘, `dto/supplier-sheet.dto.ts` 에 응답 DTO

**Interfaces:**
- Produces:
  - `SupplierSheetApplyService.preview(supplierId: string, buffer: Buffer, tx?: DbTx): Promise<{ rows: RowVerdict[]; counts: Record<RowVerdict['verdict'], number>; token: string }>`
  - `SupplierSheetApplyService.apply(supplierId: string, buffer: Buffer, previewToken: string, actorId: string, tx?: DbTx): Promise<{ counts; shippedShipmentIds: string[] }>` — 한 트랜잭션(N6): `judgeSupplierSheet(lock: true)` → 토큰이 다르면 409 `SUPPLIER_UPLOAD_PREVIEW_STALE` → 묶음마다 상자별 `splitOffSupplierLines` → 상자가 둘 이상이면 `mergeSupplierShipments` → `shipSupplierShipment` → `corrections` 마다 `correctSupplierWaybill` → `reports` 마다 `reportUnfulfillable`. 모든 쓰기의 `at` 은 같은 시각
- 라우트: `POST /direct-ship/suppliers/:supplierId/uploads/preview`, `POST /direct-ship/suppliers/:supplierId/uploads/apply` — multipart(`readWorkbookUpload`, 선례 `bulk-session.controller.ts:62-85`), apply 는 폼 칸 `previewToken`(없으면 400). 둘 다 `@RequirePermission('fulfillment.order.write')`. 응답에 개인정보 없음 → `@PiiResponse` 없음

- [ ] **Step 1: 통합 spec** — 넘긴 입점사 A 상자 셋(주문 X: 라인 둘, 주문 Y·Z: 라인 하나씩, Y·Z 수령인 같음), 시트: X 라인1 = T1, X 라인2 = 사유, Y·Z = T2
  - `미리보기 → 적용: X 는 나뉘어 T1 상자 shipped + 원래 상자 draft(라인2 못 보냄), Y·Z 는 합친 상자 하나가 T2 로 shipped, Y·Z 원래 상자 superseded`
  - `outbox: ShipmentShipped 2, SalesOrderShipmentDispatched 3(X·Y·Z)`
  - `같은 파일 다시 apply(새 미리보기 토큰) → 쓰기 0, outbox 새 행 0`
  - `미리보기 뒤 X 상자가 바뀌면(다른 트랜잭션에서 못 보냄 기록) apply 는 SUPPLIER_UPLOAD_PREVIEW_STALE, 아무것도 안 남음`
  - `적용 중 하나가 실패하면(TRACKING_IN_USE 를 경합으로 심음) 파일 전체 롤백`
  - 적용 뒤 그 FO 들 정합성 점검 위반 0, 보드: X = 창고 상자 없음 → 원래 상자 `drop_ship_unfulfillable`
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — spec PASS, `npx jest libs/authorization scripts/security apps/core/src/modules/fulfillment` PASS, `npm run type-check` 에러 0
- [ ] **Step 3: Commit** — `git commit -m "K3 PR5 — 직배 시트 올리기: 미리보기 토큰으로 묶인 적용, 파일 하나 = 트랜잭션 하나"`

### Task 11: 새 택배사 추적 링크 (⛔ 사람 확인)

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:1214` `buildTrackingUrl`
- Test: `store-sales-orders.service.spec.ts`

- [ ] **Step 1: 링크 후보를 정리해 사용자에게 보인다** — 8개(`EPOST`·`DAESIN`·`ILYANG`·`HDEXP`·`CVSNET`·`CUPOST`·`CHUNIL`·`KUNYOUNG`) 각각 택배사 공식 조회 페이지의 «번호를 쿼리로 받는» URL. 실물 송장번호로 열어 결과가 뜨는지는 사용자가 본다(스펙 «PR 5 구현자에게», PR 3 E5)
- [ ] **Step 2: 확인된 것만 더한다** — 확인 안 된 택배사는 `null` 그대로(화면은 번호만 보인다). spec: 더한 택배사마다 `buildTrackingUrl(code, '123') ` 가 그 URL, 나머지 `null`
- [ ] **Step 3: Commit** — `git commit -m "K3 PR5 — 확인된 새 택배사 추적 링크"`(더한 것이 없으면 이 Task 는 커밋 없이 PR 본문에 «전부 null» 한 줄)

### Task 12: ADR·감사 문서·게이트·PR

**Files:**
- Modify: `docs/adr/0050-drop-ship-is-a-supplier-shipment.md` — Decision 에 10번 «입점사 상자만 `draft → shipped`(전이표 `owner`), 입점사 발송 시도는 원장 없이 창고와 같은 이벤트를 낸다(발송 뒤 효과 모듈 하나)», 11번 «시트는 서버가 JSON 으로 내고(접속기록은 `@PiiExport`), 행 키는 FOI id, 적용은 미리보기 토큰과 파일 하나 = 트랜잭션 하나, (택배사, 송장) 묶음은 전부 아니면 전무», 12번 «되돌리기는 같은 명령의 입점사 갈래». 7번의 «`EVENT_CONTRACT_CARRIERS` …» 줄 끝에 «PR 5 가 문을 지웠다»
- Modify: `docs/order-logistics-architecture-audit-2026-10.md` §8.1 K3 — 한 줄: 직배 발송이 상자·수기 송장·투영으로 간다(PR 5), FO status 직접 쓰기 예외는 옛 `ship()` 하나(PR 8)
- Modify: 설계 문서 §7 아래에 «PR 6 구현자에게(PR 5 가 정한 것)»·«PR 7 구현자에게» 를 이 계획의 «다음 PR» 에서 한 줄씩

- [ ] **Step 1: 문서 셋을 쓴다**
- [ ] **Step 2: 검증 게이트** — `npm run type-check && npx jest` → 에러 0, 실패 0(환경 실패 4개 제외). 통합 `k3_pr2_it` 기준선 외 실패 0
- [ ] **Step 3: Commit** — `git commit -m "K3 PR5 — ADR-0050 에 입점사 발송·시트·되돌리기"`
- [ ] **Step 4: PR** — 본문에 Task 0 실측값, «마이그 없음·Core 만·휴면·PR 3 라이브 뒤», 롤백 절(🔴 소비자 롤백 금지), N1~N13, Task 11 결과. 머지·배포는 사용자가 정한다

---

## 다음 PR 에 넘기는 것

- **PR 6(취소):** 상자 후 취소가 입점사 상자 라인을 줄일 때 «못 보냄» 기록이 있는 라인은 알릴 취소를 남기지 않는다(스펙 §4.7) — 판별은 이 PR 의 `unfulfillable_*` 칸. 발송된 입점사 상자 라인은 취소 불가, 먼저 되돌린다(이 PR 의 Task 7). 합포장 상자는 여러 판매주문을 담는다 — 한 주문만 취소하면 그 주문 라인만 줄어야 한다.
- **PR 7(admin-web):** 시트 JSON → XLSX(`exportToExcel` 류, 머리글은 응답 `columns` 그대로, `X-Pii-Export-Reason` 헤더 입력), 올리기 화면(미리보기 판정·코드 → 한국어 문구, 적용은 토큰과 같은 파일), 넘김 묶음 화면(묶음별 발송·아직·못 보냄 수 — 지금 읽기가 없다, 필요하면 core 읽기 하나를 같이), 되돌리기 버튼(입점사 상자는 «회수 확인» 문구를 «입점사와 확인»으로). FO 상세 `shipments[]` 에 `supplierId`·`supplierLineQty` 가 없다(PR 4 에서 넘어옴). 상자 상세(`getShipmentDetail`)는 입점사 라인을 예약 0 으로 보인다 — 화면이 «미예약»으로 그리지 않게.
- **PR 7:** 직배 목록 읽기(`SupplierShipmentQueueReader`)는 상자 단위 주문 칸만 낸다 — 합포장 상자는 발송 뒤에만 생기고 목록에 안 나오므로(발송된 상자 제외) 지금은 문제 없다. 되돌린 합포장 상자가 목록에 다시 나올 때 라인별 주문이 필요하다.
- **PR 8(contract):** 옛 `direct-ship.service.ts`·`ship()`·`computeAdminAvailableActions`·`POST /direct-ship/export/file` 류 옛 시트 라우트와 `PII_EXPORT_EXCEPTIONS` 의 `/direct-ship/export/:companyName`.
- **별건:** 정정 이벤트(N9) — Medusa 메타데이터·고객 문자가 옛 번호로 남는다. 운영에서 정정이 잦으면 계약을 넓혀 다시 낸다.
