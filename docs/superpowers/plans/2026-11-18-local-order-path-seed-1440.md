# 로컬 자사몰 주문 경로 시드 (#1440) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 로컬 환경에서 브라우저 없이 명령만으로 자사몰 주문 N건을 부천 상자(재고 예약됨)까지 보낸다. 그 상자를 내보내면 송장이 가짜 한진에서 나와 Medusa 주문에 반영된다.

**Architecture:**
- 가짜 한진(`scripts/local/hanjin-stub.ts`)을 start-all 이 sms-stub 옆에 띄우고, core 의 한진 주소를 셸 env 로 덮는다.
- 상품 준비·주문 넣기는 `scripts/local/order-path/` 의 TS 스크립트로 만든다. 실제 HTTP API(core·user-service·Medusa·wallet·channel-adapter)만 부른다.
- 판정 로직은 순수 함수로 떼어 스펙을 붙이고, HTTP 호출부는 실제 스택에 대고 확인한다.

**Tech Stack:** TypeScript(`npx tsx`), node:http, bash(start-all·bootstrap·preflight), jest.

**Spec:** `docs/superpowers/specs/2026-11-18-local-order-path-seed-1440-design.md`

## Global Constraints

- 공개 레포다. 발송인·계약 값은 자리표시자만 쓴다(`로컬 발송인`, `0000000` 등). 테넌트 값(누구인지·도메인)은 적지 않는다.
- 판정은 DB·API 로 한다. 로그·화면을 성공 증거로 쓰지 않는다.
- 로컬 전용이다. 접속 대상 URL 의 host 가 `localhost`/`127.0.0.1` 이 아니면 시작 전에 거부한다.
- 앱↔`.env`↔포트의 정본은 `scripts/local/e2e-env-map.sh` 다. 가짜 한진 포트 `4599` 도 거기 한 줄(`E2E_HANJIN_STUB_PORT=4599`)로 둔다.
- 실제 한진은 `E2E_HANJIN=real` 일 때만 부른다.
- 송장 번호는 12자리다.
- 테넌트 1 만 다룬다. ① 모드와 ② 모드(`E2E_GATE_MODE=reject`) 양쪽에서 통과해야 한다.
- 새 스펙은 DB·스택 없이 도는 것만 둔다(기본 jest 게이트에 들어간다). 스펙 안에서 `dotenv.config()` 를 부르지 않는다.
- E2E 스택이 떠 있으면 전체 jest·type-check 를 돌리지 않는다. 대상 스펙만 돌린다. 전체 게이트는 스택을 내린 뒤 `--maxWorkers=2` 로 돌린다.
- `#1249` 브랜치(`feat/1249-emergency-outbound`)는 건드리지 않는다.

## Review Focus

1. **앞 실행의 상자가 아직 안 나간 채 다시 돌리면** 같은 주소의 상자와 합배송 묶음이 되면 안 된다. 상세주소에 실행 스탬프와 순번을 넣는다(Task 3 `recipientFor` 스펙).
2. **상품 만들기 도중에 죽은 뒤 다시 돌리면**(초안만 있고 발행 전) 상품이 두 벌이 되면 안 된다. 그 초안을 이어서 써야 한다(Task 3 `pickExistingMaster` 스펙).
3. **주문으로 재고가 줄어든 뒤 다시 채울 때**, 같은 멱등 키 때문에 조용히 건너뛰면 안 된다. 키는 호출마다 새로 만든다(Task 4 Step 3). 보충 수량은 Task 3 `stockTopUpDelta` 가 정한다.
4. **이름 검색은 부분일치다.** `[E2E] 주문 경로 옵션` 을 찾다가 `… 옵션 2` 를 고르면 안 된다(Task 3 `pickExistingMaster` 스펙).
5. **실제 한진 키가 든 기존 `.env` 로 그냥 start-all 을 띄워도** core 는 가짜 한진을 불러야 한다(Task 2 Step 2 dry-run 확인).

---

## File Structure

| 파일 | 책임 |
|---|---|
| `scripts/local/hanjin-stub.ts` (신규) | 가짜 한진 서버. #1249 `fake-hanjin.ts` 를 옮기고 `msg_key` 기억·`ERROR-09` 를 더한다 |
| `scripts/local/hanjin-stub.spec.ts` (신규) | 스텁 HTTP 응답 + 실제 `HanjinCarrierGateway` 로 읽은 결과 |
| `scripts/local/e2e-env-map.sh` | `E2E_HANJIN_STUB_PORT` 한 줄 |
| `scripts/local/start-all.sh` | 스텁 기동, core 기동 때 `HANJIN_*_BASE_URL` 덮기 |
| `scripts/local/bootstrap-e2e.sh` | channel-adapter `.env` 에 `CHANNEL_ADAPTER_INTERNAL_KEY` 가 없으면 더하기 |
| `scripts/local/preflight-e2e.sh` | 스텁·한진 주소·내부 키·주문 가능한 상품 판정 |
| `env-templates/.env.core.local.example` | `HANJIN_*` 자리표시자 13개 |
| `env-templates/.env.channel-adapter.local.example` | `CHANNEL_ADAPTER_INTERNAL_KEY` |
| `scripts/local/order-path-local.sh` (신규) | env map 을 source 하고 `E2E_ENV_ROWS_FLAT` 를 넘겨 `npx tsx …/order-path/index.ts "$@"` |
| `scripts/local/order-path/plan.ts` (신규) | 순수 판정 함수 |
| `scripts/local/order-path/plan.spec.ts` (신규) | 위 스펙 |
| `scripts/local/order-path/config.ts` (신규) | 앱 URL·키 해석(env map + `.env`) |
| `scripts/local/order-path/products.ts` (신규) | 상품 준비 |
| `scripts/local/order-path/buyer.ts` (신규) | 구매자 + Medusa 고객 세션 |
| `scripts/local/order-path/checkout.ts` (신규) | Medusa 장바구니 → 포인트 결제 → 주문 |
| `scripts/local/order-path/follow.ts` (신규) | 즉시 수집 → 부천 상자까지 기다림 |
| `scripts/local/order-path/index.ts` (신규) | CLI: `seed` / `order --count N` |
| `package.json` | `seed:order-path:local`, `order:place:local` |
| `docs/local-e2e-environment.md`, `CLAUDE.md` | 문서 |

HTTP 는 `scripts/tenancy/isolation-check/http.ts` 의 `expectOk`·`probe`·`waitFor` 를 쓴다. 직원 토큰은 `scripts/tenancy/staff-token.ts` 의 `signInStaff` 를 쓴다(로컬 `admin` / `Rehearsal1234!`, 계정 테넌트 `'1'`). `.env` 읽기는 `scripts/local/create-tenant/local-ports.ts` 의 `readEnvFile`·`REPO` 를 쓴다. 선례는 `scripts/local/isolation-check/index.ts:34-58` 이다.

---

### Task 1: 가짜 한진

**Files:**
- Create: `scripts/local/hanjin-stub.ts`
- Test: `scripts/local/hanjin-stub.spec.ts`

**Interfaces:**
- Produces:
  - `export const HANJIN_STUB_PORT = 4599`
  - `export function trackingNumbers(startedAtMs: number): () => string` — 12자리, `91` 로 시작
  - `export function hanjinStubServer(nextTrackingNo: () => string): http.Server`
  - `require.main === module` 이면 `127.0.0.1:${process.env.E2E_HANJIN_STUB_PORT ?? 4599}` 에서 listen

- [ ] **Step 1: 원본을 가져온다.** `git show origin/feat/1249-emergency-outbound:scripts/ops/emergency-outbound/local/fake-hanjin.ts > scripts/local/hanjin-stub.ts`. 이름을 위 Interfaces 대로 바꾼다. 원본은 119줄이다. 원본에 있는 것:
  - 번호 = `91` + (epoch 초 % 1e6, 6자리) + 4자리 카운터.
  - 분류 칸은 `DEV_HANJIN_SORT_FIELDS` 값(`hub_cod DV, tml_cod 421, tml_nam 부천, dom_mid D, cen_cod 4210, cen_nam 부천(집), grp_rnk A1, es_nam 개발기사, es_cod 001, dom_rgn 1, s_tml_cod 421, s_tml_nam 부천`).
  - `zip_cod: body.rcv_zip`, `prt_add: body.address`.
  - tracking 은 `ERROR-01`, 모르는 경로는 404 `NOT_FAKED`, 요청 경로만 로그(서명 헤더는 찍지 않는다).

- [ ] **Step 2: 실패하는 스펙을 쓴다** — `hanjin-stub.spec.ts`. 서버는 `listen(0)` 으로 띄운다. 스텁 HTTP 스펙:
  - `print-wbl 은 12자리 91… 번호와 분류 칸을 준다`:
    - `result_code === 'OK'`, `/^91\d{10}$/.test(wbl_num)`, `tml_cod === '421'`, `zip_cod === <보낸 rcv_zip>`.
  - `같은 msg_key 로 다시 받으면 같은 번호를 준다`, `다른 msg_key 면 다른 번호를 준다`.
  - `insert-order 출고는 첫 번째 OK, 같은 custOrdNo 두 번째는 ERROR-09`.
  - `insert-order 회수(svcCatCd R)는 OK + wblNo`.
  - `tracking-wbl 은 ERROR-01`.
  - `모르는 경로는 404`.

  게이트웨이 호환 스펙(`describe('HanjinCarrierGateway 가 스텁을 읽는다')`):
  - 실제 `HanjinApiClient` + `HanjinCarrierGateway`(`apps/core/src/modules/fulfillment/waybill/carrier/hanjin/`)를 스텁 주소로 만든다. 생성자와 config 모양은 `hanjin-carrier.gateway.spec.ts`·`hanjin.config.ts` 를 보고 맞춘다. 키는 더미다.
  - `allocate → waybillNo 12자리, labelData.tml_cod === '421'`
  - `register 두 번 → { kind: 'registered' } 다음 { kind: 'already_registered' }`
  - `track → []`

- [ ] **Step 3: 실패를 확인한다.** `npx jest scripts/local/hanjin-stub.spec.ts`. Expected: `msg_key` 기억과 ERROR-09 케이스가 FAIL.

- [ ] **Step 4: 구현한다.** 프로세스 메모리 안에 `Map<msg_key, wbl_num>` 과 `Set<custOrdNo>`(출고 등록분)을 둔다. 재기동하면 비지만, 번호는 시각 접두라 재기동 사이에 겹치지 않는다.

- [ ] **Step 5: 통과를 확인한다.** `npx jest scripts/local/hanjin-stub.spec.ts`. Expected: PASS.

- [ ] **Step 6: 커밋한다.** `git add scripts/local/hanjin-stub.ts scripts/local/hanjin-stub.spec.ts && git commit -m "[scripts] #1440 가짜 한진 — #1249 스텁을 로컬 정본으로 옮기고 재요청 동작을 맞춘다"`

---

### Task 2: 배선 — start-all·bootstrap·템플릿·preflight(스텁·키)

**Files:**
- Modify: `scripts/local/e2e-env-map.sh`
- Modify: `scripts/local/start-all.sh` — sms-stub 블록(`:76-80`) 옆, nest 기동 줄(`:69`)
- Modify: `scripts/local/bootstrap-e2e.sh` — `ensure_tenancy`(`:74~`) 옆
- Modify: `scripts/local/preflight-e2e.sh` — sms-stub 판정(`:94-96`) 옆, `/proc/$PID/environ` 선례(`:274-276`)
- Modify: `env-templates/.env.core.local.example:26-27`, `env-templates/.env.channel-adapter.local.example`

**Interfaces:**
- Consumes: Task 1 의 `scripts/local/hanjin-stub.ts` 실행.
- Produces:
  - env map 변수 `E2E_HANJIN_STUB_PORT=4599`.
  - 로컬 고정값 `CHANNEL_ADAPTER_INTERNAL_KEY=local-rehearsal-channel-adapter-key`(채널 어댑터 `.env`). Task 6 이 이 이름을 읽는다.

- [ ] **Step 1: start-all.**
  - sms-stub 옆에서 `npx tsx scripts/local/hanjin-stub.ts > logs/hanjin-stub.log 2>&1 &` 로 띄운다(dry-run 이면 `▶ (dry-run) hanjin-stub (:4599)` 만 찍는다).
  - `launch()` 에서 `name=core` 이고 `E2E_HANJIN` 이 `real` 이 아니면 `env HANJIN_ORDER_BASE_URL=http://127.0.0.1:$E2E_HANJIN_STUB_PORT HANJIN_PRINT_BASE_URL=… npx dotenv …` 로 띄운다.
  - `E2E_HANJIN=real` 이면 스텁을 띄우지 않는다. 대신 노란 줄로 `! E2E_HANJIN=real — core 가 apps/core/.env 의 실제 한진을 부른다` 를 찍는다.

- [ ] **Step 2: dry-run 으로 확인한다.**
  - `DRY_RUN=1 ./scripts/local/start-all.sh 2>&1 | grep -E 'hanjin-stub|core'`. Expected: hanjin-stub 줄이 있고, core 줄에 스텁 주소 덮기가 보인다. 무엇을 덮는지 dry-run 출력에 드러나게 만든다.
  - `E2E_HANJIN=real DRY_RUN=1 ./scripts/local/start-all.sh 2>&1 | grep 'E2E_HANJIN=real'`. Expected: 경고 한 줄.

- [ ] **Step 3: 템플릿.**
  - `.env.core.local.example` 의 «HANJIN_* 는 의도적으로 비운다» 주석을 «로컬은 가짜 한진(start-all 이 띄움)을 가리킨다»로 바꾼다. 13개를 채운다:
    - `HANJIN_CLIENT_ID=LOCALSTUB`, `HANJIN_API_KEY=local-stub`, `HANJIN_SECRET_KEY=local-stub`, `HANJIN_CONTRACT_NO=0000000`
    - `HANJIN_ORDER_BASE_URL=http://127.0.0.1:4599`, `HANJIN_PRINT_BASE_URL=http://127.0.0.1:4599`
    - `HANJIN_SENDER_NAME=로컬 발송인`, `HANJIN_SENDER_ZIP=00000`, `HANJIN_SENDER_BASE_ADDR=로컬 발송 주소`, `HANJIN_SENDER_DTL_ADDR=1층`, `HANJIN_SENDER_TEL=01000000000`
    - `HANJIN_BOX_TYPE=A`, `HANJIN_PAY_TYPE=PP`
  - `.env.channel-adapter.local.example` 에 `CHANNEL_ADAPTER_INTERNAL_KEY=local-rehearsal-channel-adapter-key` 를 더한다.

- [ ] **Step 4: bootstrap.** `ensure_tenancy` 와 같은 «없을 때만 덧붙이기»로 `apps/channel-adapter/.env` 에 `CHANNEL_ADAPTER_INTERNAL_KEY=local-rehearsal-channel-adapter-key` 를 더한다(`ok "channel-adapter — CHANNEL_ADAPTER_INTERNAL_KEY 를 더했다"`). core `.env` 의 `HANJIN_*` 는 건드리지 않는다. 덮기는 start-all 의 일이다.

- [ ] **Step 5: preflight.**
  - `check_port "$E2E_HANJIN_STUB_PORT"` → `ok "4599 hanjin-stub"`. 아니면 `bad "4599 hanjin-stub — 출고 송장 발급이 막힌다 (start-all.sh 가 띄운다)"`.
  - 떠 있는 core 의 `/proc/<pid>/environ` 에서 `HANJIN_ORDER_BASE_URL` 을 읽는다(`:274-276` 선례). 스텁 주소면 ok, 아니면 `warn "core 가 실제 한진을 부른다 (E2E_HANJIN=real?)"` 를 찍는다.
  - `apps/channel-adapter/.env` 에 `CHANNEL_ADAPTER_INTERNAL_KEY` 가 없으면 `bad "… 즉시 수집 401 → npm run bootstrap:e2e:local"`.

- [ ] **Step 6: 문법을 확인한다.** `bash -n scripts/local/start-all.sh scripts/local/bootstrap-e2e.sh scripts/local/preflight-e2e.sh`. Expected: 출력 없음.

- [ ] **Step 7: 커밋한다.** `git commit -m "[scripts] #1440 로컬 스택이 가짜 한진을 띄우고 core 송장 발급을 거기로 돌린다"`

---

### Task 3: 순수 판정 함수

**Files:**
- Create: `scripts/local/order-path/plan.ts`
- Test: `scripts/local/order-path/plan.spec.ts`

**Interfaces:**
- Produces:
  - `export const ORDER_PATH_PRODUCTS: readonly { name: string; options: readonly string[] }[]`
    - `[{ name: '[E2E] 주문 경로 단일', options: [] }, { name: '[E2E] 주문 경로 옵션', options: ['A', 'B'] }]`
  - `export const ORDER_PATH_PRICE = 12000`
  - `export const STOCK_TARGET = 100`
  - `export const ORDER_PATH_LOCATION_CODE = 'E2E-ORDER-01'`
  - `export const skuBarcodeFor(productName: string, option: string | null): string`
    - 예: `E2E-ORDER-단일`, `E2E-ORDER-옵션-A`. 고정이다.
  - `export interface MasterSummary { masterId: string; versionId: string; name: string; status: string }`
  - `export function pickExistingMaster(rows: MasterSummary[], name: string): { masterId: string; versionId: string; published: boolean } | null`
    - 이름이 정확히 같은 행만 본다. 발행본이 있으면 발행본을 고르고, 없으면 초안을 고른다.
  - `export function stockTopUpDelta(available: number | null, target: number): number`
    - `null` 은 0 으로 본다. 결과는 0 이상이다.
  - `export interface Recipient { firstName: string; lastName: string; phone: string; postalCode: string; address1: string; address2: string; province: string; city: string }`
  - `export function recipientFor(stamp: string, seq: number): Recipient`
    - 공개 실주소 목록을 순번으로 돌린다. 공공기관 주소를 쓴다. 우편번호는 `scripts/local/seed-hanjin-samples.ts` 의 확인된 값을 쓴다.
    - `address2 = \`E2E ${stamp}-${seq}\``
  - `export interface ShipmentView { id: string; status: string; warehouseId: string; totalQty: number; reservedQty: number }`
  - `export type BoxProgress = { kind: 'ready'; shipmentIds: string[] } | { kind: 'waiting'; stage: 'no_sales_order' | 'quarantined' | 'matching_pending' | 'no_fulfillment_order' | 'no_shipment' | 'not_reserved' | 'wrong_warehouse' }`
  - `export function judgeBox(obs: { salesOrderId: string | null; quarantined: boolean; unmatchedLines: number; fulfillmentOrderId: string | null; shipments: ShipmentView[] }, bucheonWarehouseId: string): BoxProgress`
    - ready 조건: 상자가 1개 이상이고 모두 `status === 'draft'` 이고 `warehouseId === bucheonWarehouseId` 이고 `reservedQty === totalQty > 0`.
    - waiting 단계는 위에 적은 순서대로 앞 단계부터 판정한다.

- [ ] **Step 1: 실패하는 스펙을 쓴다.**
  - `pickExistingMaster`:
    - `[{name:'[E2E] 주문 경로 옵션 2',…}]` 에서 `'[E2E] 주문 경로 옵션'` 을 찾으면 `null`.
    - 같은 이름의 초안과 발행본이 있으면 발행본을 고르고 `published: true`.
    - 초안만 있으면 그 초안을 고르고 `published: false`.
  - `stockTopUpDelta`: `(100,100)→0`, `(37,100)→63`, `(120,100)→0`, `(null,100)→100`.
  - `recipientFor`:
    - `('s1',1)` 과 `('s1',2)` 의 `address2` 가 다르다.
    - `('s1',1)` 과 `('s2',1)` 의 `address2` 가 다르다.
    - `postalCode` 가 `/^\d{5}$/` 이다.
  - `judgeBox`:
    - salesOrderId 가 없고 quarantined 이면 `waiting/quarantined`. 둘 다 아니면 `waiting/no_sales_order`.
    - `unmatchedLines 1` 이면 `matching_pending`.
    - 상자 2개가 모두 draft·부천·`reserved==total` 이면 `ready` 이고 id 둘.
    - 하나가 `reserved<total` 이면 `not_reserved`.
    - 다른 창고면 `wrong_warehouse`.

- [ ] **Step 2: 실패를 확인한다.** `npx jest scripts/local/order-path/plan.spec.ts`. Expected: FAIL(모듈 없음).

- [ ] **Step 3: 구현한다.**

- [ ] **Step 4: 통과를 확인한다.** 같은 명령. Expected: PASS.

- [ ] **Step 5: 커밋한다.** `git commit -m "[scripts] #1440 주문 경로 시드의 판정 함수"`

---

### Task 4: 상품 준비 명령 (`seed:order-path:local`)

**Files:**
- Create: `scripts/local/order-path/config.ts`, `scripts/local/order-path/products.ts`, `scripts/local/order-path/index.ts`, `scripts/local/order-path-local.sh`
- Modify: `package.json` scripts(`db:seed:*:local` 근처)

**Interfaces:**
- Consumes: Task 3 의 상수·`pickExistingMaster`·`stockTopUpDelta`·`skuBarcodeFor`. 그리고 `expectOk`/`probe`/`waitFor`, `signInStaff`, `readEnvFile`/`REPO`.
- Produces:
  - `export interface OrderPathConfig { coreUrl: string; userServiceUrl: string; walletUrl: string; channelAdapterUrl: string; medusaUrl: string; medusaAdminKey: string; publishableKey: string; channelAdapterInternalKey: string; oauthInternalSecret: string; userServiceDbUrl: string; adminWebClient: StaffClient }` — `adminWebClient` 는 `scripts/local/isolation-check/index.ts:93-104` 처럼 만든다(직원 토큰 = `signInStaff(cfg.adminWebClient, 'admin', 'Rehearsal1234!', '1')`)
  - `export function loadOrderPathConfig(): OrderPathConfig`
    - 포트는 `E2E_ENV_ROWS_FLAT` 에서 읽는다.
    - `medusaAdminKey` ← `apps/channel-adapter/.env` 의 `MEDUSA_API_KEY`.
    - `publishableKey` ← `web/almondyoung-storefront/.env.local` 의 `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`.
    - `oauthInternalSecret` ← `apps/user-service/.env` 의 `OAUTH_INTERNAL_SECRET`.
    - 모든 URL 은 localhost 가드를 통과해야 한다.
  - `export interface SeededVariant { productName: string; masterId: string; variantId: string; medusaVariantId: string; skuId: string; available: number }`
  - `export async function ensureOrderPathProducts(cfg: OrderPathConfig, staffToken: string): Promise<SeededVariant[]>`
  - `index.ts` 첫 인자가 `seed` 면 이걸 부르고 표로 찍는다.

- [ ] **Step 1: 래퍼와 package.json.**
  - `order-path-local.sh` 는 `isolation-check-local.sh` 와 같은 모양이다: env map 을 source 하고 `E2E_ENV_ROWS_FLAT` 를 export 한 뒤 `exec npx tsx scripts/local/order-path/index.ts "$@"`.
  - package.json:
    - `"seed:order-path:local": "./scripts/local/order-path-local.sh seed"`
    - `"order:place:local": "./scripts/local/order-path-local.sh order"`

- [ ] **Step 2: `ensureOrderPathProducts` 를 구현한다.** 순서대로 간다. 라우트와 DTO 는 아래에 적은 것이 정본이다(2026-11-18 조사):
  1. **배송 프로필**: `GET /inventory/delivery-profiles` 에서 이름이 `[E2E] 주문 경로 배송` 인 것을 찾는다. 없으면 `POST /inventory/delivery-profiles` 로 만든다.
     - body: `{name, sourceType:'in_house', sender:{name,phone}, originAddress:{postalCode,roadAddress,detailAddress}, returnAddress:{…}, carrierAccountRef, supportedFulfillmentModes:['in_house']}`.
     - 값은 Task 2 템플릿의 자리표시자와 같은 가짜 값이다.
     - `carrierAccountRef` 는 `scripts/local/seed-dev-core/master-data.ts:136-145` 가 쓰는 값을 따른다.
  2. **위치**: 부천 창고 id 는 `019d0001-0001-7000-a000-000000000001` 이다(`scripts/seeding/constants/uuids.ts`). `GET /locations/warehouses/:id` 에서 코드 `E2E-ORDER-01` 을 찾는다. 없으면 `POST /locations/warehouses/:id/racks/custom-bins` 로 만든다. DTO 는 `location.controller.ts:236` 을 본다.
  3. **상품**(상품마다):
     - `GET /masters?mode=all&page=1&limit=100&q=<encodeURIComponent(name)>` 를 부르고 `pickExistingMaster` 로 고른다.
     - 없으면 `POST /masters` 를 부른다. 응답의 `id` 가 versionId, `masterId` 가 master id 다.
     - 초안이면 `PUT /masters/:m/versions/:v` 로 `{name, brand:'E2E', supplyPrice:6000, marketPrice:15000, fulfillmentKind:'physical'}` 를 넣는다. 옵션 상품은 `optionDiff:{add:[{displayName:'색상', values:[{displayName:'A'},{displayName:'B'}]}]}` 도 넣는다.
     - 이어서 `PUT /versions/:v/pricing/rules` `{basePriceRules:[{order:1, layer:'base_price', scopeType:'all_variants', operationType:'override', operationValue:12000}], membershipPriceRules:[]}` 를 부른다. 초안일 때만 된다.
     - 그다음 `PATCH /masters/:m/versions/:v/publish` `{}`.
     - 이미 발행본이면 위를 건너뛴다.
  4. **variant 읽기**: `GET /masters/:m/versions/:activeV` 의 `variants[]` 에서 `id`·`optionValues` 를 읽는다.
  5. **Medusa 투영 기다리기**: `waitFor` 60초. Medusa `GET /admin/products?handle=<masterId>&fields=id,metadata,*variants,+variants.metadata` 를 `Authorization: Basic base64(<medusaAdminKey>:)` 로 부른다. product metadata 에 `pimMasterId`·`pimVersionId` 가 있고, 각 variant metadata 에 `pimVariantId` 가 있을 때까지 기다린다. 타임아웃이 나면 빈 칸 이름을 적고 던진다.
  6. **SKU**(variant 마다):
     - `GET /inventory/skus?barcode=<skuBarcodeFor(...)>` 를 부른다.
     - 없으면 `POST /inventory/skus` `{name:'[E2E] 주문 경로 SKU …', stockType:'physical', deliveryProfileId}` 로 만든 뒤 `POST /inventory/skus/:id/barcodes {barcode}` 로 바코드를 단다.
  7. **재고**:
     - `GET /inventory/stocks/sku/:skuId/warehouse/:bucheonId` 의 `summary.availableQuantity` 를 읽는다.
     - `stockTopUpDelta(available, 100)` 가 0 보다 크면 `POST /inventory/stocks/adjust` `{skuId, warehouseId, locationId, delta, reason:'E2E 주문 경로 재고 채우기', idempotencyKey:\`e2e-order-path:${skuId}:${Date.now()}\`}` 를 부른다.
     - v1 경로를 쓴다(`contractVersion` 은 넣지 않는다). 멱등 키를 현재 수량에서 만들면 Review Focus 3 에 걸린다.
  8. **매칭**: `PUT /matchings/:variantId` `{masterId, links:[{skuId, quantity:1}]}`. 행이 없어도 만든다(`product-sku-mapping.service.ts:315,420-470`). 같은 SKU 로 다시 부르면 같은 결과다.
  9. **판매 가능 기다리기**: `waitFor` 60초. Medusa store `GET /store/products?handle=<masterId>&fields=*variants,+variants.inventory_quantity,+variants.manage_inventory`(`x-publishable-api-key`) 에서 각 variant 가 `manage_inventory === false` 이거나 `inventory_quantity > 0` 일 때까지 기다린다. 이 필드 이름이 맞는지는 처음 돌릴 때 응답으로 확인하고, 다르면 실제 필드로 고친다.

- [ ] **Step 3: 스택에 대고 두 번 돌린다.**
  - 전제: `npm run bootstrap:e2e:local` → `npm run start:all:local`(다른 셸).
  - `npm run seed:order-path:local` 를 두 번 돌린다. Expected: 두 번 다 종료 0. 둘째 실행은 «만들었다» 줄 없이 같은 masterId·skuId 를 찍는다.
  - 확인 SQL(dev_core):
    - `select count(*) from product_masters m join product_master_versions v on … where v.name like '[E2E] 주문 경로%'` → 두 실행 뒤에도 같다. 실제 테이블 이름은 `catalog.schema.ts` 를 본다.
    - SKU 수가 같다.
    - 부천 가용이 100 이다.

- [ ] **Step 4: 커밋한다.** `git commit -m "[scripts] #1440 seed:order-path:local — 자사몰 주문 가능한 상품을 API 로 멱등 준비"`

---

### Task 5: 구매자와 Medusa 고객 세션

**Files:**
- Create: `scripts/local/order-path/buyer.ts`

**Interfaces:**
- Consumes: `OrderPathConfig`(Task 4), `signInAtSite`(staff-token.ts).
- Produces:
  - `export const BUYER = { loginId: 'e2eorderbuyer', password: 'E2eOrder1234!', email: 'e2e-order-buyer@example.com', username: '주문검증', nickname: '주문검증', birthday: '19900101', phoneNumber: '+821012341440' } as const`
  - `export async function ensureBuyer(cfg: OrderPathConfig): Promise<{ userId: string }>`
  - `export interface CustomerSession { medusaJwt: string; userServiceToken: string; email: string }`
  - `export async function customerSession(cfg: OrderPathConfig, userId: string): Promise<CustomerSession>`

- [ ] **Step 1: `ensureBuyer`.**
  - `signInAtSite({ baseUrl: cfg.userServiceUrl, internalSecret: cfg.oauthInternalSecret }, BUYER.loginId, BUYER.password, '1')` 로 로그인을 시도한다. 성공하면 `/users/me` 로 id 를 읽는다.
  - 401 이면 auth-web 과 같은 순서로 가입한다:
    - `POST /twilio/send-message {countryCode:'KR', phoneNumber, purpose:'phone_verify', channel:'SMS'}`.
    - user_service DB 에서 그 번호의 최신 코드를 읽는다: `select code from phone_verifications where phone_number=$1 order by created_at desc limit 1`, `postgres` 패키지, 읽기 전용.
    - `POST /twilio/verify-code {code, phoneNumber}`.
    - `POST /auth/signup` 에 `BUYER` 를 보낸다. 약관 불리언은 `isOver14·termsOfService·electronicTransaction·privacyPolicy·thirdPartySharing` 이 `true`, `marketingConsent` 가 `false` 다.
  - 그다음 적립금을 넣는다: `LOCAL_POINT_LOGIN_IDS=e2eorderbuyer LOCAL_POINT_AMOUNT=10000000 LOCAL_POINT_REASON=E2E_ORDER_PATH npx tsx scripts/local/seed-points-local.ts` 를 `child_process.execFileSync` 로 부른다. 같은 reason 이면 스크립트가 스스로 건너뛴다. 이 값이면 약 680건이 된다.

- [ ] **Step 2: `customerSession`.** 스토어프론트 `web/almondyoung-storefront/src/lib/api/medusa/sso.ts:51-185` 를 브라우저 없이 따른다:
  1. Medusa `POST /auth/customer/user-service-sso {callback_url:'http://localhost:8000/kr/callback/oidc'}`(`x-publishable-api-key`). 응답 `location` 에서 `state`·`code_challenge` 를 꺼낸다.
  2. user-service `POST /oauth/internal/issue-code`(`x-internal-secret: oauthInternalSecret`) `{clientId:'medusa-storefront', userId, redirectUri:<callback_url>, codeChallenge, codeChallengeMethod:'S256', scope:'openid email profile'}` → `code`.
  3. Medusa `GET /auth/customer/user-service-sso/callback?code&state` → `{token, idp_tokens:{access_token}}`.
  4. JWT payload 에 `actor_id` 가 없으면 `POST /store/customers`(Bearer token) `{email, metadata:{almond_user_id:userId, almond_login_id:'e2eorderbuyer'}}` 를 부르고 `POST /auth/token/refresh` 로 최종 JWT 를 받는다.
  - 반환값: `medusaJwt` = 최종 JWT, `userServiceToken` = `idp_tokens.access_token`.

- [ ] **Step 3: 스택에 대고 확인한다.**
  - `npx tsx -e` 로 두 함수를 한 번 부르는 임시 확인을 한다. 또는 Task 6 의 index 에 숨은 `buyer` 부명령을 둔다(커밋해도 된다).
  - Expected: 첫 실행은 가입하고 둘째 실행은 로그인만 한다. `medusa.customer` 에 그 이메일 1행, `has_account=t`.

- [ ] **Step 4: 커밋한다.** `git commit -m "[scripts] #1440 주문 경로 구매자 — 가입·적립금·Medusa 고객 세션을 브라우저 없이"`

---

### Task 6: 주문 넣기 명령 (`order:place:local`)

**Files:**
- Create: `scripts/local/order-path/checkout.ts`, `scripts/local/order-path/follow.ts`
- Modify: `scripts/local/order-path/index.ts`

**Interfaces:**
- Consumes: `ensureOrderPathProducts`·`SeededVariant`(Task 4), `ensureBuyer`·`customerSession`(Task 5), `recipientFor`·`judgeBox`(Task 3).
- Produces:
  - `export async function placeMedusaOrder(cfg: OrderPathConfig, s: CustomerSession, v: SeededVariant, recipient: Recipient): Promise<{ medusaOrderId: string; amount: number }>`
  - `export async function syncAndWaitForBox(cfg: OrderPathConfig, staffToken: string, medusaOrderId: string, timeoutMs?: number): Promise<{ salesOrderId: string; shipmentIds: string[] }>` — 기본 90초. 타임아웃이 나면 `judgeBox` 의 stage 를 메시지에 넣어 던진다.
  - CLI `order --count N`(기본 1): 실행마다 `stamp = KST yyyyMMddHHmmss`. 주문 i 는 variant 를 돌아가며 고르고 `recipientFor(stamp, i)` 를 쓴다.

- [ ] **Step 1: `placeMedusaOrder`.** 스토어프론트 순서다(`web/almondyoung-storefront/src/lib/api/medusa/cart.ts`, `checkout-template.tsx`). 헤더는 `x-publishable-api-key` + `authorization: Bearer medusaJwt`:
  1. `GET /store/regions` 에서 countries 에 `kr` 이 있는 region 을 고른다.
  2. `POST /store/carts {region_id, email, metadata:{cart_kind:'shopping'}}`.
  3. `POST /store/carts/:id/add-line-item {variant_id: v.medusaVariantId, quantity:1}`.
  4. `POST /store/carts/:id`:
     - `shipping_address`: `{first_name, last_name, phone, province, city, address_1, address_2, postal_code, country_code:'kr'}`.
     - `metadata`: `{cart_kind:'shopping', shipping_address_name:'E2E', shipping_memo_type:'door', shipping_memo_custom:'', has_entrance:false, entrance_password:''}`.
  5. `GET /store/shipping-options?cart_id=…&fields=id,name,amount,type,shipping_profile_id` 에서 `type.code==='standard'` 를 배송 프로필마다 하나씩 고르고 `POST /store/carts/:id/shipping-methods/bulk {option_ids}`.
  6. payment collection 을 만든다: `POST /store/payment-collections {cart_id}`. 이미 있으면 그걸 쓴다.
  7. 세션: `POST /store/payment-collections/:id/payment-sessions {provider_id:'pp_almond-payment_almond-payment', data:{returnUrl:'http://localhost:8000/kr/checkout/callback', orderName:'[E2E] 주문 경로', items:<buildPaymentItems 모양>, customerEmail}}`. `items` 모양은 `web/almondyoung-storefront/src/lib/utils/build-payment-items.ts` 를 따른다.
  8. `intentId = payment_sessions[0].data.intentId`, `amount = payment_sessions[0].data.amount`.
  9. wallet `POST /v1/payment-intents/:intentId/confirm {pointsToApply: amount}`(`Authorization: Bearer userServiceToken`, `Idempotency-Key: <randomUUID>`).
  10. `POST /store/carts/:id/complete`.
      - 응답이 `type:'order'` 면 `order.id` 를 쓴다.
      - «이미 완료» 응답이면 스토어프론트처럼 성공으로 본다(`checkout/callback/actions.ts:203-212`). 이때 `GET /store/orders?limit=1&order=-created_at` 로 id 를 읽는다.
      - 다른 응답은 본문을 그대로 실어 던진다. `INSUFFICIENT_POINTS` 면 «`LOCAL_POINT_REASON` 을 바꿔 `db:seed:points:local` 을 다시» 라고 안내한다.

- [ ] **Step 2: `syncAndWaitForBox`.**
  - channel-adapter `POST /adapter/orders/medusa/:medusaOrderId/sync`(`Authorization: Bearer channelAdapterInternalKey`, body `{}`) 를 부른다.
  - 그다음 10초 간격으로 관측을 모아 `judgeBox` 에 넣는다:
    - `GET /sales-orders?keyword=<id>&keywordType=orderNo` 를 부르고 `channelOrderId === medusaOrderId` 인 행을 정확히 고른다. 처음 돌릴 때 `channel_order_id` 가 Medusa order id 인지 확인한다. display_id 면 그쪽으로 고친다.
    - `GET /sales-orders/:id` 에서 `fulfillmentOrder`, `lines[].matchingResolved` 를 읽는다.
    - `GET /fulfillments/:foId/shipments` 를 읽는다.
    - 주문이 없을 때만 channel-adapter `GET /adapter/order-collection-failures?channel=medusa&status=quarantined`(직원 토큰) 에서 `external_order_id` 로 격리 여부를 본다.

- [ ] **Step 3: CLI 출력.**
  - 주문마다 `Medusa <order_…> → core <so id> → 상자 <id…>` 한 줄을 찍는다.
  - 끝에 `상자: <id1>,<id2>,…` 한 줄을 찍는다. #1249 `compare.ts --normal/--emergency` 에 붙일 수 있는 모양이다.
  - 하나라도 실패하면 종료 코드는 1 이다.

- [ ] **Step 4: 스택에 대고 확인한다(완료 조건 ①).** `npm run order:place:local -- --count 3`. Expected:
  - 종료 0, 상자 id 3개.
  - dev_core 에서 그 상자들이 `status='draft'`, 부천, `reserved_qty = total_qty` 다.
  - `stock_reservations` 에 `target_type='SHIPMENT_LINE'`, `status='confirmed'` 행이 있다.
  - 출고 준비 분류에서 세 상자가 `mergeable` 이 아니다. 어드민 출고 준비 API 나 consolidation board 로 확인한다. Review Focus 1 이다.

- [ ] **Step 5: 커밋한다.** `git commit -m "[scripts] #1440 order:place:local — 자사몰 주문을 넣고 부천 상자·예약까지 기다린다"`

---

### Task 7: preflight 상품 판정 + 문서

**Files:**
- Modify: `scripts/local/preflight-e2e.sh`, `docs/local-e2e-environment.md`, `CLAUDE.md`(«로컬 전 과정(E2E)» 절)

**Interfaces:**
- Consumes: Task 3 의 상품 이름·바코드·`STOCK_TARGET`. 셸에는 같은 문자열 리터럴로 두고, 옆에 «정본 `scripts/local/order-path/plan.ts`» 주석을 단다.

- [ ] **Step 1: preflight «주문 가능한 상품».** `pgq` 로 읽기만 한다. 셋 중 하나라도 안 되면 `warn "주문 경로 상품 없음 — 주문 리허설 전에 npm run seed:order-path:local"` 을 찍는다(경고이고, 실패로 세지 않는다).
  - dev_core: `[E2E] 주문 경로 단일` 의 활성 버전이 있다.
  - 그 variant 의 `product_matchings.status='matched'` 다.
  - 부천 가용 재고가 1 이상이다(`stock_summary_view`).
  - medusa: `product.handle = <그 masterId>` 의 metadata 에 `pimMasterId` 가 있다.

- [ ] **Step 2: 문법과 실행을 확인한다.**
  - `bash -n scripts/local/preflight-e2e.sh`.
  - 스택이 뜬 상태에서 `npm run preflight:e2e:local`. Expected: 스텁 ok, 한진 주소 ok, 내부 키 ok, 주문 경로 상품 ok(Task 4 이후).

- [ ] **Step 3: 문서.** `docs/local-e2e-environment.md`:
  - §2 에 두 명령과 가짜 한진(`E2E_HANJIN=real` 포함)을 적는다.
  - 새 절 «주문 한 건을 끝까지»: `order:place:local` → 상자 id → 창고 앱(정식) 또는 #1249 도구로 내보내기 → 확인 SQL(medusa `select metadata->>'coreShippingStatus', metadata->>'coreTrackingNumber' from "order" where id=…` → `shipped`, `91…` 12자리).
  - §8-D 머리에 «명령으로 대체됨 — 화면을 직접 볼 때만» 을 단다.
  - §9 표에 새 파일들을 더한다.
  - CLAUDE.md 에는 두 명령을 한 줄씩 더한다.

- [ ] **Step 4: 커밋한다.** `git commit -m "[docs·scripts] #1440 preflight 주문 경로 상품 판정과 «주문 한 건을 끝까지» 절차"`

---

### Task 8: 끝 확인 — 새 환경·두 모드·완료 조건 ②·게이트

**Files:** 없음(확인만). 고칠 것이 나오면 해당 Task 파일을 고치고 그 Task 이름으로 커밋한다.

- [ ] **Step 1: ① 모드.** `start:all:local` → `preflight:e2e:local` → `order:place:local -- --count 3`. Expected: Task 6 Step 4 와 같다.

- [ ] **Step 2: ② 모드.** 스택을 내리고 `E2E_GATE_MODE=reject npm run start:all:local` → `preflight` → `order:place:local -- --count 1`. Expected: 같은 결과. ① 에서 만든 상품을 그대로 쓰고, 상품 수는 늘지 않는다.

- [ ] **Step 3: 완료 조건 ②.** 상자 하나를 창고 앱 정식 경로로 내보낸다. 사람 작업이다 — 스테이션·폰 조작이 필요하면 사용자에게 요청한다.
  - 대안: #1249 가 rebase 된 뒤 그 도구로 확인한다.
  - core 정식 출고를 API 로 끝까지 몰 수 있으면 그 경로를 써도 된다. 쓴 경로를 기록한다.
  - Expected: medusa `order.metadata.coreShippingStatus='shipped'`, `coreTrackingNumber` 가 `/^91\d{10}$/`. `logs/hanjin-stub.log` 에 print-wbl·insert-order 가 찍혀 있고, 실제 한진 호출은 0 이다(core 로그에 실제 한진 호스트가 없다).

- [ ] **Step 4: 게이트.** 스택을 내린 뒤 `npm run type-check` 와 `npx jest --maxWorkers=2` 를 돌린다. Expected: 에러 0, 실패 0. 워크트리라면 앱별 node_modules 링크를 먼저 확인한다.

- [ ] **Step 5: 이슈.** #1440 본문의 완료 조건 판정을 PR 본문에 적는다. #1249 쪽에는 «`scripts/local/hanjin-stub.ts` 로 옮겼다 — rebase 때 `fake-hanjin.ts` 를 지울 것» 을 남긴다(사용자에게 알리고, 이슈 코멘트 여부는 사용자가 정한다).
