# K8 PR 9 — 한진 반품 회수(R) 접수·취소 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** core 가 반품 예정 기록(`expected`)마다 한진에 반품 회수(`svcCatCd = 'R'`)를 예약하고 회수 운송장번호를 받아 두며, 반품 취소는 «한진 예약을 먼저 지우고» 진행한다 — 기사가 이미 집하했으면 취소를 거절한다.

**Architecture:** 회수 예약은 새 테이블 `customer_return_pickups`(반품 하나에 시도 여럿, 활성 하나)가 소유한다. 접수 트랜잭션이 `pending` 행을 만들고, `@CronOnce` 워커가 트랜잭션 밖에서 `insert-order` 를 부른 뒤 CAS 로 결과를 적는다. 반품 취소는 Medusa 취소 워크플로가 core 내부 라우트(`release`)를 동기로 불러 한진 `cancel-order` 를 먼저 끝내고, 한진이 «운송장 출력됨»(`ERROR-04`)이면 새 거절 `return_picked_up` 으로 닫는다. CS 는 시트에서 회수 운송장·상태를 보고 실패 때 [회수 다시 접수]를 누른다.

**Tech Stack:** NestJS · Drizzle(postgres.js) · `@app/cron-once` · Medusa 2.13.4 워크플로 · Next.js(admin-web) · storefront i18n JSON.

**Spec:** `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` §4.7(한진 회수)·§4.2(반품 취소)·§4.3·§8 PR 9. 이전 PR 본문(#1146~#1162)의 숙제 중 이 PR 몫: PR 8 N1 «한진 회수가 주문 배송지를 송하인으로 읽는다», PR 7 «소포는 한진 회수(PR 9) 전까지 도착 대기 목록 + 검색».

## 사전 실측 — DEV 스모크 (2026-10-28, 테스트 계약번호 9117159, 가짜 주소)

설계 §4.7 이 «먼저 확인할 것 셋»으로 남긴 질문의 답이다. 스크립트는 Task 1 이 `scripts/smoke/hanjin-return-pickup-smoke.ts` 로 저장소에 남긴다. 예약은 전부 취소해 두었다.

| 질문 | 결과 |
| --- | --- |
| R 에서 허용되는 `payTypCd` | **`CD`(발지신용) → `ERROR-14`**. `PP`·`CC`·`CT` → `OK`. 출고(S)와 반대다 — S 는 `CD` OK·`CT` 거절 |
| 회수 운송장번호를 어떻게 받나 | **`insert-order` 응답에 바로 온다** — `{"resultCode":"OK","wblNo":"560000175571","custOrdNo":…}`. `print-wbl` 이 필요 없다(한진이 출력). 번호대가 `560…` 로 출고(`100…`)와 다르다 |
| `wblNo`(원운송장) | 비워도·키를 빼도·체크디지트가 틀려도·없는 번호여도 전부 `OK`. 한진은 검증하지 않는다 → «있으면 싣는다» |
| 같은 `custOrdNo` 재전송 | **`ERROR-03` «주문번호 중복» + 처음 받은 `wblNo` 를 응답에 싣는다** → 응답을 잃은 예약의 재시도가 번호를 되찾는다 |
| 취소한 `custOrdNo` 로 다시 예약 | `ERROR-03` + 취소된 그 `wblNo` — **한 번 취소한 주문번호는 다시 못 쓴다** |
| `cancel-order` | 예약 → `OK`(+`wblNo`). 두 번째 → **`ERROR-05` «이미 취소된 주문»**(정본 §4.3 표에 없는 코드). 없는 주문·S 주문 → `ERROR-03` «접수된 예약 미존재» |
| `custOrdNo` 31자 이상 | `ERROR-02` (30 Byte) |
| 갓 예약한 회수 운송장 추적 | `ERROR-01`(출고와 같다 — 집하 스캔 전 정상) |
| `comodityList` 없음 | `OK` |
| 재현 못 한 것 | `cancel-order` 의 `ERROR-04`(«운송장출력» 상태 — 기사가 집하하며 출력한 뒤). DEV 에선 기사가 안 온다. 라이브에서 처음 본다 |

## 결정 (이 계획에서 정한 것)

| # | 결정 |
| --- | --- |
| N1 | 지불조건은 새 설정 `HANJIN_RETURN_PAY_TYPE`, 기본 **`CT`(착지신용)** — 받는 쪽(창고 = 우리)이 월 정산으로 낸다. 허용 집합 `PP`·`CC`·`CT`. 🔴 **우리 실계약에서 R + `CT` 가 열려 있는지는 모른다** — 개통 전에 LIVE 키로 스모크(Task 1 스크립트)를 돌리거나 영업담당자에게 묻는다. 거절되면 `ERROR-14` 로 `failed` 가 되고 CS 가 손으로 접수한다(설계 §4.7 «회수 접수 실패는 반품을 막지 않는다») |
| N2 | `custOrdNo` = `'AR'` + 회수 행 id(UUID)의 Crockford base32 26자 = 28자. 출고의 `'AY'` + shipment id 와 이름공간이 갈린다. 행 id 는 앱이 `randomUUID()` 로 만든다(삽입 전에 번호가 필요하다). 다시 접수는 새 행 = 새 번호다(취소한 번호는 못 쓰므로) |
| N3 | 회수지(송하인) = 반품 줄을 실은 **배송완료 상자 중 가장 늦게 배송완료된 것**의 `shipments.recipient_snapshot`(= 그 상자 운송장에 쓴 주소, PR 8 N1 «주문 배송지»). 원운송장 = 그 상자의 `used` 운송장 `tracking_no`(없으면 비운다). 받는 곳(수하인) = `HANJIN_SENDER_*`(부천 출고지) — 창고 테이블에 주소가 없다. 출고 창고가 하나뿐인 지금은 같다(알려진 잔여) |
| N4 | 회수 예약 HTTP 는 트랜잭션 밖이다. 워커와 동기 취소가 같은 행을 다루므로 **리스**(`lease_until`, 2분) CAS 로 한 번에 하나만 잡는다 |
| N5 | 일시 실패(전송 오류·타임아웃·`-103`)는 같은 행·같은 `custOrdNo` 로 다시 보낸다(`ERROR-03` + `wblNo` 가 성공을 되찾는다). 백오프 `min(2^(attempts−1), 60)` 분, 12번이면 `failed`(`last_error` 앞머리 `attempts_exhausted:`). 정해진 거절(`ERROR-xx`, `ERROR-03` 인데 `wblNo` 없음)은 즉시 `failed` |
| N6 | 반품 취소는 Medusa 가 core 에 «회수 놓아주기»를 **동기로** 묻는다(사용자 결정 10-28). core 가 한진 취소를 끝낸 뒤에만 Medusa 가 반품을 취소한다. `ERROR-04` → `return_picked_up` 거절, 반품 그대로. 그 반대 실패(회수만 취소되고 Medusa 취소가 실패)는 «회수 미접수» 확인 필요로 CS 가 다시 접수한다 — 소포가 기록 없이 오는 쪽보다 낫다 |
| N7 | 관측된 `ChannelReturnCancelled` 도 활성 회수를 정리한다(동기 취소가 못 본 경우 — 관측 지연 중 생긴 행). 아직 안 보낸 `pending`(attempts 0) → `void`, 보낸 적 있으면 → `cancel_pending`(워커가 취소) |
| N8 | 회수 추적(집하됨·이동 중 표시)은 이 PR 에 없다. 집하는 `release` 가 `ERROR-04` 를 볼 때만 `picked_up_at` 으로 안다 |
| N9 | CS 문은 [회수 다시 접수] 하나(`order.claim.write`). 반품이 `expected` 이고 활성 회수가 없을 때만. 마지막 행이 `attempts_exhausted:` 로 `failed` 면 **같은 행**을 `pending` 으로 되살리고(같은 번호 — 한진에 이미 있으면 `ERROR-03` 이 되찾는다), 그 밖(정해진 거절·취소됨)은 새 행 |
| N10 | 창고 스테이션은 앱 변경 없이 회수 운송장 스캔으로 반품을 연다 — 창고 목록의 `barcode`·`q` 가 활성·끝난 회수 행의 `waybill_no` 도 정확 일치로 찾는다. CS 목록 `q` 도 같다 |

## Global Constraints

- 트랜잭션: `this.dbService.run(fn, tx)`, 공개 메서드 `tx?: DbTx` 마지막, private 헬퍼 `tx: DbTx` 필수. `db.query.*`·`with`·`any`·`as` 금지(Inventory Query Rules). 한진 HTTP 는 절대 `run` 안에서 부르지 않는다.
- 마이그: `npm run db:generate:core -- --name add-customer-return-pickups`. 추가만(expand) → 배포 `migrate → deploy`. `schema.ts` 와 `drizzle/` 을 한 커밋에.
- 크론: `@CronOnce(expr, { name })`, 이름 앱 내 유일(`libs/cron-once/src/guards/cron-once-guard.spec.ts`).
- 새 HTTP 라우트는 권한 데코레이터 필수(`route-classification.spec.ts`). 내부 라우트는 클래스 단위 `@InternalOnly()` 인 `SalesOrdersInternalController` 에 더한다. CS 라우트는 `:id/missing-closure` 와 같은 데코레이터 묶음 + `@RequirePermission('order.claim.write')`.
- 컨트롤러를 고친 뒤 `npx jest scripts/security` — IDOR 검토 목록은 줄 좌표라 줄만 밀려도 빨갛다(좌표를 고친다).
- 개인정보: 회수지 주소·이름·전화는 한진 본문에만 싣는다. 회수 행·로그·`last_error` 에 남기지 않는다(한진 `resultMessage` 는 주소를 되풀이하지 않는다 — 그대로 적어도 된다).
- 통합 스펙은 `describeIfDb` 가드, scratch DB 로 `--runInBand`. 스펙 안 `dotenv.config()` 금지.
- Medusa 타입: `npx tsc --noEmit -p apps/medusa/tsconfig.json` — 기존 3건(`src/admin/lib/sdk.ts`×2, `confirm-purchase.unit.spec.ts`)만 남아야 한다.
- 기준선 실패: 루트 `npx jest` 의 admin-web 근태 4건(ICU), 스토어프론트 vitest `locale-parity.test.ts` 2건, 스토어프론트 tsc 45건.
- 거절 코드 표의 정본은 Medusa `ReturnRejectReason` — 스토어프론트 두 표와 admin-web 표가 따라간다(`scripts/storefront/medusa-return-parity.spec.ts`).

## Review Focus

1. **예약 응답을 잃었다**(타임아웃 뒤 한진엔 예약이 있다) → 다음 워커 실행이 같은 `custOrdNo` 로 보내 `ERROR-03` + `wblNo` 를 받고 `reserved` 로 적어야 한다. `failed` 나 두 번째 예약이 되면 기사가 두 번 온다. → Task 1(게이트웨이 `already_reserved`), Task 4(워커가 그 번호를 적는다).
2. **워커가 보내는 중에 고객이 취소한다** → `release` 는 리스를 못 잡아 409 → Medusa 502, 반품 그대로. 리스를 무시하고 «미전송»으로 `void` 하면 직후 예약이 살아남는다. → Task 5.
3. **접수 직후(첫 전송 전) 취소** → 한진을 부르지 않고 `void`. 관측 지연으로 core 에 기록이 아직 없으면 `released`(예약도 아직 없다). → Task 2, Task 5.
4. **반품 줄이 두 상자에 걸쳐 배송완료됐다 / 상자 스냅샷이 비었다** → 가장 늦게 배송완료된 상자를 고르고, 스냅샷이 없으면 `failed: no_pickup_address`(워커가 매분 다시 부딪히지 않는다). → Task 3, Task 4.
5. **[회수 다시 접수]를 두 번 누른다 / 활성 회수가 있는데 누른다** → 활성 행은 반품당 하나(부분 unique 인덱스) — 두 번째는 409, 행 하나. → Task 2(인덱스), Task 7.

---

### Task 1: 한진 회수 예약·취소 — 게이트웨이와 설정, 스모크 스크립트

**Files:**
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/carrier-gateway.interface.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin.config.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/cust-ord-no.ts`, `waybill.constants.ts`
- Create: `scripts/smoke/hanjin-return-pickup-smoke.ts`
- Test: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway.spec.ts`, `hanjin.config.spec.ts`, `apps/core/src/modules/fulfillment/waybill/cust-ord-no.spec.ts`

**Interfaces:**
- Produces (interface 파일, carrier 중립):
  ```ts
  export interface PickupRequest {
    custOrdNo: string;                 // ≤30B
    originalWaybillNo?: string;
    sender: { name: string; zip: string; baseAddress: string; detailAddress: string; mobile: string }; // 고객
    recipient: { name: string; zip: string; baseAddress: string; detailAddress: string; tel: string }; // 창고
    items: Array<{ name: string; quantity: number }>;
    commodityName: string;
    boxType: string;
    payType: string;
  }
  export type PickupReserveOutcome =
    | { kind: 'reserved'; waybillNo: string }
    | { kind: 'already_reserved'; waybillNo: string }   // ERROR-03 + wblNo
    | { kind: 'rejected'; code: string; reason: string };
  export type PickupCancelOutcome =
    | { kind: 'cancelled' } | { kind: 'already_cancelled' }   // OK / ERROR-05
    | { kind: 'not_found' }                                   // ERROR-03
    | { kind: 'picked_up'; reason: string }                   // ERROR-04
    | { kind: 'rejected'; code: string; reason: string };
  // CarrierGateway 에 선택 메서드 셋
  isPickupConfigured?(): boolean;
  reservePickup?(req: PickupRequest): Promise<PickupReserveOutcome>;
  cancelPickup?(custOrdNo: string): Promise<PickupCancelOutcome>;
  ```
  전송 오류·타임아웃·`-103` 은 결과 타입이 아니라 지금처럼 `CarrierError`(`unknown_outcome`·`transient_rejection`)로 던진다(클라이언트가 이미 그렇게 한다).
- Produces: `HanjinConfig.returnPayType: string`, `missingHanjinPickupConfig(c): string[]`(= `missingHanjinConfig(c)` + `HANJIN_RETURN_PAY_TYPE` 이 `PP`·`CC`·`CT` 밖이면 그 이름), `deriveCustOrdNo(id: string, prefix?: string)`, `WAYBILL.RETURN_CUST_ORD_NO_PREFIX = 'AR'`.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `hanjin-carrier.gateway.spec.ts` 에 `describe('reservePickup / cancelPickup (K8 PR9)')`, 가짜 `client.post` 로:
  - `reservePickup` 이 `'order'`, `/parcel-delivery/v1/order/insert-order` 로 보내는 본문이 `svcCatCd: 'R'`, `payTypCd: config.returnPayType`, `wblNo: originalWaybillNo ?? ''`, `sndr*` = 고객(`sndrTelNo`·`sndrMobileNo` 둘 다 고객 휴대폰), `rcvr*` = 창고(`rcvrTelNo` = 창고 전화), `pickupAskDt` = KST `YYYYMMDD`, `comodityList[].comodityCnt` 문자열.
  - 응답 `{resultCode:'OK', wblNo:'560000175571'}` → `{kind:'reserved', waybillNo:'560000175571'}`.
  - `{resultCode:'ERROR-03', wblNo:'560000175571'}` → `already_reserved`. `{resultCode:'ERROR-03'}`(번호 없음) → `rejected` code `ERROR-03`.
  - `{resultCode:'ERROR-14', resultMessage:'배송구분별 지불조건(payTypCd) 검증 오류'}` → `rejected` code `ERROR-14`.
  - `OK` 인데 `wblNo` 없음 → `rejected` code `no_wbl_num`.
  - `cancelPickup('AR…')` 본문 `{custEdiCd, custOrdNo}`, 경로 `/parcel-delivery/v1/order/cancel-order`. `OK`→`cancelled`, `ERROR-05`→`already_cancelled`, `ERROR-03`→`not_found`, `ERROR-04`→`picked_up`(reason = 원문), `ERROR-99`→`rejected`.
  - `client.post` 가 `CarrierError('unknown_outcome')` 를 던지면 그대로 던진다.
  - `hanjin.config.spec.ts`: 기본 `returnPayType === 'CT'`, `HANJIN_RETURN_PAY_TYPE=CD` 면 `missingHanjinPickupConfig` 에 `'HANJIN_RETURN_PAY_TYPE'`, `missingHanjinConfig` 는 영향 없음.
  - `cust-ord-no.spec.ts`: `deriveCustOrdNo(uuid, 'AR')` 가 `'AR'` 로 시작하는 28자, 기존 기본 접두사 결과는 그대로.
- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/fulfillment/waybill` → 새 케이스 FAIL(메서드 없음).
- [ ] **Step 3: 구현** — 위 Interfaces 대로. `capabilities` 타입은 바꾸지 않는다(선택 메서드의 유무가 능력이다). `isPickupConfigured()` = `missingHanjinPickupConfig(this.config).length === 0`. 데모 게이트웨이는 손대지 않는다.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npm run type-check` 0.
- [ ] **Step 5: 스모크 스크립트** — `scripts/smoke/hanjin-return-pickup-smoke.ts`. 기존 `hanjin-staging-smoke.ts` 처럼 env 를 바깥에서 받고(`npx dotenv -e apps/core/.env -- npx tsx scripts/smoke/hanjin-return-pickup-smoke.ts`), 미설정이면 SKIP + exit 2. 게이트웨이로 가짜 주소 회수 예약 → 같은 번호 재예약(`already_reserved` 확인) → 취소 → 재취소(`already_cancelled`)를 찍는다. 출력에 `returnPayType` 을 적어 LIVE 계약 확인에 쓸 수 있게 한다. 실제로 한 번 돌려 결과를 커밋 메시지에 적는다.
- [ ] **Step 6: 커밋** — `git commit -m "한진 반품 회수 예약·취소를 게이트웨이에 더한다 (K8 PR9)"`

### Task 2: 회수 행 — 테이블·마이그, 접수가 만들고 취소 관측이 정리한다

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts`(`customerReturns` 아래)
- Create: `apps/core/drizzle/<timestamp>_add-customer-return-pickups.sql`(+ `meta/`)
- Create: `apps/core/src/modules/sales-order/customer-return/customer-return-pickup.types.ts`
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return.manager.ts`
- Test: `apps/core/src/modules/sales-order/customer-return/customer-return.manager.integration.spec.ts`

**Interfaces:**
- Produces: enum `customer_return_pickup_status` = `pending · reserved · failed · void · cancel_pending · cancelled`. 테이블 `customer_return_pickups`:
  `id uuid pk`(기본값 없음 — 앱이 준다), `customer_return_id uuid not null → customer_returns.id on delete cascade`, `carrier carrierEnum not null`, `cust_ord_no varchar(30) not null unique`, `status not null default 'pending'`, `waybill_no varchar(32)`, `original_waybill_no varchar(32)`, `attempts int not null default 0`, `last_error text`, `next_attempt_at timestamptz`, `lease_until timestamptz`, `reserved_at`·`picked_up_at`·`cancelled_at timestamptz`, `created_by varchar(255)`(null = 시스템), `created_at`·`updated_at`.
  인덱스: `uq_customer_return_pickups_active` unique on `(customer_return_id)` where `status in ('pending','reserved','cancel_pending')`; `uq_customer_return_pickups_waybill` unique on `waybill_no` where `waybill_no is not null`; `idx_customer_return_pickups_due` on `(status, next_attempt_at)`.
- Produces: `customer-return-pickup.types.ts` — `CustomerReturnPickupStatus`, `ACTIVE_PICKUP_STATUSES`, `newPickupRow(customerReturnId: string, createdBy: string | null): { id: string; custOrdNo: string; … }`(`randomUUID()` + `deriveCustOrdNo(id, WAYBILL.RETURN_CUST_ORD_NO_PREFIX)`, carrier `'HANJIN'`).
- Consumes: Task 1 `deriveCustOrdNo`, `WAYBILL.RETURN_CUST_ORD_NO_PREFIX`.

- [ ] **Step 1: 실패하는 테스트** — `customer-return.manager.integration.spec.ts` 에 `describe('회수 행 (K8 PR9)')`:
  - `recordRequested` → 그 반품의 회수 행 1개, `status 'pending'`, `attempts 0`, `cust_ord_no` 가 `'AR'` 28자, `created_by null`.
  - 같은 사실 두 번 → 회수 행 여전히 1개(이미 있음 분기는 행을 만들지 않는다).
  - `recordCancelled`(attempts 0) → 회수 행 `void`, `cancelled_at` 없음.
  - 회수 행을 `reserved` 로 만들어 둔 뒤 `recordCancelled` → `cancel_pending`. `attempts 2` 인 `pending` 도 `cancel_pending`.
  - 활성 행이 없으면(`failed`) `recordCancelled` 는 회수 행을 건드리지 않는다.
  - 같은 반품에 활성 행 둘을 직접 넣으면 unique 위반(인덱스가 지킨다).
- [ ] **Step 2: 실패 확인** — scratch DB 로 `DATABASE_URL=… npx jest customer-return.manager.integration --runInBand` FAIL.
- [ ] **Step 3: 스키마·마이그** — 스키마를 더하고 `npm run db:generate:core -- --name add-customer-return-pickups`. 생성 SQL 이 `CREATE TYPE` + `CREATE TABLE` + 인덱스뿐인지 본다(다른 객체 변경 0).
- [ ] **Step 4: 매니저** — `recordRequested` 가 줄·항목을 넣은 같은 트랜잭션에서 `newPickupRow(inserted.id, null)` 를 넣는다. `recordCancelled` 가 전이 성공 뒤 같은 트랜잭션에서 활성 행을 CAS 로: `pending ∧ attempts = 0 ∧ (lease_until is null ∨ < now)` → `void`, 그 밖의 활성 → `cancel_pending`(`next_attempt_at = null`).
- [ ] **Step 5: 통과 확인** — 같은 명령 PASS. `npm run type-check` 0.
- [ ] **Step 6: 커밋** — 스키마·SQL·meta·코드 한 커밋. `"반품 회수 행을 두고 접수가 만들고 취소가 정리한다 (K8 PR9)"`

### Task 3: 회수 본문 — 회수지·원운송장·품목을 읽는다

**Files:**
- Create: `apps/core/src/modules/sales-order/customer-return/customer-return-pickup-source.reader.ts`
- Create: `apps/core/src/modules/sales-order/customer-return/customer-return-pickup-request.ts`(순수)
- Test: `customer-return-pickup-source.reader.integration.spec.ts`, `customer-return-pickup-request.spec.ts`(같은 폴더)

**Interfaces:**
- Produces:
  ```ts
  export type PickupSource =
    | { kind: 'ok'; snapshot: unknown; originalWaybillNo: string | null; items: Array<{ name: string; quantity: number }> }
    | { kind: 'no_delivered_shipment' };
  export async function readPickupSource(trx: DbTx, customerReturnId: string): Promise<PickupSource>;
  export function assemblePickupRequest(source: Extract<PickupSource, { kind: 'ok' }>, config: HanjinConfig, custOrdNo: string): PickupRequest; // parseRecipient 가 던지면 그대로(BadRequestError)
  ```
- Consumes: `deliveredParcelsSql`(`line-quantities.sql.ts`), `parseRecipient`·`commodityNameOf`(`waybill-request.assembler.ts`), Task 1 `PickupRequest`.

- [ ] **Step 1: 실패하는 테스트**
  - 순수(`customer-return-pickup-request.spec.ts`): 스냅샷 `{recipientName:'홍길동', phone:'010-1234-5678', postalCode:'03154', roadAddress:'서울 종로구 세종대로 209', detailAddress:'101호'}` + config → `sender.mobile '010-1234-5678'`, `recipient` = `config.sender`(이름·우편번호·주소·`tel`), `payType = config.returnPayType`, `boxType = config.boxType`, 품목 둘이면 `commodityName '<첫 품목> 외 1건'`. 스냅샷에 `postalCode` 없음 → `BadRequestError`(`RECIPIENT_INCOMPLETE`).
  - 리더(통합): 반품 줄 하나가 상자 S1(배송완료 10-20)·S2(10-22)에 나뉘어 배송완료 → S2 의 스냅샷·S2 의 `used` 운송장 번호. 운송장 행이 `voided` 뿐이면 `originalWaybillNo null`. 배송완료 상자가 없으면 `no_delivered_shipment`. 품목 = 반품 줄마다 `sales_order_lines.product_name` × 줄 수량.
  - 데이터 깔기는 `customer-return-receiving.manager.integration.spec.ts` 의 배송완료 픽스처를 그대로 쓴다.
- [ ] **Step 2: 실패 확인** — 두 스펙 FAIL.
- [ ] **Step 3: 구현** — 리더: `deliveredParcelsSql(select sales_order_id from customer_returns where id = …)` 을 FOI(`fulfillment_order_items.sales_order_line_id` 는 varchar → `customer_return_lines.sales_order_line_id::text` 로 잇는다)로 그 반품 줄에 걸린 것만 거르고, `delivered_at desc, shipment_id desc` 첫 상자. 운송장은 그 상자의 `status = 'used'` 중 `issued_at desc` 첫 행의 `tracking_no`.
- [ ] **Step 4: 통과 확인** — 두 스펙 PASS.
- [ ] **Step 5: 커밋** — `"반품 회수 본문을 배송완료 상자에서 읽는다 (K8 PR9)"`

### Task 4: 회수 워커 — 예약·취소를 보내고 결과를 적는다

**Files:**
- Create: `apps/core/src/modules/sales-order/customer-return/customer-return-pickup.manager.ts`
- Create: `apps/core/src/modules/sales-order/customer-return/customer-return-pickup.cron.ts`
- Modify: `apps/core/src/modules/sales-order/sales-order.module.ts`(`WaybillModule` import, 두 provider)
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.module.ts`(exports 에 `HANJIN_CONFIG`) — WaybillModule 은 `FulfillmentCommandModule` 만 import 해 순환이 없다
- Test: `customer-return-pickup.manager.integration.spec.ts`, `customer-return-pickup.cron.spec.ts`

**Interfaces:**
- Consumes: Task 1 게이트웨이(`CarrierGatewayRegistry.get('HANJIN')`, `HANJIN_CONFIG` 토큰(`waybill.tokens.ts`) — 지금 WaybillModule 이 export 하지 않으므로 export 목록에 더한다), Task 2 테이블, Task 3 `readPickupSource`·`assemblePickupRequest`.
- Produces:
  ```ts
  class CustomerReturnPickupManager {
    /** 기한 된 pending·cancel_pending 을 최대 limit 개 처리. 게이트웨이가 미설정이면 아무것도 읽지 않고 0 */
    dispatchDue(now: Date, limit?: number): Promise<{ sent: number; cancelled: number }>;
    /** 한 행을 리스로 잡는다. 못 잡으면 null */
    claim(trx: DbTx, pickupId: string, now: Date): Promise<PickupRow | null>;
  }
  export const PICKUP_ATTEMPTS_CAP = 12;
  export const PICKUP_LEASE_MS = 120_000;
  export function nextPickupAttemptAt(now: Date, attempts: number): Date; // min(2^(attempts−1), 60)분 뒤
  ```
  크론: `@CronOnce('* * * * *', { name: 'customer-return-pickup' })` → `dispatchDue(new Date())`.

- [ ] **Step 1: 실패하는 테스트** — 가짜 게이트웨이(호출 기록 + 정해 둔 결과)를 `CarrierGatewayRegistry([fake])` 로 주입:
  - `pending` → 예약 `reserved` → 행 `reserved`, `waybill_no '560000175571'`, `reserved_at`, `original_waybill_no` = Task 3 값, 리스 풀림.
  - `already_reserved` → 같은 결과(번호 적음).
  - `unknown_outcome` 던짐 → `pending`, `attempts 1`, `next_attempt_at = now + 1분`, `last_error` 에 code. 같은 `now` 로 다시 → 호출 0(기한 전). 12번째 실패 → `failed`, `last_error` 가 `attempts_exhausted:` 로 시작.
  - `rejected ERROR-14` → 즉시 `failed`, `last_error 'ERROR-14: …'`.
  - `no_delivered_shipment` → 호출 없이 `failed: no_pickup_address`. 스냅샷 불완전(`BadRequestError`)도 `failed: no_pickup_address`.
  - `cancel_pending` → `cancelled`·`already_cancelled`·`not_found` 셋 다 `cancelled` + `cancelled_at`. `picked_up` → `reserved` 로 돌아가고 `picked_up_at`(취소된 반품의 소포가 온다 — error 로그). `unknown_outcome` → `cancel_pending` 유지 + 백오프, 12번 넘으면 error 로그만(상태 유지).
  - 다른 리스가 살아 있는 행은 건너뛴다. 게이트웨이 `isPickupConfigured()` false → 0, DB 읽기 없음.
  - 회수지 주소가 `last_error`·로그에 안 나온다(가짜 스냅샷의 주소 문자열이 `last_error` 에 없음).
  - 크론 스펙: `dispatchDue` 를 한 번 부른다.
- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현** — 각 행: ① `run` 안에서 `claim`(CAS `lease_until = now + 2분` where `lease_until is null or < now` and 상태 그대로) ② `run` 밖에서 읽기·한진 호출 ③ `run` 안에서 `status`·`lease_until` 이 잡은 값 그대로일 때만 결과를 적는 CAS(리스 해제 포함). 행끼리는 순서대로(페이서는 게이트웨이 몫이 아니다 — 주문 API 는 제한이 없다).
- [ ] **Step 4: 통과 확인** — PASS. `npx jest libs/cron-once` PASS(이름·모듈 가드).
- [ ] **Step 5: 커밋** — `"반품 회수 워커가 한진 예약·취소를 보낸다 (K8 PR9)"`

### Task 5: 회수 놓아주기 — core 내부 라우트

**Files:**
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return-pickup.manager.ts`(`release`)
- Modify: `apps/core/src/modules/sales-order/internal/sales-orders-internal.controller.ts`
- Create: `apps/core/src/modules/sales-order/internal/dto/release-customer-return-pickup.dto.ts`
- Test: `customer-return-pickup.manager.integration.spec.ts`(release 절), 내부 컨트롤러 스펙이 있으면 거기

**Interfaces:**
- Produces: `POST /internal/sales-orders/customer-return-pickup/release` 본문 `{ channelReturnId: string }` → 200 `{ result: 'released' | 'picked_up' }` · 409(`ConflictError('pickup_busy: …')`) · 502(`UpstreamUnavailableError('pickup_cancel_unavailable: …')`). 둘 다 `@app/shared` 의 기존 예외라 전역 필터가 상태코드를 정한다(본문 코드 칸은 없다 — Medusa 는 200·404 밖이면 전부 «판정 불가»로 읽으므로 가를 필요가 없다). 매니저 `release(channelReturnId: string, now: Date): Promise<{ result: 'released' | 'picked_up' }>`.

| core 상태 | 하는 일 | 응답 |
| --- | --- | --- |
| 기록 없음(관측 지연) | — | `released` |
| 반품이 `expected`·`cancelled` 밖(도착 뒤) | — | `picked_up` |
| 활성 회수 없음 | — | `released` |
| 리스가 살아 있음 | — | 409 |
| `pending ∧ attempts 0` | CAS → `void` | `released` |
| 그 밖의 활성 | 리스 잡고 `cancelPickup` | `cancelled`·`already_cancelled`·`not_found` → 행 `cancelled`, `released` / `picked_up` → `picked_up_at`, `reserved` 유지, `picked_up` / 그 밖·던짐 → 리스 풀고 502 |
| 게이트웨이 미설정인데 보낸 적 있는 활성 | — | 502 |

- [ ] **Step 1: 실패하는 테스트** — 위 표의 행마다 하나. 추가로: 워커가 리스를 잡은 상태에서 `release` → 409, 행 그대로(Review Focus 2). `picked_up` 뒤 같은 `release` 를 다시 → 한진 다시 묻고 같은 답.
- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현** — 컨트롤러는 위임만(try/catch 없음). DTO `@IsString() @IsNotEmpty()`.
- [ ] **Step 4: 통과 확인** — PASS. `npx jest apps/core/src/modules/sales-order/internal scripts/security libs/authorization` PASS.
- [ ] **Step 5: 커밋** — `"반품 취소 전에 한진 회수를 먼저 놓아주는 내부 라우트 (K8 PR9)"`

### Task 6: Medusa 반품 취소가 회수를 먼저 놓아준다 + 거절 `return_picked_up`

**Files:**
- Create: `apps/medusa/src/workflows/orders/returns/core-return-pickup.ts`
- Modify: `apps/medusa/src/workflows/orders/returns/cancel-order-return.ts`, `plan-return-request.ts`(`ReturnRejectReason`)
- Modify: `apps/medusa/src/api/{admin,store}/orders/[id]/returns/[return_id]/cancel/route.ts`(주석의 거절 목록)
- Modify: `apps/medusa/integration-tests/http/fixtures/return-fixture.ts`(`FakeCore`)
- Modify: `web/almondyoung-storefront/src/domains/order/return-request/return-reasons.ts`, `src/domains/order/details/order-returns-view.ts`, `src/i18n/messages/{ko,en,ja}/mypage.json`
- Modify: `apps/admin-web/src/lib/types/dto/customer-returns.ts`, `apps/admin-web/src/features/cs/return-exchange/return-request-form.ts`
- Test: `apps/medusa/src/workflows/orders/returns/__tests__/core-return-pickup.unit.spec.ts`, `apps/medusa/integration-tests/http/return-cancel.spec.ts`, `web/almondyoung-storefront/src/domains/order/details/order-returns-view.test.ts`, `apps/admin-web/src/features/cs/return-exchange/return-request-form.spec.ts`

**Interfaces:**
- Consumes: Task 5 라우트.
- Produces: `releaseCoreReturnPickup(returnId: string): Promise<'released' | 'picked_up'>` — 200 `released`/`picked_up` 그대로, **404 는 `'released'`**(옛 core — 회수 행이 없다, warn 로그), 그 밖(설정 누락·네트워크·409·502·모양 불일치)은 `CoreEligibilityUnavailable`(같은 클래스 → 라우트가 이미 502 `core_unavailable` 로 닫는다). 타임아웃 20초(core 가 한진 15초를 기다린다). `ReturnRejectReason` 에 `'return_picked_up'`.
- 문구: Medusa `'택배 기사님이 이미 회수한 반품은 취소할 수 없습니다'`. 스토어프론트 ko — 신청 거절 `reject.returnPickedUp`: «택배 기사님이 이미 가져간 반품이라 취소할 수 없어요», 주문 상세 `cancelReject.returnPickedUp`: «이미 택배 기사님이 가져가서 취소할 수 없어요. 도착하면 검수 뒤 환불돼요». en·ja 는 같은 뜻으로. admin-web: «한진 기사가 이미 회수한 반품이라 취소할 수 없습니다».

- [ ] **Step 1: 실패하는 테스트**
  - 유닛: `fetch` 를 갈아 200 `{result:'released'}`·`{result:'picked_up'}`·404·409·502·`{result:'x'}`·네트워크 오류 → 각각 `released`·`picked_up`·`released`·throw×4. `Authorization: Bearer <CORE_INTERNAL_KEY>`, 본문 `{channelReturnId}`.
  - 통합(`return-cancel.spec.ts`): `FakeCore.setPickupRelease(returnId, 'picked_up')` → 고객 취소 400 `return_picked_up`, 반품 `requested` 그대로, 출고 수량 그대로. `'released'` → 지금처럼 취소. `failPickupReleaseWith(409)` → 502 `core_unavailable`, 반품 그대로. 정하지 않으면 FakeCore 는 404 → 취소된다(기존 스펙 전부 그대로 초록). 놓아주기는 core 도착 검사(`return_arrived`) **뒤**, `cancelFulfillmentWorkflow` **앞**에서 한 번 — FakeCore 호출 기록으로 확인. open·canceled 분기는 부르지 않는다.
  - 스토어프론트: `order-returns-view.test.ts` 에 `return_picked_up` → `cancelReject.returnPickedUp`. admin-web: `return-request-form.spec.ts` 의 거절 문구 표에 한 줄.
- [ ] **Step 2: 실패 확인** — `(cd apps/medusa && npm run test:unit -- core-return-pickup)` FAIL, `scripts/local/run-medusa-integration.sh --testPathPattern 'http/return-cancel\.spec'` FAIL, `npx jest scripts/storefront` FAIL(새 거절 코드의 문구 키 없음).
- [ ] **Step 3: 구현** — `cancel-order-return.ts` 의 `return_arrived` 검사 바로 뒤에 `if ((await releaseCoreReturnPickup(ret.id)) === 'picked_up') throw new ReturnRequestRejected('return_picked_up', …)`. FakeCore 는 `POST /internal/sales-orders/customer-return-pickup/release` 를 기록·응답한다.
- [ ] **Step 4: 통과 확인** — Medusa unit 전부, 통합 `http/(return-|partial-cancel|channel-cancel)` 전부, `npx jest scripts/storefront`, `(cd web/almondyoung-storefront && npx vitest run src/domains/order)`, `npx tsc --noEmit -p apps/medusa/tsconfig.json`(기존 3건), `cd apps/admin-web && npx tsc --noEmit` 0.
- [ ] **Step 5: 커밋** — `"반품 취소가 한진 회수를 먼저 놓아주고, 기사가 가져갔으면 거절한다 (K8 PR9)"`

### Task 7: CS 읽기와 [회수 다시 접수] — core

**Files:**
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return.reader.ts`, `customer-return-attention.ts`
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return-pickup.manager.ts`(`retry`)
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return.service.ts`, `customer-returns.controller.ts`
- Test: `customer-return.reader.integration.spec.ts`, `customer-return-attention.spec.ts`, `customer-return-pickup.manager.integration.spec.ts`(retry 절)

**Interfaces:**
- Produces: `CustomerReturnView.pickup: CustomerReturnPickupView | null` = 그 반품의 마지막 회수 행(`created_at desc, id desc`):
  `{ status, waybillNo, originalWaybillNo, lastError, attempts, reservedAt, pickedUpAt, cancelledAt, createdAt }`(시각은 ISO 문자열).
  `CustomerReturnListItem.pickupWaybillNo: string | null`. `CustomerReturnAttention` 에 `'pickup_failed'` — 입력 `pickupStatus: CustomerReturnPickupStatus | null` 를 더하고, `status === 'expected'` 이고 `pickupStatus ∈ {'failed','cancelled'}` 일 때(순서는 `held` 앞, 맨 처음).
  검색: CS 목록 `q` 와 창고 목록 `q`·`barcode` 가 회수 행 `waybill_no` 정확 일치도 찾는다(창고 목록은 기존 상태 술어 그대로 — 끝난 반품은 여전히 안 보인다).
  `POST /admin/customer-returns/:id/pickup/retry`(본문 없음, `order.claim.write`) → `CustomerReturnView`. 매니저 `retry(customerReturnId: string, actorId: string, tx?: DbTx)`:
  반품 `expected` 아니면 `ConflictError`, 활성 행 있으면 `ConflictError`, 마지막 행 `failed` + `last_error` 가 `attempts_exhausted:` 로 시작 → 같은 행 `pending`·`attempts 0`·`last_error null`·`next_attempt_at null`, 그 밖(행 없음 포함) → `newPickupRow(id, actorId)`.

- [ ] **Step 1: 실패하는 테스트** — 리더: 회수 행 둘(`cancelled` 뒤 `reserved`)이면 상세 `pickup.status 'reserved'`·번호, 목록 `pickupWaybillNo`. `q = '560000175571'` 로 CS 목록·창고 목록 둘 다 그 반품 하나, 창고 `barcode` 도 같다. 주의: 상관 서브쿼리 금지 규칙(`itemsOf` 주석) — 마지막 행은 반품 id 묶음으로 따로 읽는다. 확인 필요: `expected` + `failed` → `['pickup_failed']`, `arrived` + `failed` → 없음. retry: 위 Interfaces 의 분기 셋 + 활성 있으면 409 + 같은 반품에 두 번 연달아 → 두 번째 409, 활성 행 하나(Review Focus 5).
- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현** — 서비스 2~3줄 위임, 컨트롤러는 `:id/missing-closure` 와 같은 꼴. 응답에 개인정보 없음(상세 뷰와 같다 — `@PiiResponse` 불필요).
- [ ] **Step 4: 통과 확인** — PASS. `npx jest scripts/security libs/authorization` PASS(IDOR 좌표·라우트 분류).
- [ ] **Step 5: 커밋** — `"CS 가 반품 회수를 보고 실패하면 다시 접수한다 — core (K8 PR9)"`

### Task 8: admin-web — 시트의 회수 칸과 [회수 다시 접수]

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/customer-returns.ts`(손 미러)
- Modify: `apps/admin-web/src/lib/api/domains/customer-returns/*`(클라이언트 한 함수), `apps/admin-web/src/lib/services/customer-returns/mutations.ts`
- Modify: `apps/admin-web/src/features/cs/return-exchange/customer-return-labels.ts`, `customer-return-actions.ts`
- Modify: `apps/admin-web/src/features/cs/return-exchange/components/customer-return-sheet.tsx`(+ 버튼을 그리는 곳)
- Test: `customer-return-labels.spec.ts`, `customer-return-actions.spec.ts`

**Interfaces:**
- Consumes: Task 7 응답 모양·라우트.
- Produces: `useRetryCustomerReturnPickup`, `.permission = ['order.claim.write'] as const satisfies PermissionRequirement`. 액션 `kind: 'retryPickup'` — `status === 'expected'` 이고 `pickup` 이 `null` 이거나 `failed`·`cancelled` 일 때. 라벨: 회수 상태 `pending` «접수 중»·`reserved` «접수됨»·`failed` «접수 실패»·`void` «접수 안 함»·`cancel_pending` «취소 중»·`cancelled` «취소됨», `pickedUpAt` 있으면 «기사 회수» 표시. 확인 필요 `pickup_failed` «회수 미접수».

- [ ] **Step 1: 실패하는 테스트** — 액션 표: `expected`+`failed` → `retryPickup` 있음, `expected`+`reserved` → 없음, `arrived`+`failed` → 없음, `expected`+`null` → 있음. 라벨 표: 상태 여섯·확인 필요 하나가 빈 문자열이 아니다.
- [ ] **Step 2: 실패 확인** — `npm run test:admin-web -- customer-return` FAIL.
- [ ] **Step 3: 구현** — 시트에 «회수» 한 덩어리: 회수 운송장번호(없으면 «—»), 상태, `failed` 면 `lastError` 한 줄. 정상 상태엔 작은 글씨를 더하지 않는다(사용자 선호 «필요한 것만»). 버튼은 기존 액션 버튼과 같은 자리·`run={useRetryCustomerReturnPickup}`.
- [ ] **Step 4: 통과 확인** — `npm run test:admin-web` PASS(`mutation-guard.gate.spec.ts` 포함), `cd apps/admin-web && npx tsc --noEmit` 0.
- [ ] **Step 5: 커밋** — `"CS 반품 시트에 회수 운송장과 [회수 다시 접수] (K8 PR9)"`

### Task 9: 문서 — 설계·한진 정본·모듈 README

**Files:**
- Modify: `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` §4.7(«PR 9 에서 확정한 결과» 블록), §8 표 PR 9 행 비고
- Modify: `docs/hanjin-api-integration-reference.md` §4.2(R 실측 표: `payTypCd`·응답 `wblNo`·`ERROR-03`+`wblNo`), §4.3(R 취소 결과코드 실측 — `ERROR-05`), §7(회수 스모크 명령)
- Modify: `apps/core/src/modules/fulfillment/waybill/README.md`(회수는 이 모듈의 상태머신을 타지 않는다 — 게이트웨이만 같이 쓴다, 한 단락)

- [ ] **Step 1: 설계 §4.7 에 «PR 9 에서 확정한 결과»** — 위 «사전 실측» 표의 요지와 N1~N10 을 앞 PR 블록과 같은 꼴(괄호 번호 + 한두 문장)로. 설계 §4.2 «반품 취소 — 도착 전에만. `cancelReturn` + (회수 예약이 있으면) core 가 한진 예약을 취소한다» 문장에 «취소 «전»에 동기로(N6)»를 덧붙인다.
- [ ] **Step 2: 한진 정본** — §4.2 아래에 «실측 (2026-10-28) — 배송구분 `R`» 표, §4.3 결과코드 줄에 `ERROR-05 이미 취소된 주문(문서에 없음, 실측)`, §7 에 스모크 명령. 계약번호 실값은 적지 않는다(공개 레포).
- [ ] **Step 3: 확인** — `git diff --stat` 이 문서 셋뿐.
- [ ] **Step 4: 커밋** — `"K8 PR9 결과를 설계·한진 정본에 적는다"`

---

## 최종 게이트 (브랜치 끝)

- `npm run type-check` 0 · `npx jest`(실패는 근태 4건뿐) · core 반품 통합 전부(scratch DB, `--runInBand`) · Medusa unit·통합 `http/(return-|partial-cancel|channel-cancel)` · `npx tsc --noEmit -p apps/medusa/tsconfig.json`(기존 3건) · admin-web `npm run test:admin-web`·`npx tsc --noEmit` · 스토어프론트 vitest(기준선 2건)·`npx jest scripts/storefront`.
- `npx dotenv -e apps/core/.env -- npx tsx scripts/smoke/hanjin-return-pickup-smoke.ts` 한 번(DEV).

## PR 본문에 실을 것 (Merge Danger 재료)

- **Door: one-way(마이그)** — `CREATE TYPE`·`CREATE TABLE` expand, `migrate → deploy`. 코드 롤백은 안전(옛 코드는 테이블을 안 읽는다) — 단 롤백하면 Medusa 놓아주기가 404 → «회수 없음»으로 취소가 통과한다(예약이 한진에 남음, 미집하는 무과금).
- **배포:** core·Medusa 한 `sst deploy`. Medusa 가 먼저 뜨면 404 → 지금처럼 취소(개통 전이라 회수 0).
- 🔴 **개통 전:** ① LIVE 키로 회수 스모크 — R + `HANJIN_RETURN_PAY_TYPE`(기본 `CT`)가 우리 계약에서 `OK` 인지. `ERROR-14` 면 `PP`·`CC` 중 계약에 맞는 값을 영업담당자에게 묻는다. ② 라이브 Core 는 지금 DEV 키(커밋 4cad80c19)라 회수 예약도 DEV 로 간다 — 출고 개통 때 LIVE 키로 바꾸는 것과 같이 간다.
- **동작 변경:** 반품 접수마다 1분 안에 한진 회수가 예약된다(고객에게 한진 알림이 가는지는 미확인). 반품 취소가 core 를 두 번 부른다(도착 확인 + 놓아주기, 놓아주기는 한진 왕복만큼 느려진다).
- **알려진 잔여:** 회수 추적 없음(N8) · 받는 곳은 `HANJIN_SENDER_*` 하나(N3) · 관측 지연 중 취소된 반품의 `cancel_pending` 이 한진에서 `ERROR-04` 면 소포가 기록 없이 온다(error 로그만) · 응답을 잃은 예약을 `not_found` 로 읽고 취소한 뒤 늦게 예약이 살아나면 한진에 미집하 예약이 남는다(무과금) · 고객이 회수 운송장번호를 보는 화면 없음 · CS 수기 회수 운송장 등록 없음.
- 배포 뒤 확인: ① `select count(*) from customer_return_pickups` 0 ② core 로그 `customer-return-pickup` 크론 매분 0건 ③ 아무 라이브 반품 id 없이 `POST /internal/sales-orders/customer-return-pickup/release` 키 없이 → 401.
