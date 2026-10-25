# K3 PR 3 — 이벤트 계약 넓히기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 소비자(channel-adapter·notification)가 입점사 상자의 발송 사실 — 새 택배사 8개, 창고 대신 입점사가 출처인 `ShipmentShipped` — 를 받아도 죽지 않게 한다. **core 는 아직 그런 이벤트를 내지 않는다** — 내는 것은 PR 5 이고, 그때 이 PR 이 라이브여야 한다.

**Architecture:** 택배사 목록을 계약 패키지 한 곳(`streams/carriers.ts`)으로 모으고 두 스트림이 그것을 쓴다. `ShipmentShipped` 는 `warehouseId`·`supplierId` 를 둘 다 optional 로 두고 «정확히 하나»를 `superRefine` 으로 강제한다 — 창고 이벤트의 모양은 그대로라 옛 소비자와 새 소비자가 같이 받는다. core 의 «소비자가 받는 택배사» 문(`EVENT_CONTRACT_CARRIERS`)은 이름만 바꿔 남긴다: **SST 한 스택 배포는 컴포넌트 순서를 정할 수 없어서**(`--target` 도 못 쓴다) «소비자 먼저»를 한 배포 안에서 지킬 수 없다. 이 PR 이 라이브가 된 «다음» 배포(PR 5)가 문을 지운다.

**Tech Stack:** zod(`packages/event-contracts`), NestJS(channel-adapter·notification·core), Jest, `npm run type-check`(타입 동치 가드).

**Spec:** `docs/superpowers/specs/2026-10-25-k3-drop-ship-supplier-shipments-design.md` (§4.1 송장, §4.6 이벤트, §6 «소비자 먼저», §7 PR 3). 앞 계획: `docs/superpowers/plans/2026-10-25-k3-supplier-shipments-expand-pr2.md` (N3 시도 종류, N5 택배사 8개).

## 코드에서 확인한 것 (설계와 다른 점)

- **`SalesOrderShipmentDispatched` 는 계약을 바꿀 필요가 없다.** `warehouseId` 칸이 없고 `carrier` 는 `z.string().min(1)`, `dispatchAttemptId` 는 PR 2 의 `dispatch_attempts.kind = 'supplier'` 시도 행이 채운다(`orders.stream.ts:566-578`). 설계 §4.6 의 «창고 전용 칸을 요구하면 넓힌다»는 해당 없음. 고칠 것은 notification 의 택배사 표시 이름뿐이다(`order-event.consumer.ts:16-23` — 지금 새 코드는 `EPOST` 그대로 고객에게 나간다).
- **`ShipmentShipped.warehouseId` 를 읽는 소비자는 없다.** channel-adapter 는 검증만 하고, Medusa 투영(`medusa.client.ts` `doUpdateOrderShipmentAttemptProjection`)은 `invoice`·`lines` 만 남긴다.
- **외부 채널 어댑터는 새 택배사를 모른다.** 네이버는 모르는 코드를 **`CJGLS` 로 바꿔 보낸다**(`naver-smartstore.adapter.ts:83-105` `DEFAULT`), 쿠팡은 `'OTHER'`. 직배는 외부 채널에서 팔지 않지만(비목표), 막는 곳이 없으면 틀린 택배사가 조용히 채널에 등록된다.

## 이름 붙은 결정 (⛔ 사용자 확인)

- **E1. 택배사 목록의 정본은 계약 패키지 `CARRIERS`(14개), core `carrierEnum` 은 따로 두고 타입 동치로 묶는다.** `pgEnum` 을 계약 상수에서 만들면 계약 PR 이 core 마이그를 몰래 만든다(generate 가 잡는다). 동치는 `type-check` 가 판정한다(PR 2 의 `event-contract-carriers.spec.ts` 방식).
- **E2. `ShipmentShipped` 출처 = `warehouseId?`·`supplierId?` 중 정확히 하나.** 판별 유니온(`origin: {kind…}`)은 창고 이벤트의 모양까지 바꿔 옛 소비자를 깨뜨린다 — 이 방식은 창고 이벤트가 바이트 그대로다.
- **E3. core 의 문은 `EVENT_CONTRACT_CARRIERS` → `CONSUMER_ROLLOUT_CARRIERS` 로 이름만 바꿔 남긴다**(값 6개 그대로, 송장 DTO·`emitDispatchEvents` 가드 그대로). 이 PR 배포 동안 core 가 새 값을 내면 아직 옛 버전인 소비자 태스크가 zod 로 throw 한다. **PR 5 가 지운다**(PR 3 라이브 확인 뒤). 이 PR 에서 창고 수기 송장에 새 택배사를 열지 않는다.
- **E4. channel-adapter: 외부 채널(`route.kind === 'adapter'`)로 가는 발송은 «입점사 출처» 또는 «옛 6개 밖의 택배사»면 운영 큐(manual)로 보낸다.** 어댑터별 택배사 표를 고치는 것은 범위 밖(직배는 외부 채널 비목표). Medusa 투영(`projection`)은 그대로 처리한다 — 자동 리뷰 자격이 그 기록을 읽는다(설계 §4.6).
- **E5. 고객 추적의 새 택배사 링크는 `null`.** 이름은 8개 모두 넣고(`CARRIER_NAMES`), 추적 URL 은 실측 확인 전이라 비운다 — 지금도 모르는 택배사는 `null` 이고 화면은 번호만 보인다. 링크는 PR 5 가 실물 송장으로 확인하며 더한다.

## Global Constraints

- **마이그 없음.** DB enum 은 PR 2 가 이미 14개다.
- core 는 새 택배사·`supplierId` 가 실린 이벤트를 **내지 않는다**(E3). 이 PR 의 core 변경은 이름·주석·표시 이름·가드 spec 뿐이다.
- 계약 변경은 additive 만: 값 추가, 필수 칸을 optional 로. 창고 `ShipmentShipped` 페이로드의 모양은 바뀌지 않는다.
- 택배사 이름(한국어, 고객에게 보임): `EPOST` 우체국택배 · `DAESIN` 대신택배 · `ILYANG` 일양로지스 · `HDEXP` 합동택배 · `CVSNET` GS편의점택배 · `CUPOST` CU편의점택배 · `CHUNIL` 천일택배 · `KUNYOUNG` 건영택배.
- admin-web 은 손대지 않는다(PR 7). `apps/admin-web/src/lib/services/orders/waybill-policy.ts` 의 6개는 그대로 둔다 — 서버 DTO 도 6개라(E3) 맞는다.
- 검증 게이트: `npm run type-check` 에러 0, `npx jest` 실패 0.

## Review Focus

- **이 PR 배포 중 옛 channel-adapter 태스크가 새 택배사 이벤트를 받음** — core 가 내지 않아야 한다. 창고 상자에 `EPOST` 수기 송장을 다는 요청은 400, 이미 그런 송장이 있으면 `emitDispatchEvents` 가 throw. DTO 쪽은 PR 2 의 `waybill.dto.spec.ts` 가, 발송 쪽은 최종 리뷰가 더한 `shipment-dispatch.service.spec.ts` «refuses to emit a carrier outside the consumer rollout carriers» 가 지킨다 — 계약이 14개가 된 뒤로는 타입이 이 문을 지키지 않는다. Task 1.
- **`warehouseId`·`supplierId` 둘 다 있거나 둘 다 없는 `ShipmentShipped`** — 거절. Task 2.
- **입점사 출처 발송이 네이버 주문에 실림** — `CJGLS` 로 등록되면 안 되고 manual. Task 3.
- **`HANJIN` 창고 발송의 네이버·쿠팡 자동 처리** — 이 PR 뒤에도 그대로 어댑터로 간다(회귀 없음). Task 3.
- **`EPOST` 발송 알림** — 고객 문자에 `우체국택배`, 원코드 `EPOST` 아님. Task 4.

---

## 배포

- **한 번의 `sst deploy`(services) 로 core·channel-adapter·notification 이 같이 롤린다. 순서는 상관없다** — core 는 새 값을 내지 않으므로(E3) 옛·새 소비자 어느 쪽이 받아도 같은 창고 이벤트다. «소비자 먼저»가 성립하는 것은 이 배포와 PR 5 배포 사이다.
- **🔴 PR 5 가 라이브가 된 뒤에는 channel-adapter·notification 을 이 PR 이전으로 롤백하지 않는다** — 새 값을 받는 순간 zod 가 throw 해 DLQ 로 간다. PR 5 계획의 롤백 절에 이 줄을 옮겨 적는다.
- `npm run deploy:preflight -- --stage live` 의 «이벤트 계약 변경» 목록에 `shipments.stream.ts`·`fulfillments.stream.ts`·`carriers.ts` 가 보이는 것이 정상이다.
- 라이브 실측 없음.

---

### Task 1: 택배사 목록 하나 — 계약 14개, core 는 동치 가드와 이름 바꾼 문

**Files:**
- Create: `packages/event-contracts/streams/carriers.ts`
- Modify: `packages/event-contracts/streams/shipments.stream.ts:17` (`ShipmentCarrierSchema`)
- Modify: `packages/event-contracts/streams/fulfillments.stream.ts:16, 142` (`Carrier`, `CarrierSchema`)
- Modify: `packages/event-contracts/streams/shipments.stream.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/carrier-gateway.interface.ts:6-16`
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/event-contract-carriers.spec.ts` (→ 파일 이름 `consumer-rollout-carriers.spec.ts` 로 `git mv`)
- Modify: `apps/core/src/modules/fulfillment/waybill/dto/waybill.dto.ts:3, 10-11, 19-20, 48-49`
- Modify: `apps/core/src/modules/fulfillment/services/shipment-dispatch.service.ts:50, 1160-1164`
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:87` (주석만)

**Interfaces:**
- Produces: `packages/event-contracts/streams/carriers.ts` — `export const CARRIERS = ['CJ','HANJIN','LOTTE','LOGEN','KDEXP','CJGLS','EPOST','DAESIN','ILYANG','HDEXP','CVSNET','CUPOST','CHUNIL','KUNYOUNG'] as const; export type Carrier = (typeof CARRIERS)[number];` (core `carrierEnum` 과 같은 순서). `fulfillments.stream.ts` 는 자기 `Carrier` 선언을 지우고 `export { CARRIERS, type Carrier } from './carriers';` 로 다시 내보낸다 — `streams/index.ts` 에 `carriers.ts` 를 따로 더하지 않는다(`export *` 중복 이름 충돌).
- Produces: core `CONSUMER_ROLLOUT_CARRIERS`(값 6개 그대로), `type ConsumerRolloutCarrier`, `isConsumerRolloutCarrier(carrier: CarrierCode): carrier is ConsumerRolloutCarrier`. 주석: «PR 3 이 계약을 14개로 넓혔다. 한 배포 안에서 소비자가 먼저 뜬다는 보장이 없어 core 는 이것만 낸다. PR 5 가 PR 3 라이브 뒤에 지운다.»

- [ ] **Step 1: 계약 spec — 새 택배사를 받는다**

`shipments.stream.spec.ts` 에 추가:

```ts
it.each(['EPOST', 'KUNYOUNG'] as const)('accepts supplier carrier %s on ShipmentShipped and FulfillmentShipped', (carrier) => {
  expect(SHIPMENT_STREAM.events.ShipmentShipped.schema!.safeParse({ ...validShipped, invoice: { ...validShipped.invoice, carrier } }).success).toBe(true);
  expect(FULFILLMENT_STREAM.events.FulfillmentShipped.schema!.safeParse({ ...validV1Shipped, trackingInfo: { carrier, trackingNumber: 'T-1' } }).success).toBe(true);
});
it('still rejects an unknown carrier', () => {
  expect(SHIPMENT_STREAM.events.ShipmentShipped.schema!.safeParse({ ...validShipped, invoice: { ...validShipped.invoice, carrier: 'UNKNOWN' } }).success).toBe(false);
});
```

(`validShipped`·`validV1Shipped` 는 그 파일에 이미 있는 유효 페이로드 픽스처 이름으로 바꿔 쓴다.)

- [ ] **Step 2: core 가드 spec 을 다시 쓴다** — `git mv event-contract-carriers.spec.ts consumer-rollout-carriers.spec.ts`

```ts
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
// type-check 가 판정한다 — DB enum 과 계약 택배사가 갈리면 컴파일이 깨진다
const dbEqualsShipments: Equal<CarrierCode, ShipmentCarrier> = true;
const dbEqualsFulfillments: Equal<CarrierCode, Carrier> = true;

it('DB enum 과 계약이 같은 14개다', () => {
  expect(dbEqualsShipments && dbEqualsFulfillments).toBe(true);
  expect([...carrierEnum.enumValues]).toEqual([...CARRIERS]);
});
it('core 가 내는 택배사는 옛 6개뿐이다(PR 5 가 지운다)', () => {
  expect([...CONSUMER_ROLLOUT_CARRIERS]).toEqual(['CJ', 'HANJIN', 'LOTTE', 'LOGEN', 'KDEXP', 'CJGLS']);
  expect(isConsumerRolloutCarrier('EPOST')).toBe(false);
});
```

- [ ] **Step 3: 실패 확인** — `npx jest packages/event-contracts/streams/shipments.stream.spec.ts apps/core/src/modules/fulfillment/waybill/carrier` → 새 케이스 FAIL(EPOST 거절, `CONSUMER_ROLLOUT_CARRIERS` 없음).

- [ ] **Step 4: 구현** — `carriers.ts` 를 만들고 두 스트림의 `z.enum([...6])` 을 `z.enum(CARRIERS)` 로. core 는 상수·타입·함수 이름을 바꾸고(값·동작 그대로) DTO 3곳과 `shipment-dispatch.service.ts` 의 가드·주석(«PR 3 이 계약을 넓혔지만 같은 배포의 옛 소비자를 위해 막는다 — PR 5 가 지운다»)을 따라 바꾼다. `inventory.schema.ts:87` 주석의 이름도 고친다.

- [ ] **Step 5: 통과 확인** — 같은 jest 명령 PASS, `npm run type-check` 에러 0. 그리고 PR 2 의 «창고 상자에 계약 밖 택배사» 케이스가 그대로 통과하는지: `npx jest apps/core/src/modules/fulfillment -t "carrier"` PASS.

- [ ] **Step 6: Commit** — `feat(event-contracts): 택배사 목록을 계약 한 곳 14개로, core 는 PR 5 까지 옛 6개만 낸다 (K3 PR 3)`

### Task 2: `ShipmentShipped` 출처 — 창고 또는 입점사, 정확히 하나

**Files:**
- Modify: `packages/event-contracts/streams/shipments.stream.ts:57-127` (`ShipmentShippedSchema`)
- Modify: `packages/event-contracts/streams/shipments.stream.spec.ts:133` 근처

**Interfaces:**
- Consumes: Task 1 의 `CARRIERS`.
- Produces: `ShipmentShippedPayload` 가 `warehouseId?: string; supplierId?: string` 을 갖는다(둘 다 `CoreUuidSchema.optional()`). JSDoc: «창고 상자면 `warehouseId`, 입점사 상자면 `supplierId`(K3). 정확히 하나.»

- [ ] **Step 1: 실패하는 테스트** — 기존 `it.each(['shipmentId','dispatchAttemptId','warehouseId'])` 에서 `warehouseId` 를 빼고, 다음을 더한다:

```ts
const { warehouseId, ...noOrigin } = validShipped;
const parse = (p: unknown) => SHIPMENT_STREAM.events.ShipmentShipped.schema!.safeParse(p).success;

it('accepts a supplier-origin shipment', () => {
  expect(parse({ ...noOrigin, supplierId: '44444444-4444-4444-8444-444444444444' })).toBe(true);
});
it('rejects a shipment with neither origin', () => expect(parse(noOrigin)).toBe(false));
it('rejects a shipment with both origins', () => {
  expect(parse({ ...validShipped, supplierId: '44444444-4444-4444-8444-444444444444' })).toBe(false);
});
it('rejects a non-uuid supplierId', () => expect(parse({ ...noOrigin, supplierId: 'acme' })).toBe(false));
it('keeps the warehouse payload shape unchanged', () => expect(parse(validShipped)).toBe(true));
```

- [ ] **Step 2: 실패 확인** — `npx jest packages/event-contracts/streams/shipments.stream.spec.ts` → supplier 케이스 FAIL(strict 가 `supplierId` 거절).
- [ ] **Step 3: 구현** — 두 칸을 optional 로, 기존 `superRefine` 첫머리에 «정확히 하나» 이슈(`path: ['warehouseId']`, message `'exactly one of warehouseId or supplierId is required'`)를 더한다.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npm run type-check` 에러 0(core `emitDispatchEvents` 는 `warehouseId` 만 채워 그대로 컴파일된다).
- [ ] **Step 5: Commit** — `feat(event-contracts): ShipmentShipped 출처를 창고 또는 입점사 하나로 (K3 PR 3)`

### Task 3: channel-adapter — 입점사 출처·새 택배사는 외부 채널로 자동 발송하지 않는다

**Files:**
- Modify: `apps/channel-adapter/src/services/shipment-dispatch-inbox.worker.ts:466-470` 근처(`route.kind === 'none'` 검사 바로 뒤, 어댑터 호출 앞)
- Modify: `apps/channel-adapter/src/services/shipment-dispatch-inbox.worker.spec.ts`
- Modify: `apps/channel-adapter/src/consumers/shipment-events.contract.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `Carrier`, Task 2 의 `supplierId?`.
- Produces: 워커 파일 상단 상수 `EXTERNAL_DISPATCH_CARRIERS: readonly Carrier[] = ['CJ','HANJIN','LOTTE','LOGEN','KDEXP','CJGLS']`. 주석: «네이버·쿠팡 어댑터의 택배사 표가 아는 것. 모르는 코드는 네이버가 CJGLS 로 바꿔 보낸다(`naver-smartstore.adapter.ts` DEFAULT) — 그래서 표에 넣기 전까지 운영 큐로 보낸다.»

- [ ] **Step 1: 실패하는 테스트** — 워커 spec, 네이버 주문 하나를 실은 `ShipmentShipped` 로:

```ts
it('routes a supplier-origin shipment on an adapter channel to manual', async () => {
  const result = await runShipped({ ...shippedFor(NAVER), warehouseId: undefined, supplierId: SUPPLIER_ID });
  expect(result).toEqual(expect.objectContaining({ manual: true, reason: expect.stringContaining('drop-ship') }));
  expect(adapter.executeCommand).not.toHaveBeenCalled();
});
it('routes a carrier outside the adapter tables to manual', async () => {
  const result = await runShipped(withCarrier(shippedFor(NAVER), 'EPOST'));
  expect(result).toEqual(expect.objectContaining({ manual: true, reason: expect.stringContaining('EPOST') }));
  expect(adapter.executeCommand).not.toHaveBeenCalled();
});
it('still dispatches a HANJIN warehouse shipment through the adapter', async () => {
  await runShipped(shippedFor(NAVER));
  expect(adapter.executeCommand).toHaveBeenCalledWith(expect.objectContaining({ tracking: { companyCode: 'HANJIN', number: expect.any(String) } }));
});
it('projects a supplier-origin EPOST shipment to Medusa', async () => {
  await runShipped({ ...withCarrier(shippedFor(MEDUSA), 'EPOST'), warehouseId: undefined, supplierId: SUPPLIER_ID });
  expect(medusaClient.updateOrderShipmentAttemptProjection).toHaveBeenCalled();
});
```

(`runShipped`·`shippedFor`·`withCarrier` 는 그 spec 의 기존 픽스처·헬퍼에 맞춰 만든다.) contract spec 에는 «`supplierId` 출처·`EPOST` 인 `ShipmentShipped` 를 컨슈머가 받아 inbox 에 넣는다» 한 케이스를 더한다.

- [ ] **Step 2: 실패 확인** — `npx jest apps/channel-adapter/src/services/shipment-dispatch-inbox.worker.spec.ts apps/channel-adapter/src/consumers/shipment-events.contract.spec.ts` → 앞의 둘 FAIL(어댑터가 불림).
- [ ] **Step 3: 구현** — 어댑터 갈래 앞에서 `shipped.supplierId` 면 `{ manual: true, reason: \`${channel} does not take drop-ship (supplier) shipments.\` }`, `!EXTERNAL_DISPATCH_CARRIERS.includes(shipped.invoice.carrier)` 면 `{ manual: true, reason: \`${channel} adapter has no carrier code for ${carrier}.\` }`. `projection` 갈래는 이 검사보다 앞에 있으므로 영향 없다.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npx jest apps/channel-adapter` 실패 0.
- [ ] **Step 5: Commit** — `feat(channel-adapter): 입점사 출처·모르는 택배사 발송은 외부 채널에 자동 등록하지 않는다 (K3 PR 3)`

### Task 4: 택배사 표시 이름 — 알림과 고객 추적이 14개를 다 안다

**Files:**
- Modify: `apps/notification/src/dispatcher/handlers/order-event.consumer.ts:16-23`
- Modify: `apps/notification/src/dispatcher/handlers/order-event.consumer.spec.ts:226-250` 근처
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:1119-1149` (`CARRIER_NAMES`·`CARRIER_CODE_ALIASES`)

**Interfaces:**
- Consumes: Task 1 의 `Carrier`(notification), core `CarrierCode`.
- Produces: 두 표 모두 **`satisfies Record<Carrier, string>`**(core 는 `CarrierCode`) 로 빠짐없음을 `type-check` 가 판정한다. 조회 타입은 지금처럼 `Record<string, string>` 으로 둔다(임의 문자열로 찾는다) — `const CARRIER_LABEL_BY_CODE = {…} satisfies Record<Carrier, string>; const CARRIER_LABEL: Record<string, string> = CARRIER_LABEL_BY_CODE;` 꼴. 기존 값(`CJGLS` 의 서로 다른 이름 등)은 바꾸지 않는다.

- [ ] **Step 1: 실패하는 테스트** — notification spec 에 기존 HANJIN 케이스를 본떠:

```ts
it('labels a supplier carrier in the shipped notice', async () => {
  await consumer.onShipmentDispatched(envelope, { ...dispatchedPayload, carrier: 'EPOST' });
  expect(dispatcher.send).toHaveBeenCalledWith(
    expect.objectContaining({ variables: expect.objectContaining({ carrier: '우체국택배' }) }),
  );
});
```

- [ ] **Step 2: 실패 확인** — `npx jest apps/notification/src/dispatcher/handlers/order-event.consumer.spec.ts` → FAIL(`'EPOST'` 그대로).
- [ ] **Step 3: 구현** — Global Constraints 의 이름 8개를 두 표에 넣는다. core `CARRIER_CODE_ALIASES` 에 각 한국어 이름(공백 없는 것)과 소문자 코드를 별칭으로 더한다(예: `우체국택배: 'EPOST'`, `우체국: 'EPOST'`, `epost: 'EPOST'`). `buildTrackingUrl` 은 건드리지 않는다 — 새 8개는 `default` 의 `null`(E5).
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npx jest apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts` PASS, `npm run type-check` 에러 0.
- [ ] **Step 5: 전체 게이트** — `npm run type-check` 에러 0, `npx jest` 실패 0.
- [ ] **Step 6: Commit** — `feat(notification,core): 입점사 택배사 8개의 이름을 알림과 고객 추적에 (K3 PR 3)`

### Task 5: 메모·설계 문서 맞추기

**Files:**
- Modify: `docs/superpowers/specs/2026-10-25-k3-drop-ship-supplier-shipments-design.md` §6·§7 PR 3·PR 5 줄

- [ ] **Step 1:** §6 «소비자 먼저» 문단 끝에 한 줄: «SST 한 스택은 컴포넌트 순서를 못 정한다 — PR 3 은 계약·소비자만 넓히고 core 는 옛 6개만 낸다. core 가 새 값을 내는 것은 PR 3 라이브 뒤의 PR 5 다.» §7 표의 PR 3 배포 칸을 «services 한 번(순서 무관, core 는 새 값을 내지 않음)», PR 5 칸에 «`CONSUMER_ROLLOUT_CARRIERS` 문 제거» 를 더한다. §7 표 아래에 PR 5 구현자용 주의 두 줄: «PR 5 는 PR 3 라이브(태그) 확인 뒤에만 배포한다», «🔴 PR 5 라이브 뒤에는 channel-adapter·notification 을 PR 3 이전으로 롤백하지 않는다 — 새 택배사·`supplierId` 를 zod 가 거절해 DLQ 로 간다». §4.6 `SalesOrderShipmentDispatched` 줄에 «계약 변경 불필요(칸 없음·`carrier` 는 문자열) — PR 3 확인» 을 더한다.
- [ ] **Step 2: Commit** — `docs(k3): PR 3 이 확인한 배포 순서와 SalesOrderShipmentDispatched 를 설계에 반영`
