# K6 PR 5 — 스토어프론트 단계 라벨이 core 값을 따른다 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스토어프론트가 core 의 고객 단계 값(`preparing`·`shipping`)을 알아, 준비·배송 중 주문이 «결제 완료»로 보이지 않게 한다(스펙 §8 D8, 결함 F1). 같은 어긋남이 다시 생기면 루트 jest 가 빨갛게 한다.

**Architecture:** core 는 2026-07-19(`6b55fccee`)부터 `fulfillmentStatus` 로 `not_created | preparing | shipping | delivered | canceled` 를 보내는데(2b 부터는 `orderFulfillmentPhaseSql` 의 `store_phase`), 스토어프론트 타입·라벨표는 그 전의 FO 상태값(`created`·`picking`·`packed`·`shipped` …)에 머물러 있다. 스토어프론트 타입을 core 값으로 바꾸고 라벨표 둘(주 상태 문구 `order-status-display.ts`, 뱃지 `order-status-badges.tsx`)을 새 값으로 다시 쓴다. `web/**` 은 CI 가 0개이고 루트 `type-check` 도 `web` 을 제외하므로, core 트리에 «스토어프론트 타입이 core 값을 안다»를 대조하는 spec 을 두어 루트 jest(CI 가 도는 게이트)가 지키게 한다.

**Tech Stack:** Next.js 스토어프론트(vitest, `environment: node`), core 쪽 가드는 Jest(ts-jest).

**Spec:** `docs/superpowers/specs/2026-10-20-k6-line-quantity-facts-design.md` (§5 F1, §6.4, §6.5, §8 D8, §9-5). ADR: `docs/adr/0047-line-quantity-facts-one-record-one-reader.md`.

## Global Constraints

- **core 코드는 바꾸지 않는다.** 단계 판정은 2b 의 `orderFulfillmentPhaseSql` 한 벌이 정본이다 — 스토어프론트는 받은 값을 라벨로 옮기기만 한다. 이 PR 이 core 트리에 더하는 것은 가드 spec 하나다.
- 문구(스펙 D8 그대로): `preparing` → **«상품 준비 중»**, `shipping` → **«배송 중»**, `delivered` → **«배송 완료»**(지금과 같음).
- `not_created`·`canceled` 는 주 상태 문구를 정하지 않는다 — 지금처럼 SO 상태(`orderStatus`)·`paymentStatus` 분기로 내려간다. **D8 밖의 문구 변경은 없다.**
- F11(배송조회 `superseded` 제외)은 2b 에서 core 쪽으로 끝났다(`store-sales-orders.service.ts:1379`) — 이 PR 범위 아님.
- 범위 밖(손대지 않는다): Medusa `fulfillment_status` 를 보는 대체 경로(core 조회 실패 때의 `order-list.tsx:getOrderStatusKey`, 상세의 `tStatus(...)` 분기), 마이페이지 홈의 후보 선별(`mypage-order-status.ts:resolveMypageShippingStatus`), `shipmentProgress` 필드, 반품 400(F14 — K8/컷오버).
- 마이그레이션 없음. 배포 단위 **스토어프론트**만(가드 spec 은 배포물이 아니다). core 가 값을 먼저 보내고 있으므로 순서 의존 없음.
- 검증 게이트(트리별 — 루트 게이트는 `web` 을 안 본다):
  - 루트: `npm run type-check` 에러 0, `npx jest` 실패 0.
  - 스토어프론트(`cd web/almondyoung-storefront`): `npx vitest run` — **기준선 97 파일 / 721 테스트, 실패 2**(`src/i18n/messages/locale-parity.test.ts` en·ja 키 하나 부족, develop 선재·이 PR 무관). 이 PR 뒤 실패는 그 2건만. `npx tsc --noEmit` — **기준선 45건**, 이 PR 뒤 45건 이하이고 건드린 파일(`store-orders.ts`·`order-status-display.ts`·`order-status-badges.tsx`·`core-order-view.test.ts`)의 에러 0.
  - 워크트리에는 `web/almondyoung-storefront/node_modules` 가 없다 — 메인 체크아웃 것을 심링크한다(`ln -sfn <메인>/web/almondyoung-storefront/node_modules web/almondyoung-storefront/node_modules`). 이 계획 작성 때 이미 걸어 두었다.
  - `web/almondyoung-storefront/yarn.lock` 이 바뀌어 보이면 커밋하지 말고 되돌린다(`npm install` 부산물).

## 사용자 확인이 필요한 것

- **L1 라이브 영향.** 라이브 고객 주문(SO `pending`)은 FO 가 생겨 라인이 잡히는 순간부터 «결제 완료» 대신 **«상품 준비 중»** 으로 보인다(core 사다리 5→8: `required > 0` 이면 `preparing`). 셀메이트가 출고해 SO 가 `shipped` 가 된 주문은 지금도 «배송 중»이라 바뀌지 않는다(core 가 `shipping` 을 보내고 스토어프론트는 SO `shipped` 라벨로 같은 문구를 낸다). 실제로 몇 건이 바뀌는지는 배포 전 관찰 SQL(아래 «배포»)로 본다 — 게이트는 아니다.
- **L2 `canceled` 인데 SO 가 취소가 아닌 주문**(FO 전량 취소·활성 인쇄 0, SO 는 진행 중)은 지금처럼 SO 라벨(«결제 완료»)로 내려간다. 2b·PR 4 뒤로는 FO 취소가 판매주문 취소로만 일어나 새로 생기지 않는 모양이라 현행 유지로 둔다. 뱃지 줄에는 지금처럼 «출고 취소»가 붙는다.

## Review Focus

- **셀메이트 출고 주문**(`orderStatus: "shipped"`, `fulfillmentStatus: "shipping"` 또는 `"delivered"`) — 라벨이 «배송 중»/«배송 완료» 그대로여야 한다. Task 2 의 표 테스트에 둔다.
- **core 가 스토어프론트보다 먼저 값을 늘린 경우**(같은 SST 스택이라 배포 순서가 없다) — 모르는 값은 예외 없이 SO 라벨로 내려가야 하고, 루트 jest 의 가드가 그 PR 에서 빨개져야 한다. Task 2(모르는 값 테스트)·Task 1(가드).
- **무통장 입금 대기**(`orderStatus: "pending"`, `paymentStatus: "awaiting_payment"`, `fulfillmentStatus: "not_created"`) — «입금 대기» 유지. Task 2 표에 둔다. (core 는 지금 `paymentStatus` 로 `paid` 만 보내지만 분기는 남아 있다.)
- **FO 만 취소된 주문**(L2) — `{orderStatus: "confirmed", fulfillmentStatus: "canceled"}` → «결제 완료». Task 2 표에 현행 고정으로 둔다.
- **가드가 조용히 통과하는 것** — 타입 이름이 바뀌거나 정규식이 아무것도 못 읽으면 «빈 집합 ⊆ 무엇이든»으로 초록이 된다. Task 1 의 추출 함수는 못 찾거나 0개면 throw 하고, 그 self-test 를 둔다.

---

## 배포

- 배포 단위: **스토어프론트**. 마이그레이션 없음. 2b·3a·3b·4(#1116·#1118·#1119·#1120)와 같은 배포면 그 절차 먼저 — 이 PR 은 거기에 더하는 단계가 없다.
- `npm run deploy:preflight -- --stage live` 를 돌린다(배치 배포 방침). 스토어프론트는 `sst deploy` 가 체크아웃된 작업트리에서 `next build` 를 돌리므로 develop 최신에 서서 배포한다.
- **배포 전 관찰(게이트 아님, 터널은 사용자)** — L1 의 «라벨이 바뀌는 주문» 규모. 최근 14일 스토어프론트 주문을 SO 상태 × FO 유무로 센다. `pending`·`confirmed`·`processing` 이면서 FO 가 있고 `canceled` 가 아닌 행이 «결제 완료 → 상품 준비 중/배송 중»으로 바뀌는 쪽이다.
  ```sql
  SELECT so.status AS so_status,
         fo.status AS fo_status,
         count(*)  AS orders
  FROM sales_orders so
  LEFT JOIN fulfillment_orders fo ON fo.sales_order_id = so.id
  WHERE so.sales_channel = 'medusa'
    AND so.created_at > now() - interval '14 days'
  GROUP BY 1, 2
  ORDER BY 1, 2;
  ```
- 배포 뒤 확인(사람): 진행 중 주문 하나의 주문내역·상세·마이페이지 홈 카드가 «상품 준비 중»으로 보이는지.

---

### Task 1: 스토어프론트 타입이 core 값을 아는지 대조하는 가드 (루트 jest)

**Files:**
- Create: `apps/core/src/modules/sales-order/dto/store-order-actions.storefront-parity.spec.ts`
- Modify: `docs/adr/0047-line-quantity-facts-one-record-one-reader.md` — «이후 PR» 목록의 PR 4 항목 뒤에 PR 5 항목 추가(아래 Step 6)

**Interfaces:**
- Consumes: core `apps/core/src/modules/sales-order/dto/store-order-actions.dto.ts` 의 `export type` 다섯(`StoreOrderAction`·`StoreFulfillmentStatus`·`StoreRefundStatus`·`StoreCancelUnavailableReason`·`StoreClaimStatus`), 스토어프론트 `web/almondyoung-storefront/src/lib/api/orders/store-orders.ts` 의 같은 이름 다섯.
- Produces: 없음(가드). 파일 안 함수 `readStringUnion(source: string, typeName: string): string[]` — 다른 곳에서 쓰지 않으므로 spec 파일 안에 둔다.

- [ ] **Step 1: 추출 함수의 self-test 와 대조 테스트를 쓴다**

`fs.readFileSync(path.join(__dirname, ...))` 대신 저장소 루트 기준 경로(`path.resolve(__dirname, '../../../../../../', '<상대경로>')` 또는 `process.cwd()` — 루트 jest 는 `rootDir: "."`)로 두 파일을 읽는다.

```ts
describe('readStringUnion — 가드가 빈 집합으로 조용히 통과하지 않는다', () => {
  it('core 모양(작은따옴표·줄 주석·세미콜론)을 읽는다', () => {
    expect(readStringUnion("export type X =\n  | 'a' // 주석\n  | 'b'; // 끝\n\nexport type Y = 'z';", 'X')).toEqual(['a', 'b']);
  });
  it('스토어프론트 모양(큰따옴표·세미콜론 없음·줄 주석 줄)을 읽는다', () => {
    expect(readStringUnion('export type X =\n  | "a"\n  // 설명\n  | "b"\n\nexport interface Z {}', 'X')).toEqual(['a', 'b']);
  });
  it('한 줄 유니온을 읽는다', () => {
    expect(readStringUnion("export type X = 'a' | 'b';", 'X')).toEqual(['a', 'b']);
  });
  it('타입이 없으면 throw', () => {
    expect(() => readStringUnion("export type Y = 'a';", 'X')).toThrow();
  });
  it('문자열 리터럴이 0개면 throw', () => {
    expect(() => readStringUnion('export type X = string;', 'X')).toThrow();
  });
});

describe('스토어프론트 store-orders.ts 는 core 가 보내는 값을 전부 안다 (K6 PR5 · F1)', () => {
  it('StoreFulfillmentStatus 는 같은 집합이다 — 라벨표가 옛 FO 상태값에 머물면 «배송 중»이 «결제 완료»로 보인다', () => {
    expect([...storefront('StoreFulfillmentStatus')].sort()).toEqual([...core('StoreFulfillmentStatus')].sort());
  });
  it.each(['StoreOrderAction', 'StoreRefundStatus', 'StoreCancelUnavailableReason', 'StoreClaimStatus'])(
    '%s — core 값은 스토어프론트에도 있다(스토어프론트만 아는 값은 허용)',
    (name) => {
      const known = new Set(storefront(name));
      expect(core(name).filter((v) => !known.has(v))).toEqual([]);
    },
  );
});
```

`core(name)`·`storefront(name)` 은 각 파일 원문에 `readStringUnion` 을 건 것. 실패 메시지에 "core 의 `store-order-actions.dto.ts` 에 값을 더했으면 스토어프론트 `store-orders.ts` 와 라벨표(`order-status-display.ts`·`order-status-badges.tsx`)도 같은 PR 에서 고친다 — `web/**` 은 CI 가 없어 이 spec 이 유일한 게이트다" 를 담는다(파일 머리 주석으로 두면 된다).

`StoreFulfillmentStatus` 만 «같은 집합»인 이유(머리 주석에 한 줄): 스토어프론트에 남은 옛 값은 라벨표가 그 값을 기준으로 다시 짜이게 만든다 — F1 이 정확히 그것이었다. 나머지 넷은 스토어프론트가 먼저 아는 값(예: `cancel_requested`)이 있어 부분집합 규칙이다.

- [ ] **Step 2: 돌려서 대조 테스트가 빨간 것을 본다**

Run: `npx jest apps/core/src/modules/sales-order/dto/store-order-actions.storefront-parity.spec.ts`
Expected: self-test 5개 PASS, 부분집합 4개 PASS, `StoreFulfillmentStatus` 1개 FAIL — 스토어프론트에 `awaiting_matching`·`created`·`picking`·`packed`·`shipped` 가 있고 `preparing`·`shipping` 이 없다. (이 빨강이 F1 이다. 부분집합 넷 중 하나라도 FAIL 이면 지금 develop 에 이미 다른 어긋남이 있는 것이니 멈추고 보고한다.)

- [ ] **Step 3: 추출 함수를 구현한다 — `readStringUnion(source: string, typeName: string): string[]`**

`export type <typeName> =` 위치부터 다음 «유니온이 아닌 줄»(빈 줄, 또는 공백 뒤 `|`·`//`·`'`·`"` 로 시작하지 않는 줄) 전까지를 자르고, 그 안의 `//` 주석을 지운 뒤 `'…'`·`"…"` 리터럴을 순서대로 모은다. 첫 줄(`=` 뒤)의 리터럴도 센다(한 줄 유니온). 못 찾거나 0개면 `Error`.

- [ ] **Step 4: 돌려서 self-test 5개·부분집합 4개 PASS, `StoreFulfillmentStatus` 1개만 FAIL 인지 본다**

Run: Step 2 와 같음. Expected: 위와 같음 — 그 FAIL 은 Task 2 가 닫는다.

- [ ] **Step 5: 커밋 (빨간 가드를 단독 커밋으로 남긴다 — Task 2 와 같은 PR 에 실린다)**

```bash
git add apps/core/src/modules/sales-order/dto/store-order-actions.storefront-parity.spec.ts
git commit -m "test(core): 스토어프론트 주문 상태 타입이 core 값을 아는지 대조한다 (K6 PR5)"
```

- [ ] **Step 6: ADR-0047 에 PR 5 항목을 더한다**

`docs/adr/0047-line-quantity-facts-one-record-one-reader.md` 의 «이후 PR» 목록에서 PR 4 항목 묶음 뒤, PR 6 앞에:

```markdown
- PR 5 — (이 PR) 스토어프론트 단계 라벨(D8·F1). core 는 2026-07-19 부터 `fulfillmentStatus` 로 `preparing`·`shipping` 을 보냈는데 스토어프론트 타입·라벨표는
  옛 FO 상태값에 머물러, 준비·배송 중 주문이 «결제 완료»로 보였다. 타입을 core 값으로 바꾸고 `preparing` → «상품 준비 중», `shipping` → «배송 중».
  `not_created`·`canceled` 는 지금처럼 SO 상태 라벨로 내려간다. `web/**` 은 CI 가 없고 루트 `type-check` 도 `web` 을 제외하므로,
  `store-order-actions.storefront-parity.spec.ts`(루트 jest)가 두 트리의 상태 유니온을 대조한다 — `StoreFulfillmentStatus` 는 같은 집합, 나머지는 core ⊆ 스토어프론트.
  core 변경 없음, 배포 스토어프론트만.
```

```bash
git add docs/adr/0047-line-quantity-facts-one-record-one-reader.md
git commit -m "docs(adr-0047): K6 PR5 스토어프론트 단계 라벨"
```

---

### Task 2: 스토어프론트 타입과 라벨표를 core 값으로 (D8)

**Files:**
- Modify: `web/almondyoung-storefront/src/lib/api/orders/store-orders.ts:41-49` — `StoreFulfillmentStatus`
- Modify: `web/almondyoung-storefront/src/components/orders/order-status-display.ts:21-26` — `FO_DISPLAY_LABELS`(이름도 `PHASE_LABELS` 로; 더는 FO 상태가 아니다), `getCoreDisplayStatus` JSDoc 의 «FO 상태 >» 를 «진행 단계 >» 로
- Modify: `web/almondyoung-storefront/src/components/orders/order-status-badges.tsx:44-58` — `FULFILLMENT_STATUS_MAP`
- Modify: `web/almondyoung-storefront/src/lib/orders/core-order-view.test.ts:10` — 픽스처 `"created"` → `"not_created"`(새 타입에서 `"created"` 는 타입 에러)
- Create: `web/almondyoung-storefront/src/components/orders/order-status-display.test.ts`

**Interfaces:**
- Consumes: Task 1 의 가드(이 태스크 뒤 초록이 된다).
- Produces: `export type StoreFulfillmentStatus = "not_created" | "preparing" | "shipping" | "delivered" | "canceled"` (core `store-order-actions.dto.ts:6-11` 와 같은 순서). `getCoreDisplayStatus(actions: StoreOrderActionsResponse): string` 시그니처는 그대로.

- [ ] **Step 1: 라벨 표 테스트를 쓴다**

`order-status-display.test.ts`(vitest). 픽스처는 `core-order-view.test.ts` 의 `actions(over)` 모양을 따른다(기본 `orderStatus: "pending"`, `fulfillmentStatus: "not_created"`, `refundStatus: "none"`, `claimStatus: "none"`, `availableActions: []`).

```ts
describe("getCoreDisplayStatus — 진행 단계가 core 값을 따른다 (K6 PR5 · D8)", () => {
  it.each([
    // [orderStatus, fulfillmentStatus, paymentStatus, 기대 문구]
    ["pending", "preparing", "paid", "상품 준비 중"],   // D8: 전엔 «결제 완료»
    ["pending", "shipping", "paid", "배송 중"],          // D8: 전엔 «결제 완료»
    ["pending", "delivered", "paid", "배송 완료"],
    ["pending", "not_created", "paid", "결제 완료"],
    ["pending", "not_created", "awaiting_payment", "입금 대기"],
    ["pending", "not_created", undefined, "결제 완료"],
    ["confirmed", "preparing", "paid", "상품 준비 중"],
    ["processing", "preparing", "paid", "상품 준비 중"],
    ["shipped", "shipping", "paid", "배송 중"],          // 셀메이트 출고 — 바뀌지 않는다
    ["shipped", "delivered", "paid", "배송 완료"],       // 셀메이트 출고 — 바뀌지 않는다
    ["cancelled", "canceled", "paid", "취소됨"],
    ["confirmed", "canceled", "paid", "결제 완료"],      // L2: FO 만 취소 — 현행 유지
  ] as const)("%s · %s · %s → %s", (orderStatus, fulfillmentStatus, paymentStatus, expected) => {
    expect(getCoreDisplayStatus(actions({ orderStatus, fulfillmentStatus, paymentStatus }))).toBe(expected)
  })

  it("core 가 먼저 늘린 모르는 단계는 SO 라벨로 내려간다(예외 없음)", () => {
    const unknown = "returning" as unknown as StoreFulfillmentStatus // core 가 값을 먼저 늘리는 경우를 흉내 낸다
    expect(getCoreDisplayStatus(actions({ orderStatus: "pending", fulfillmentStatus: unknown }))).toBe("결제 완료")
  })
})
```

- [ ] **Step 2: 돌려서 실패를 본다**

Run: `cd web/almondyoung-storefront && npx vitest run src/components/orders/order-status-display.test.ts`
Expected: `preparing`·`shipping` 줄(4개: pending·confirmed·processing 의 preparing 3 + pending·shipping 1)이 «결제 완료»/«준비 중» 을 받아 FAIL. 나머지 PASS.

- [ ] **Step 3: 타입과 라벨표를 고친다**

- `store-orders.ts`: `StoreFulfillmentStatus` 를 위 Produces 의 다섯 값으로. 바로 위에 주석 한 줄 — core `store-order-actions.dto.ts` 와 같은 값이고 `store-order-actions.storefront-parity.spec.ts`(루트 jest)가 대조한다.
- `order-status-display.ts`: `PHASE_LABELS: Partial<Record<StoreFulfillmentStatus, string>> = { preparing: "상품 준비 중", shipping: "배송 중", delivered: "배송 완료" }`. `not_created`·`canceled` 는 넣지 않는다(SO 라벨로 내려간다 — 그 이유를 한 줄 주석으로).
- `order-status-badges.tsx`: `FULFILLMENT_STATUS_MAP: Record<StoreFulfillmentStatus, BadgeProps | null>` 를 다섯 키로 —
  `not_created: null`,
  `preparing: { label: "상품 준비 중", color: "bg-indigo-100 text-indigo-600" }`,
  `shipping: { label: "배송 중", color: "bg-green-100 text-green-600" }`,
  `delivered`·`canceled` 는 지금 값 그대로.
- `core-order-view.test.ts:10`: `"created"` → `"not_created"`.

- [ ] **Step 4: 스토어프론트 게이트를 돌린다**

Run: `cd web/almondyoung-storefront && npx vitest run`
Expected: 98 파일 / 734 테스트(기준선 721 + 새 13), 실패 2 — `locale-parity.test.ts` 의 en·ja 두 건만(선재).

Run: `cd web/almondyoung-storefront && npx tsc --noEmit 2>&1 | grep -c "error TS"` → 45 이하.
Run: `cd web/almondyoung-storefront && npx tsc --noEmit 2>&1 | grep -E "store-orders\.ts|order-status-display|order-status-badges|core-order-view\.test"` → 출력 없음.

Run: `grep -rnE '"(awaiting_matching|picking|packed)"' web/almondyoung-storefront/src --include=*.ts --include=*.tsx` → `fulfillmentStatus` 와 이어진 줄 없음(다른 도메인의 같은 낱말은 무관).

- [ ] **Step 5: 루트 게이트를 돌린다**

Run: `npx jest apps/core/src/modules/sales-order/dto/store-order-actions.storefront-parity.spec.ts` → 10 PASS(Task 1 의 FAIL 이 초록).
Run: `npm run type-check` → 에러 0. Run: `npx jest` → 실패 0.

- [ ] **Step 6: 커밋**

`git status` 에 `web/almondyoung-storefront/yarn.lock` 이 보이면 `git checkout -- web/almondyoung-storefront/yarn.lock` 로 되돌린다.

```bash
git add web/almondyoung-storefront/src/lib/api/orders/store-orders.ts \
        web/almondyoung-storefront/src/components/orders/order-status-display.ts \
        web/almondyoung-storefront/src/components/orders/order-status-display.test.ts \
        web/almondyoung-storefront/src/components/orders/order-status-badges.tsx \
        web/almondyoung-storefront/src/lib/orders/core-order-view.test.ts
git commit -m "fix(storefront): 진행 단계 라벨이 core 의 preparing·shipping 을 따른다 — 준비·배송 중 주문이 «결제 완료»로 보이던 것 (K6 PR5 · D8)"
```

---

## 곁에서 찾은 것 (이 PR 밖)

- **마이페이지 홈 «배송 현황»의 후보 선별은 Medusa `fulfillment_status` 를 본다**(`mypage-order-status.ts:resolveMypageShippingStatus` — `not_fulfilled`·`shipped`·`partially_fulfilled` 만 후보). 라벨은 core 를 따르지만 «어떤 주문을 보이나»는 Medusa 값이다. core 가 Medusa 이행을 밀지 않는다면(스펙 §12, 확인 못 함) 배송 완료된 주문도 후보로 남거나 반대일 수 있다 — 실측 뒤 별도 이슈 감.
- 스토어프론트 vitest `locale-parity.test.ts` 가 develop 에서 빨갛다(en·ja 에 ko 키 하나 부족) — `web/**` CI 0개라 아무도 못 봤다. 별도로 고친다.
