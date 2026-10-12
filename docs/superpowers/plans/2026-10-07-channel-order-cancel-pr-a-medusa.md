# 채널 주문 취소 PR-A (Medusa) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Medusa 가 채널 주문 부분취소(주문 수정 + 환불 한 번)를 스스로 할 수 있게 하고, Medusa 밖에서 일어난 wallet 환불도 Medusa 장부에 남긴다 — 부르는 쪽(PR-B·C)이 아직 없어도 혼자 배포돼 안전한 상태로.

**Architecture:** 부분취소는 Medusa 공식 워크플로(주문 수정·`refundPaymentWorkflow`)를 이어 부르는 오케스트레이터 하나(`partialCancelOrder`)가 하고, 진행 단계를 주문 metadata 에 남겨 같은 `requestId` 로 다시 부르면 끊긴 곳부터 이어 간다. 계산(할인 비례·배송비 재계산)은 순수 함수로 떼어 유닛 테스트로 지킨다. 원칙 3(Medusa 장부 완결)은 캡처 투영과 같은 «표식 + provider 가 wallet 호출 건너뜀» 패턴이다.

**Tech Stack:** Medusa 2.13.4 (`@medusajs/medusa/core-flows`, `@medusajs/test-utils`), TypeScript, jest(@swc/jest), NestJS wallet 앱, zod 이벤트 계약.

**Spec:** `docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md` (§6 Medusa, §10 확인 항목, §11 PR-A). ADR-0042.

## Global Constraints

- Medusa 버전 2.13.4 — `SHIPPING_ADJUSTMENTS_REPLACE` 없음. 코어 라우트 override 금지, 새 경로에 만든다(CLAUDE.md «Medusa»)
- 워크플로 훅을 새로 등록하지 않는다(`no-duplicate-validate-hooks` 가드)
- 할인 비례: 남길 할인 = round-half-up(원래 할인 × 남은 수량 ÷ 원래 수량), 원 단위(KRW 정수)
- 배송비 차감 상한 = 이 부분취소의 상품 환불액(고객 추가 청구 없음)
- 스냅샷 없음 또는 그룹 어긋남 → 배송비 미조정 + `shippingNotAdjusted: true`
- 진행 단계 기록 키: 주문 `metadata.partialCancels[requestId]`, 단계 `edited` → `refunded`
- 부분취소 라우트: `POST /admin/orders/:id/partial-cancel`, 본문 `{ requestId, items: [{ item_id, quantity }] }`(quantity = **취소할** 수량)
- 부분취소 라우트 실패 응답 계약(PR-B 가 읽는다): 검증 거절 = 400 `{ type: 'not_allowed', message }`, 수정 확정 뒤 환불 실패 = 502 `{ type: 'refund_pending', stage: 'edited', requestId, message }`
- almond-payment 가 wallet 에 넘기는 환불 `reasonCode` = `'MEDUSA_REFUND'`(기존 값 유지)
- 검증 게이트: 루트 `npm run type-check` 0 · `npx jest` 0 · `apps/medusa` `npm run test:unit` 초록 · `scripts/local/run-medusa-integration.sh` 초록(postgres + redis 둘 다 떠 있어야 한다)

## 계획 단계에서 스펙과 달라진 점 (이 PR 의 마지막 태스크가 스펙에 반영)

1. **§10-4 답: wallet 환불 사실에 `reasonCode` 가 없다**(`gateway-event.builder.ts` `buildRefundEventPayload` — refundId·금액·intentId 뿐). → Task 2 에서 wallet 이 싣는다. 계약 스키마가 `catchall(z.unknown())` 이라 소비자는 깨지지 않는다. 판별은 두 신호(`reasonCode === 'MEDUSA_REFUND'` 또는 provider 가 기록한 wallet 환불 id)로 한다 — 배포 겹침 창에서 한쪽이 비어도 다른 쪽이 잡는다.
2. **크레딧 라인을 직접 부르지 않는다.** `refundPaymentWorkflow` 가 «주문이 돌려줘야 할 금액(pending difference)»을 넘는 환불분에 크레딧 라인을 스스로 붙인다(`core-flows/dist/payment/workflows/refund-payment.js` 의 `creditLineAmount`). 상품 차액 + 배송비 환불을 한 번에 환불하면 배송비 몫이 자동으로 크레딧 라인이 된다. 스펙 §6.2 의 7·8단계가 하나로 합쳐지고 단계는 `edited → refunded` 둘이다. 크레딧 라인의 reference 는 우리가 정하지 않으므로 화면 표시는 주문 metadata 의 `partialCancels[requestId].shippingRefund` 로 한다.
3. **결정적 Idempotency-Key 가 가능하다.** Medusa 결제 모듈이 provider 에 `context.idempotency_key = refund.id` 를 넘긴다(`payment/dist/services/payment-module.js` `refundPaymentFromProvider_`). almond-payment 가 이걸 wallet `Idempotency-Key` 로 쓴다.
4. **오케스트레이터는 `createWorkflow` 가 아니라 공식 워크플로를 차례로 부르는 함수다.** 진행 단계 이어 가기가 조건 분기라 `when` 으로 짜면 읽기 어렵고, 이어 가기의 근거는 어차피 metadata 의 단계 기록이다. 각 공식 워크플로는 그 자체로 원자적이다.

## Review Focus

1. **같은 주문에 부분취소를 두 번** — 두 번째의 배송비 «지금 그룹 요금»은 원래 배송 방법 금액이 아니라 첫 번째가 남긴 새 요금이어야 한다(Task 6 `currentGroupFee`, Task 7 테스트)
2. **배송 대상이 아닌 줄(디지털)이 섞인 주문** — 배송비 계산에서 빠지고, 그룹 어긋남으로 오판하지 않아야 한다(Task 6 테스트)
3. **수량을 0으로 만드는 줄과 줄이는 줄이 한 요청에 섞임** — 0 은 할인 재작성 대상이 아니다(Task 6·7 테스트)
4. **같은 `requestId` 로 다시 호출하는데 요청 내용이 다름** — 처음 결과를 돌려주지 말고 거절해야 한다(Task 7 테스트)
5. **wallet 환불 사실이 Medusa 자신이 낸 환불의 것** — 장부에 두 번 넣지 않아야 한다(Task 4 테스트, 두 신호 각각)

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `apps/wallet/src/messaging/gateway-event.builder.ts` | 환불 사실 payload 에 `reasonCode` (Task 2) |
| `apps/wallet/src/refunds/refunds.service.ts` | 두 성공 경로가 `reasonCode` 를 넘긴다 (Task 2) |
| `packages/event-contracts/streams/payment.stream.ts` | `GatewayRefundEventPayload.reasonCode?` (Task 2) |
| `apps/medusa/src/modules/almond-payment/service.ts` | `refundPayment`: 결정적 키·wallet 환불 id 기록·외부 환불 표식 건너뜀 (Task 3) |
| `apps/medusa/src/modules/almond-payment/refund-data.ts` (신규) | 결제 data 의 환불 표식 읽기/쓰기 순수 함수 (Task 3) |
| `apps/medusa/src/api/hooks/payment-events/route.ts` | `handleRefundProjection` 이 외부 환불을 Medusa 환불 레코드로 (Task 4) |
| `apps/medusa/src/api/hooks/payment-events/classify-wallet-refund.ts` (신규) | «Medusa 가 낸 환불인가» 판정 순수 함수 (Task 4) |
| `apps/medusa/src/modules/almond-fulfillment/service.ts` | `validateFulfillmentData` 가 정책 스냅샷을 남긴다 (Task 5) |
| `apps/medusa/src/workflows/orders/partial-cancel/amount.ts` (신규) | Medusa 금액(number/string/BigNumber) → number (Task 6) |
| `apps/medusa/src/workflows/orders/partial-cancel/prorate-adjustments.ts` (신규) | 할인 비례 (Task 6) |
| `apps/medusa/src/workflows/orders/partial-cancel/plan-shipping.ts` (신규) | 배송비 재계산 계획 (Task 6) |
| `apps/medusa/src/workflows/orders/partial-cancel/plan-partial-cancel.ts` (신규) | 요청 검증 + 남을 수량 + 상품 환불 추정(상한용) (Task 6) |
| `apps/medusa/src/workflows/orders/partial-cancel/partial-cancel-order.ts` (신규) | 오케스트레이터 (Task 7) |
| `apps/medusa/src/api/admin/orders/[id]/partial-cancel/route.ts` (신규) | 라우트 (Task 8) |
| `apps/medusa/src/api/admin/orders/[id]/partial-cancel/parse-input.ts` (신규) | 본문 검증 (Task 8) |
| `apps/medusa/integration-tests/http/fixtures/partial-cancel-fixture.ts` (신규) | 가짜 wallet + 배송 그룹 + 주문 만들기 (Task 1) |
| `apps/medusa/integration-tests/http/order-edit-characterization.spec.ts` (신규) | §10 1~3 특성 테스트 (Task 1) |
| `apps/medusa/integration-tests/http/wallet-refund-projection.spec.ts` (신규) | 원칙 3 (Task 4) |
| `apps/medusa/integration-tests/http/partial-cancel.spec.ts` (신규) | 오케스트레이터·라우트 (Task 7·8) |

---

### Task 1: 픽스처와 Medusa 동작 특성 테스트 (§10 1~3)

이 PR 의 나머지가 기대는 Medusa 동작 셋을 실 DB 로 못 박는다. **결과가 예상과 다르면 여기서 멈추고 사람에게 알린다** — 스펙 §6 을 고쳐야 한다. 이 스펙은 Medusa 를 올릴 때 다시 돌려 동작이 그대로인지 보는 용도로 남긴다.

**Files:**
- Create: `apps/medusa/integration-tests/http/fixtures/partial-cancel-fixture.ts`
- Create: `apps/medusa/integration-tests/http/order-edit-characterization.spec.ts`

**Interfaces:**
- Produces:
  - `class FakeWallet` — `start()`, `stop()`, `reset()`, `refunds: Array<{ id: string; intentId: string; amount: number; idempotencyKey?: string; reasonCode?: string }>`, `failNextRefund: boolean`, `callsTo(suffix: string): number`
  - `setupCommerce(ctx: { api; getContainer }): Promise<Commerce>` — `Commerce = { regionId; salesChannelId; storeHeaders; adminHeaders; groups: Record<'cond'|'flat'|'perq', { code; shippingProfileId; shippingOptionId }>; variants: Record<'A'|'B'|'C'|'D', string> }`
  - `placeOrder(ctx, commerce, wallet, opts: { lines: Array<{ variant: 'A'|'B'|'C'|'D'; quantity: number }>; promoCode?: string; postalCode?: string }): Promise<{ orderId: string; intentId: string }>`
  - `createOrderFixedPromo(ctx, commerce, code: string, value: number): Promise<string>`
  - `loadOrder(container, orderId): Promise<any>` — items(+adjustments)·shipping_methods·summary·credit_lines·payment_collections.payments(+captures, refunds)·metadata
  - 상품 구성: A·B = 그룹 `cond`(조건부 무료, 기본 3,000원, 기준 50,000원) 각 30,000원 / C = 그룹 `flat`(3,000원) 10,000원 / D = 그룹 `perq`(수량당 1,000원) 5,000원

- [ ] **Step 1: 픽스처 작성**

`deferred-approval-checkout.spec.ts` 의 가짜 wallet 을 줄이고, 환불 기록·실패 주입·`REFUND_AMOUNT_EXCEEDS_AVAILABLE` 규칙을 더한다.

```ts
// apps/medusa/integration-tests/http/fixtures/partial-cancel-fixture.ts
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import {
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createProductsWorkflow,
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from '@medusajs/core-flows';
import { createServer, Server } from 'http';
import jwt from 'jsonwebtoken';
import {
  ensureKoreanShippingInfrastructure,
  listShippingGroups,
  provisionShippingGroup,
} from '../../../src/modules/almond-fulfillment/provision-shipping-group';
import { DEFAULT_SHIPPING_GROUP_DELIVERY } from '../../../src/modules/almond-fulfillment/types';

export const WALLET_PORT = 39131;
export const WALLET_BASE_URL = `http://127.0.0.1:${WALLET_PORT}`;

type Intent = { id: string; amount: number; status: string; captured: number; refunded: number };

/** 실제 wallet 의 환불 규칙(환불가능액 초과 거절, Idempotency-Key 재생)을 흉내내는 최소 스텁. */
export class FakeWallet {
  server?: Server;
  intents = new Map<string, Intent>();
  refunds: Array<{ id: string; intentId: string; amount: number; idempotencyKey?: string; reasonCode?: string }> = [];
  calls: Array<{ path: string; method: string }> = [];
  failNextRefund = false;
  private seq = 0;

  async start() {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = body ? JSON.parse(body) : {};
        const key = (req.headers['idempotency-key'] as string | undefined) ?? undefined;
        const { status, payload } = this.route(req.method ?? 'GET', new URL(req.url ?? '/', WALLET_BASE_URL).pathname, parsed, key);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      });
    });
    await new Promise<void>((r) => this.server!.listen(WALLET_PORT, '127.0.0.1', r));
  }
  async stop() {
    if (this.server) await new Promise<void>((r) => this.server!.close(() => r()));
  }
  reset() {
    this.intents.clear();
    this.refunds = [];
    this.calls = [];
    this.failNextRefund = false;
  }
  /** 결제창 완료 = 즉시 승인 + 캡처(지연 승인 표식이 없을 때의 wallet 동작). */
  simulateCheckout(intentId: string) {
    const i = this.intents.get(intentId)!;
    i.status = 'CAPTURED';
    i.captured = i.amount;
  }
  callsTo(suffix: string) {
    return this.calls.filter((c) => c.path.endsWith(suffix)).length;
  }
  private route(method: string, path: string, body: any, key?: string): { status: number; payload: any } {
    this.calls.push({ path, method });
    if (method === 'POST' && path === '/v1/payment-intents') {
      const id = `int_${++this.seq}`;
      this.intents.set(id, { id, amount: body.amount ?? 0, status: 'CREATED', captured: 0, refunded: 0 });
      return { status: 201, payload: { id } };
    }
    const m = /^\/v1\/payment-intents\/([^/]+)(\/.*)?$/.exec(path);
    const intent = m && this.intents.get(m[1]);
    if (!m || !intent) return { status: 404, payload: { error: 'INTENT_NOT_FOUND', message: path } };
    const action = m[2] ?? '';
    if (method === 'GET' && !action) {
      return { status: 200, payload: { id: intent.id, status: intent.status, payableAmount: intent.amount, currency: 'KRW' } };
    }
    if (action === '/finalize-approval') {
      intent.status = 'CAPTURED';
      intent.captured = intent.amount;
      return { status: 200, payload: { status: intent.status } };
    }
    if (action === '/capture') return { status: 200, payload: { status: intent.status } };
    if (action === '/cancel') return { status: 200, payload: { status: 'CANCELED' } };
    if (action === '/refund') {
      const replay = key ? this.refunds.find((r) => r.idempotencyKey === key) : undefined;
      if (replay) return { status: 200, payload: { intentId: intent.id, refunds: [{ id: replay.id, amount: replay.amount, status: 'SUCCEEDED' }] } };
      if (this.failNextRefund) {
        this.failNextRefund = false;
        return { status: 502, payload: { error: 'PG_UNAVAILABLE', message: 'injected' } };
      }
      const amount = Number(body.amount ?? 0);
      if (amount > intent.captured - intent.refunded) {
        return { status: 400, payload: { error: 'REFUND_AMOUNT_EXCEEDS_AVAILABLE', message: `${amount}` } };
      }
      intent.refunded += amount;
      const refund = { id: `ref_${++this.seq}`, intentId: intent.id, amount, idempotencyKey: key, reasonCode: body.reasonCode };
      this.refunds.push(refund);
      return { status: 200, payload: { intentId: intent.id, refunds: [{ id: refund.id, amount, status: 'SUCCEEDED' }] } };
    }
    return { status: 404, payload: { error: 'NOT_FOUND', message: path } };
  }
}

export type Ctx = { api: any; getContainer: () => any };
export type Commerce = {
  regionId: string;
  salesChannelId: string;
  storeHeaders: { headers: Record<string, string> };
  adminHeaders: { headers: Record<string, string> };
  groups: Record<'cond' | 'flat' | 'perq', { code: string; shippingProfileId: string; shippingOptionId: string }>;
  variants: Record<'A' | 'B' | 'C' | 'D', string>;
};

export async function setupCommerce({ api, getContainer }: Ctx): Promise<Commerce> {
  const container = getContainer();
  const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
  const secret = config.projectConfig.http.jwtSecret;
  const [user] = await container.resolve(Modules.USER).createUsers([{ email: 'admin@partial-cancel.test' }]);
  const adminHeaders = {
    headers: {
      authorization: `Bearer ${jwt.sign(
        { actor_id: user.id, actor_type: 'user', auth_identity_id: 'a', app_metadata: { user_id: user.id } },
        secret,
      )}`,
    },
  };

  const { result: sc } = await createSalesChannelsWorkflow(container).run({
    input: { salesChannelsData: [{ name: 'PartialCancel SC' }] },
  });
  const salesChannelId = sc[0].id;
  const { result: regions } = await createRegionsWorkflow(container).run({
    input: { regions: [{ name: 'KR-pc', currency_code: 'krw', countries: ['kr'], payment_providers: ['pp_almond-payment_almond-payment'] }] },
  });
  const regionId = regions[0].id;

  const { stockLocationId } = await ensureKoreanShippingInfrastructure(container);
  await linkSalesChannelsToStockLocationWorkflow(container).run({ input: { id: stockLocationId, add: [salesChannelId] } });

  const groupDefs = {
    cond: { code: 'pc-cond', name: '조건부', policy: { type: 'conditional_free' as const, baseFee: 3000, freeThreshold: 50000 } },
    flat: { code: 'pc-flat', name: '고정', policy: { type: 'flat' as const, baseFee: 3000 } },
    perq: { code: 'pc-perq', name: '수량당', policy: { type: 'per_quantity' as const, baseFee: 1000 } },
  };
  for (const g of Object.values(groupDefs)) {
    await provisionShippingGroup(container, { ...g, delivery: DEFAULT_SHIPPING_GROUP_DELIVERY });
  }
  const resolved = await listShippingGroups(container);
  const groupOf = (code: string) => {
    const g = resolved.find((x) => x.code === code)!;
    return { code, shippingProfileId: g.shippingProfileId, shippingOptionId: g.shippingOptionId };
  };
  const groups = { cond: groupOf('pc-cond'), flat: groupOf('pc-flat'), perq: groupOf('pc-perq') };

  const product = (title: string, sku: string, price: number, profileId: string) => ({
    title,
    status: 'published' as const,
    shipping_profile_id: profileId,
    sales_channels: [{ id: salesChannelId }],
    options: [{ title: 'Size', values: ['F'] }],
    variants: [{ title: 'F', sku, manage_inventory: true, options: { Size: 'F' }, prices: [{ amount: price, currency_code: 'krw' }] }],
  });
  const { result: products } = await createProductsWorkflow(container).run({
    input: {
      products: [
        product('PC-A', 'PC-A', 30000, groups.cond.shippingProfileId),
        product('PC-B', 'PC-B', 30000, groups.cond.shippingProfileId),
        product('PC-C', 'PC-C', 10000, groups.flat.shippingProfileId),
        product('PC-D', 'PC-D', 5000, groups.perq.shippingProfileId),
      ],
    },
  });
  const variants = {
    A: products[0].variants[0].id,
    B: products[1].variants[0].id,
    C: products[2].variants[0].id,
    D: products[3].variants[0].id,
  };

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const inventory = container.resolve(Modules.INVENTORY);
  const { data: links } = await query.graph({
    entity: 'product_variant_inventory_item',
    fields: ['variant_id', 'inventory_item_id'],
    filters: { variant_id: Object.values(variants) },
  });
  await inventory.createInventoryLevels(
    links.map((l: any) => ({ inventory_item_id: l.inventory_item_id, location_id: stockLocationId, stocked_quantity: 1000 })),
  );

  const { result: keys } = await createApiKeysWorkflow(container).run({
    input: { api_keys: [{ title: 'pk-pc', type: 'publishable', created_by: user.id }] },
  });
  await linkSalesChannelsToApiKeyWorkflow(container).run({ input: { id: keys[0].id, add: [salesChannelId] } });
  const storeHeaders = { headers: { 'x-publishable-api-key': keys[0].token } };

  return { regionId, salesChannelId, storeHeaders, adminHeaders, groups, variants };
}

/** 주문 금액 전체에 고정 할인(across). 줄마다 금액 비례로 나뉜 할인이 생긴다. */
export async function createOrderFixedPromo({ api }: Ctx, c: Commerce, code: string, value: number) {
  const res = await api.post(
    '/admin/promotions',
    {
      code, type: 'standard', is_automatic: false, status: 'active',
      application_method: { type: 'fixed', value, target_type: 'order', allocation: 'across', currency_code: 'krw' },
      additional_data: { visibility: 'public' },
    },
    c.adminHeaders,
  );
  return res.data.promotion.id as string;
}

export async function placeOrder(
  { api, getContainer }: Ctx,
  c: Commerce,
  wallet: FakeWallet,
  opts: { lines: Array<{ variant: 'A' | 'B' | 'C' | 'D'; quantity: number }>; promoCode?: string; postalCode?: string },
) {
  const cartRes = await api.post(
    '/store/carts',
    {
      region_id: c.regionId,
      sales_channel_id: c.salesChannelId,
      email: 'buyer@partial-cancel.test',
      items: opts.lines.map((l) => ({ variant_id: c.variants[l.variant], quantity: l.quantity })),
      shipping_address: {
        first_name: '홍', last_name: '길동', address_1: '서울 중구 세종대로 110', city: '서울',
        country_code: 'kr', postal_code: opts.postalCode ?? '04524', phone: '01000000000',
      },
    },
    c.storeHeaders,
  );
  const cartId = cartRes.data.cart.id as string;
  if (opts.promoCode) await api.post(`/store/carts/${cartId}/promotions`, { promo_codes: [opts.promoCode] }, c.storeHeaders);

  // 주문에 쓰인 그룹마다 배송 방법 하나.
  const used = new Set(opts.lines.map((l) => ({ A: 'cond', B: 'cond', C: 'flat', D: 'perq' } as const)[l.variant]));
  for (const g of used) {
    await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: c.groups[g].shippingOptionId }, c.storeHeaders);
  }

  const pc = await api.post('/store/payment-collections', { cart_id: cartId }, c.storeHeaders);
  const ses = await api.post(
    `/store/payment-collections/${pc.data.payment_collection.id}/payment-sessions`,
    { provider_id: 'pp_almond-payment_almond-payment' },
    c.storeHeaders,
  );
  const intentId = ses.data.payment_collection.payment_sessions[0].data.intentId as string;
  wallet.simulateCheckout(intentId);
  const done = await api.post(`/store/carts/${cartId}/complete`, {}, c.storeHeaders);
  if (done.data.type !== 'order') throw new Error(`cart complete failed: ${JSON.stringify(done.data)}`);
  return { orderId: done.data.order.id as string, intentId };
}

export async function loadOrder(container: any, orderId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'order',
    fields: [
      'id', 'status', 'version', 'total', 'metadata', 'summary.*', 'credit_lines.*',
      'items.id', 'items.quantity', 'items.unit_price', 'items.product_id', 'items.requires_shipping',
      'items.adjustments.*',
      'shipping_methods.id', 'shipping_methods.amount', 'shipping_methods.shipping_option_id', 'shipping_methods.data', 'shipping_methods.name',
      'shipping_address.postal_code',
      'payment_collections.payments.id', 'payment_collections.payments.data',
      'payment_collections.payments.captures.amount', 'payment_collections.payments.refunds.amount',
    ],
    filters: { id: orderId },
  });
  return data[0] as any;
}
```

- [ ] **Step 2: 픽스처 스모크 테스트 작성**

```ts
// apps/medusa/integration-tests/http/order-edit-characterization.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules } from '@medusajs/framework/utils';
import {
  beginOrderEditOrderWorkflow,
  orderEditUpdateItemQuantityWorkflow,
  requestOrderEditRequestWorkflow,
  confirmOrderEditRequestWorkflow,
  refundPaymentWorkflow,
} from '@medusajs/medusa/core-flows';
import {
  FakeWallet, WALLET_BASE_URL, setupCommerce, placeOrder, createOrderFixedPromo, loadOrder, Commerce,
} from './fixtures/partial-cancel-fixture';

jest.setTimeout(300 * 1000);
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';

const wallet = new FakeWallet();
const num = (v: any) => Number(v?.numeric_ ?? v?.value ?? v);

/**
 * Medusa 2.13.4 의 주문 수정·환불 동작 특성 테스트. 채널 주문 부분취소(스펙 §6.2)가 이 동작에 기댄다.
 * Medusa 를 올리면 이 파일을 먼저 돌려 동작이 그대로인지 본다.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: { WALLET_BASE_URL, WALLET_API_KEY: 'test-wallet-key' },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let c: Commerce;
    const ctx = { api, getContainer };

    beforeAll(async () => {
      await wallet.start();
      c = await setupCommerce(ctx);
      await createOrderFixedPromo(ctx, c, 'PC5000', 5000);
    });
    afterAll(async () => wallet.stop());
    beforeEach(() => wallet.reset());

    it('픽스처: 할인·배송 방법·캡처가 있는 주문이 만들어진다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }, { variant: 'C', quantity: 1 }], promoCode: 'PC5000' });
      const o = await loadOrder(getContainer(), orderId);
      expect(o.items).toHaveLength(2);
      expect(o.items.flatMap((i: any) => i.adjustments).length).toBeGreaterThan(0);
      expect(o.shipping_methods).toHaveLength(2);
      const payment = o.payment_collections[0].payments[0];
      expect(payment.captures.length).toBe(1);
    });
  },
});
```

- [ ] **Step 3: 스모크 실행**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern order-edit-characterization`
Expected: PASS. 실패하면 픽스처를 고친다 — 흔한 원인: 지역에 결제 provider 미연결(`payment_providers`), 배송지 우편번호 누락으로 calculated 옵션 계산 실패, 판매채널 ↔ 재고 위치 미연결. 픽스처가 통과할 때까지 다음 단계로 가지 않는다.

- [ ] **Step 4: 특성 테스트 셋 추가 (§10 1~3)**

같은 `describe` 안에 더한다.

```ts
    const editQuantity = async (orderId: string, itemId: string, quantity: number) => {
      const container = getContainer();
      await beginOrderEditOrderWorkflow(container).run({ input: { order_id: orderId } });
      await orderEditUpdateItemQuantityWorkflow(container).run({ input: { order_id: orderId, items: [{ id: itemId, quantity }] } });
      await requestOrderEditRequestWorkflow(container).run({ input: { order_id: orderId } });
      await confirmOrderEditRequestWorkflow(container).run({ input: { order_id: orderId } });
    };

    it('§10-1: carry_over_promotions 를 켜지 않고 수량만 줄이면 그 줄의 할인 금액은 그대로 남는다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }, { variant: 'C', quantity: 1 }], promoCode: 'PC5000' });
      const before = await loadOrder(getContainer(), orderId);
      const lineA = before.items.find((i: any) => num(i.unit_price) === 30000);
      const adjBefore = lineA.adjustments.reduce((s: number, a: any) => s + num(a.amount), 0);

      await editQuantity(orderId, lineA.id, 1);

      const after = await loadOrder(getContainer(), orderId);
      const lineAfter = after.items.find((i: any) => i.id === lineA.id);
      expect(num(lineAfter.quantity)).toBe(1);
      expect(lineAfter.adjustments.reduce((s: number, a: any) => s + num(a.amount), 0)).toBe(adjBefore);
    });

    it('§10-3: 수량 감소 확정 뒤 돌려줄 차액은 음수 pending_difference 로 나오고, 결제 컬렉션이 새로 생기지 않는다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }] });
      const before = await loadOrder(getContainer(), orderId);
      const collectionsBefore = before.payment_collections.length;

      await editQuantity(orderId, before.items[0].id, 1);

      const after = await loadOrder(getContainer(), orderId);
      expect(num(after.summary.pending_difference)).toBe(-30000);
      expect(after.payment_collections.length).toBe(collectionsBefore);
    });

    it('§10-2: 돌려줄 차액보다 많이 환불하면 refundPaymentWorkflow 가 초과분만큼 크레딧 라인을 붙여 차액이 0 이 된다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }] });
      const before = await loadOrder(getContainer(), orderId);
      await editQuantity(orderId, before.items[0].id, 1);

      const mid = await loadOrder(getContainer(), orderId);
      const payment = mid.payment_collections[0].payments[0];
      await refundPaymentWorkflow(getContainer()).run({ input: { payment_id: payment.id, amount: 30000 + 3000 } });

      const after = await loadOrder(getContainer(), orderId);
      expect(num(after.summary.pending_difference)).toBe(0);
      expect(after.credit_lines.reduce((s: number, l: any) => s + num(l.amount), 0)).toBe(3000);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([33000]);
    });
```

- [ ] **Step 5: 실행**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern order-edit-characterization`
Expected: 4 tests PASS. **하나라도 기대와 다르면 커밋하지 말고 멈춰서 사람에게 결과를 보고한다**(스펙 §10 규칙). 특히 §10-1 이 다르면(할인이 줄어 있으면) Task 6 의 비례 계산이 이중 차감이 된다.

- [ ] **Step 6: 커밋**

```bash
git add apps/medusa/integration-tests/http/fixtures/partial-cancel-fixture.ts apps/medusa/integration-tests/http/order-edit-characterization.spec.ts
git commit -m "test(medusa): 주문 수정·환불 동작 특성 테스트와 부분취소 픽스처 (#1016 35번 PR-A)"
```

---

### Task 2: wallet 환불 사실에 `reasonCode`

almond-payment 가 낸 환불(`reasonCode: 'MEDUSA_REFUND'`)을 Medusa 가 사실만 보고 가릴 수 있게 한다.

**Files:**
- Modify: `apps/wallet/src/messaging/gateway-event.builder.ts` (`RefundEventInput`, `buildRefundEventPayload`)
- Modify: `apps/wallet/src/refunds/refunds.service.ts` (`create` 의 성공 경로, `confirmManualRefund`(약 425행 이하 «MANUAL_CONFIRM» 경로))
- Modify: `packages/event-contracts/streams/payment.stream.ts` (`GatewayRefundEventPayload`)
- Test: `apps/wallet/src/messaging/gateway-event.builder.spec.ts` (없으면 생성)

**Interfaces:**
- Produces: 환불 사실 payload 에 `reasonCode?: string` — refunds 행의 `reason_code` 값 그대로

- [ ] **Step 1: 실패하는 테스트**

```ts
// apps/wallet/src/messaging/gateway-event.builder.spec.ts
import { buildRefundEventPayload } from './gateway-event.builder';

describe('buildRefundEventPayload', () => {
  const base = { refundId: 'r1', chargeId: 'c1', intentId: 'i1', userId: 'u1', status: 'SUCCEEDED' as const, amount: 1000, currency: 'KRW' };

  it('reasonCode 를 싣는다 — Medusa 가 자기가 낸 환불을 가리는 근거', () => {
    expect(buildRefundEventPayload({ ...base, reasonCode: 'MEDUSA_REFUND' }).reasonCode).toBe('MEDUSA_REFUND');
  });

  it('reasonCode 가 없으면 키를 만들지 않는다', () => {
    expect('reasonCode' in buildRefundEventPayload(base)).toBe(false);
  });
});
```

(파일이 이미 있으면 `describe` 를 더한다. `status` 의 타입이 `RefundStatus` 라 `as const` 가 맞지 않으면 그 타입을 import 해서 쓴다.)

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/wallet/src/messaging/gateway-event.builder.spec.ts`
Expected: FAIL — `reasonCode` 가 `RefundEventInput` 에 없어 undefined

- [ ] **Step 3: 구현**

`gateway-event.builder.ts`:

```ts
export interface RefundEventInput {
  refundId: string;
  chargeId: string;
  intentId: string;
  userId: string;
  status: RefundStatus;
  amount: number;
  currency: string;
  /** 환불을 요청한 쪽이 남긴 사유 코드. Medusa 는 'MEDUSA_REFUND' 로 자기가 낸 환불을 가린다(ADR-0042). */
  reasonCode?: string | null;
  occurredAt?: string;
  extra?: Record<string, unknown>;
}

export function buildRefundEventPayload(input: RefundEventInput): GatewayRefundEventPayload {
  return {
    refundId: input.refundId,
    chargeId: input.chargeId,
    intentId: input.intentId,
    userId: input.userId,
    status: input.status,
    amount: input.amount,
    currency: input.currency,
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    ...(input.extra ?? {}),
    occurredAt: normalizeOccurredAt(input.occurredAt),
  };
}
```

`payment.stream.ts` 의 `GatewayRefundEventPayload` 인터페이스에 `reasonCode?: string;` 한 줄(스키마는 `catchall` 이라 바꾸지 않는다).

`refunds.service.ts` — `buildRefundEventPayload({...})` 를 부르는 두 곳에 `reasonCode` 를 넘긴다:
- `create` 성공 경로: `reasonCode: dto.reasonCode ?? null`
- 수동 확인 경로(`MANUAL_CONFIRM`): `reasonCode: refund.reasonCode ?? null` (그 함수가 읽은 refund 행 변수 이름을 그대로 쓴다)

나머지 `buildRefundEventPayload` 호출이 있으면(`grep -n "buildRefundEventPayload(" apps/wallet/src -r`) 같은 규칙으로 넘긴다.

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/wallet/src/messaging/gateway-event.builder.spec.ts apps/wallet/src/refunds`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/wallet/src/messaging/gateway-event.builder.ts apps/wallet/src/messaging/gateway-event.builder.spec.ts apps/wallet/src/refunds/refunds.service.ts packages/event-contracts/streams/payment.stream.ts
git commit -m "feat(wallet): 환불 사실에 reasonCode 를 싣는다 (#1016 35번 PR-A)"
```

---

### Task 3: almond-payment `refundPayment` — 결정적 키, wallet 환불 id 기록, 외부 환불 표식

**Files:**
- Create: `apps/medusa/src/modules/almond-payment/refund-data.ts`
- Modify: `apps/medusa/src/modules/almond-payment/service.ts` (`refundPayment`, `walletFetch` 가 헤더 덮어쓰기를 허용하는지 확인 — 지금 `...options.headers` 가 뒤에 펼쳐지므로 허용된다)
- Test: `apps/medusa/src/modules/almond-payment/__tests__/refund-data.unit.spec.ts`
- Test: `apps/medusa/src/modules/almond-payment/__tests__/refund-payment.unit.spec.ts`

**Interfaces:**
- Produces (`refund-data.ts`):
  ```ts
  export type ExternalRefundMarker = { walletRefundId: string; amount: number };
  export function readWalletRefundIds(data: Record<string, unknown> | null | undefined): string[];
  export function withWalletRefundIds(data: Record<string, unknown>, ids: string[]): Record<string, unknown>;
  export function readExternalRefund(data: Record<string, unknown> | null | undefined): ExternalRefundMarker | null;
  export function withExternalRefund(data: Record<string, unknown>, marker: ExternalRefundMarker): Record<string, unknown>;
  export function withoutExternalRefund(data: Record<string, unknown>): Record<string, unknown>;
  ```
  data 키: `walletRefundIds: string[]`, `externalRefund: { walletRefundId, amount }`

- [ ] **Step 1: 순수 함수 테스트**

```ts
// apps/medusa/src/modules/almond-payment/__tests__/refund-data.unit.spec.ts
import {
  readWalletRefundIds, withWalletRefundIds, readExternalRefund, withExternalRefund, withoutExternalRefund,
} from '../refund-data';

describe('refund-data', () => {
  it('wallet 환불 id 는 중복 없이 쌓인다', () => {
    const d = withWalletRefundIds(withWalletRefundIds({ intentId: 'i' }, ['r1']), ['r1', 'r2']);
    expect(readWalletRefundIds(d)).toEqual(['r1', 'r2']);
    expect(d.intentId).toBe('i');
  });
  it('기록이 없거나 모양이 틀리면 빈 배열', () => {
    expect(readWalletRefundIds(undefined)).toEqual([]);
    expect(readWalletRefundIds({ walletRefundIds: 'x' })).toEqual([]);
  });
  it('외부 환불 표식을 쓰고 읽고 지운다', () => {
    const d = withExternalRefund({ intentId: 'i' }, { walletRefundId: 'r9', amount: 1000 });
    expect(readExternalRefund(d)).toEqual({ walletRefundId: 'r9', amount: 1000 });
    expect(readExternalRefund(withoutExternalRefund(d))).toBeNull();
  });
  it('모양이 틀린 표식은 없는 것으로 본다', () => {
    expect(readExternalRefund({ externalRefund: { walletRefundId: 1 } })).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/medusa && npx jest --selectProjects 2>/dev/null; TEST_TYPE=unit npx jest src/modules/almond-payment/__tests__/refund-data.unit.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// apps/medusa/src/modules/almond-payment/refund-data.ts
/**
 * 결제 data 에 남기는 환불 표식 (ADR-0042 원칙 3).
 *
 * - walletRefundIds: almond-payment 가 wallet 에 낸 환불의 wallet id. 환불 사실이 돌아왔을 때 «우리가 낸 것»을 가린다.
 * - externalRefund: Medusa 밖에서 이미 끝난 wallet 환불을 장부에 넣는 중이라는 표식. 이게 있으면 refundPayment 는
 *   wallet 을 부르지 않는다 — 캡처 투영의 `captured: true` 와 같은 패턴.
 */
export type ExternalRefundMarker = { walletRefundId: string; amount: number };

export function readWalletRefundIds(data: Record<string, unknown> | null | undefined): string[] {
  const v = data?.walletRefundIds;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function withWalletRefundIds(data: Record<string, unknown>, ids: string[]): Record<string, unknown> {
  return { ...data, walletRefundIds: [...new Set([...readWalletRefundIds(data), ...ids])] };
}

export function readExternalRefund(data: Record<string, unknown> | null | undefined): ExternalRefundMarker | null {
  const v = data?.externalRefund as Partial<ExternalRefundMarker> | undefined;
  if (!v || typeof v.walletRefundId !== 'string' || typeof v.amount !== 'number') return null;
  return { walletRefundId: v.walletRefundId, amount: v.amount };
}

export function withExternalRefund(data: Record<string, unknown>, marker: ExternalRefundMarker): Record<string, unknown> {
  return { ...data, externalRefund: marker };
}

export function withoutExternalRefund(data: Record<string, unknown>): Record<string, unknown> {
  const { externalRefund: _drop, ...rest } = data;
  return rest;
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd apps/medusa && TEST_TYPE=unit npx jest src/modules/almond-payment/__tests__/refund-data.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: `refundPayment` 테스트**

```ts
// apps/medusa/src/modules/almond-payment/__tests__/refund-payment.unit.spec.ts
import AlmondPaymentProviderService from '../service';

const makeService = () => {
  const svc = new (AlmondPaymentProviderService as any)(
    { logger: console },
    { walletBaseUrl: 'http://wallet.test', walletApiKey: 'k' },
  );
  return svc as InstanceType<typeof AlmondPaymentProviderService> & { walletFetch: jest.Mock };
};

describe('almond-payment refundPayment', () => {
  it('Medusa 의 환불 id 로 결정적 Idempotency-Key 를 보내고, wallet 환불 id 를 data 에 남긴다', async () => {
    const svc = makeService();
    const spy = jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({ intentId: 'i1', refunds: [{ id: 'wr1' }] });

    const out = await svc.refundPayment({ data: { intentId: 'i1' }, amount: 3000, context: { idempotency_key: 'ref_m1' } } as any);

    expect(spy).toHaveBeenCalledWith(
      '/v1/payment-intents/i1/refund',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Idempotency-Key': 'medusa-refund:ref_m1' },
        body: JSON.stringify({ amount: 3000, reasonCode: 'MEDUSA_REFUND' }),
      }),
    );
    expect(out.data).toEqual({ intentId: 'i1', walletRefundIds: ['wr1'] });
  });

  it('외부 환불 표식이 있고 금액이 같으면 wallet 을 부르지 않고 표식을 지우며 그 id 를 기록한다', async () => {
    const svc = makeService();
    const spy = jest.spyOn(svc as any, 'walletFetch');

    const out = await svc.refundPayment({
      data: { intentId: 'i1', externalRefund: { walletRefundId: 'wr7', amount: 5000 } },
      amount: 5000,
      context: { idempotency_key: 'ref_m2' },
    } as any);

    expect(spy).not.toHaveBeenCalled();
    expect(out.data).toEqual({ intentId: 'i1', walletRefundIds: ['wr7'] });
  });

  it('표식 금액과 환불 금액이 다르면 표식을 무시하고 wallet 을 부른다(다른 환불이 끼어든 것)', async () => {
    const svc = makeService();
    const spy = jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({ refunds: [{ id: 'wr2' }] });
    await svc.refundPayment({
      data: { intentId: 'i1', externalRefund: { walletRefundId: 'wr7', amount: 5000 } },
      amount: 1000,
      context: { idempotency_key: 'ref_m3' },
    } as any);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('idempotency_key 가 없으면 지금처럼 키를 만들게 둔다', async () => {
    const svc = makeService();
    const spy = jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({ refunds: [] });
    await svc.refundPayment({ data: { intentId: 'i1' }, amount: 1000 } as any);
    expect(spy.mock.calls[0][1].headers).toBeUndefined();
  });
});
```

(생성자 시그니처는 `service.ts` 의 `constructor` 를 보고 맞춘다 — 두 번째 인자가 모듈 옵션이다. default export 가 아니면 named import 로 바꾼다.)

- [ ] **Step 6: 실패 확인**

Run: `cd apps/medusa && TEST_TYPE=unit npx jest src/modules/almond-payment/__tests__/refund-payment.unit.spec.ts`
Expected: FAIL — 헤더 없음, data 에 walletRefundIds 없음

- [ ] **Step 7: 구현** — `service.ts` 의 `refundPayment` 를 바꾼다

```ts
import { readExternalRefund, withoutExternalRefund, withWalletRefundIds } from './refund-data';

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = (input.data ?? {}) as Record<string, unknown>;
    const { intentId } = data as unknown as WalletSessionData;
    const refundAmount = Number(input.amount);

    // Medusa 밖에서 이미 끝난 wallet 환불을 장부에 넣는 중이다(payment-events 의 환불 투영) — wallet 을 다시 부르지 않는다.
    const external = readExternalRefund(data);
    if (external && external.amount === refundAmount) {
      return { data: withWalletRefundIds(withoutExternalRefund(data), [external.walletRefundId]) };
    }

    // Medusa 결제 모듈이 refund 행 id 를 idempotency_key 로 준다 — 같은 환불의 재시도가 wallet 에서 한 번으로 접힌다.
    const idempotencyKey = (input as { context?: { idempotency_key?: string } }).context?.idempotency_key;
    const res = await this.walletFetch<{ refunds?: Array<{ id?: string }> }>(`/v1/payment-intents/${intentId}/refund`, {
      method: 'POST',
      ...(idempotencyKey ? { headers: { 'Idempotency-Key': `medusa-refund:${idempotencyKey}` } } : {}),
      body: JSON.stringify({ amount: refundAmount, reasonCode: 'MEDUSA_REFUND' }),
    });
    const ids = (res?.refunds ?? []).map((r) => r.id).filter((id): id is string => typeof id === 'string');
    return { data: withWalletRefundIds(data, ids) };
  }
```

- [ ] **Step 8: 통과 확인**

Run: `cd apps/medusa && TEST_TYPE=unit npx jest src/modules/almond-payment`
Expected: PASS

- [ ] **Step 9: 커밋**

```bash
git add apps/medusa/src/modules/almond-payment
git commit -m "feat(medusa): almond-payment 환불에 결정적 키와 wallet 환불 id 기록, 외부 환불 표식 (#1016 35번 PR-A)"
```

---

### Task 4: 환불 투영 — Medusa 밖의 wallet 환불을 Medusa 장부에 (원칙 3)

**Files:**
- Create: `apps/medusa/src/api/hooks/payment-events/classify-wallet-refund.ts`
- Modify: `apps/medusa/src/api/hooks/payment-events/route.ts` (`POST` 의 환불 분기가 `refundId`·`reasonCode` 를 넘기게, `handleRefundProjection`)
- Test: `apps/medusa/src/api/hooks/payment-events/__tests__/classify-wallet-refund.unit.spec.ts`
- Test: `apps/medusa/integration-tests/http/wallet-refund-projection.spec.ts`

**Interfaces:**
- Consumes: Task 3 의 `readWalletRefundIds`, `withExternalRefund`
- Produces:
  ```ts
  export type WalletRefundDecision = 'skip_medusa_originated' | 'skip_already_recorded' | 'record_external';
  export function classifyWalletRefund(input: {
    refundId: string | undefined;
    reasonCode: string | undefined;
    knownWalletRefundIds: string[];
  }): WalletRefundDecision;
  ```
  `handleRefundProjection(scope, intentId, amount, messageId, channelOrderId, logger, refund?: { refundId?: string; reasonCode?: string })` — 마지막 인자 추가(기존 호출자 호환)

- [ ] **Step 1: 판정 테스트**

```ts
// apps/medusa/src/api/hooks/payment-events/__tests__/classify-wallet-refund.unit.spec.ts
import { classifyWalletRefund } from '../classify-wallet-refund';

describe('classifyWalletRefund', () => {
  it('reasonCode 가 MEDUSA_REFUND 면 Medusa 가 낸 환불이다', () => {
    expect(classifyWalletRefund({ refundId: 'w1', reasonCode: 'MEDUSA_REFUND', knownWalletRefundIds: [] })).toBe('skip_medusa_originated');
  });
  it('reasonCode 가 없어도 provider 가 기록한 id 면 이미 장부에 있다(배포 겹침 창)', () => {
    expect(classifyWalletRefund({ refundId: 'w1', reasonCode: undefined, knownWalletRefundIds: ['w1'] })).toBe('skip_already_recorded');
  });
  it('둘 다 아니면 외부 환불로 기록한다', () => {
    expect(classifyWalletRefund({ refundId: 'w1', reasonCode: 'CUSTOMER_CANCEL', knownWalletRefundIds: [] })).toBe('record_external');
  });
  it('refundId 가 없는 옛 사실은 기록하지 않는다 — 같은 환불을 두 번 넣을 수 있다', () => {
    expect(classifyWalletRefund({ refundId: undefined, reasonCode: undefined, knownWalletRefundIds: [] })).toBe('skip_already_recorded');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/medusa && TEST_TYPE=unit npx jest src/api/hooks/payment-events/__tests__/classify-wallet-refund.unit.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// apps/medusa/src/api/hooks/payment-events/classify-wallet-refund.ts
export type WalletRefundDecision = 'skip_medusa_originated' | 'skip_already_recorded' | 'record_external';

/**
 * wallet 환불 사실 하나를 Medusa 장부에 넣어야 하는지 (ADR-0042 원칙 3).
 * 두 신호를 다 본다 — reasonCode 는 wallet 이 실어야 오고(배포 겹침 창엔 없을 수 있다), wallet 환불 id 는
 * Medusa 의 refund 행이 provider 응답을 저장한 뒤에야 생긴다. 둘 중 하나라도 «우리 것»이면 넣지 않는다.
 */
export function classifyWalletRefund(input: {
  refundId: string | undefined;
  reasonCode: string | undefined;
  knownWalletRefundIds: string[];
}): WalletRefundDecision {
  if (input.reasonCode === 'MEDUSA_REFUND') return 'skip_medusa_originated';
  if (!input.refundId || input.knownWalletRefundIds.includes(input.refundId)) return 'skip_already_recorded';
  return 'record_external';
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd apps/medusa && TEST_TYPE=unit npx jest src/api/hooks/payment-events/__tests__/classify-wallet-refund.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: 통합 테스트 작성**

```ts
// apps/medusa/integration-tests/http/wallet-refund-projection.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { handleRefundProjection } from '../../src/api/hooks/payment-events/route';
import { FakeWallet, WALLET_BASE_URL, setupCommerce, placeOrder, loadOrder, Commerce } from './fixtures/partial-cancel-fixture';

jest.setTimeout(300 * 1000);
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';
const wallet = new FakeWallet();
const num = (v: any) => Number(v?.numeric_ ?? v?.value ?? v);
const logger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

medusaIntegrationTestRunner({
  inApp: true,
  env: { WALLET_BASE_URL, WALLET_API_KEY: 'test-wallet-key' },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let c: Commerce;
    const ctx = { api, getContainer };
    beforeAll(async () => { await wallet.start(); c = await setupCommerce(ctx); });
    afterAll(async () => wallet.stop());
    beforeEach(() => wallet.reset());

    const refundsOf = async (orderId: string) =>
      (await loadOrder(getContainer(), orderId)).payment_collections[0].payments[0].refunds.map((r: any) => num(r.amount));

    it('외부 wallet 환불은 Medusa 환불 레코드가 되고 wallet 은 다시 불리지 않는다', async () => {
      const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'C', quantity: 1 }] });
      await handleRefundProjection(getContainer(), intentId, 13000, 'msg-ext-1', orderId, logger, { refundId: 'wr-ext-1', reasonCode: 'ADMIN_REFUND' });

      expect(await refundsOf(orderId)).toEqual([13000]);
      expect(wallet.callsTo('/refund')).toBe(0);
    });

    it('같은 사실이 두 번 와도 한 번만 기록한다', async () => {
      const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'C', quantity: 1 }] });
      for (const m of ['msg-dup-1', 'msg-dup-2']) {
        await handleRefundProjection(getContainer(), intentId, 13000, m, orderId, logger, { refundId: 'wr-dup', reasonCode: 'ADMIN_REFUND' });
      }
      expect(await refundsOf(orderId)).toEqual([13000]);
    });

    it('Medusa 가 낸 환불의 사실은 기록하지 않는다 (reasonCode)', async () => {
      const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'C', quantity: 1 }] });
      await handleRefundProjection(getContainer(), intentId, 13000, 'msg-own', orderId, logger, { refundId: 'wr-own', reasonCode: 'MEDUSA_REFUND' });
      expect(await refundsOf(orderId)).toEqual([]);
    });

    it('외부 환불을 기록한 뒤 코어 취소는 wallet 환불을 다시 부르지 않는다 (35번의 이중 시도 제거)', async () => {
      const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'C', quantity: 1 }] });
      await handleRefundProjection(getContainer(), intentId, 13000, 'msg-pre', orderId, logger, { refundId: 'wr-pre', reasonCode: 'ADMIN_REFUND' });

      await api.post(`/admin/orders/${orderId}/cancel`, {}, c.adminHeaders);

      expect(wallet.callsTo('/refund')).toBe(0);
      expect((await loadOrder(getContainer(), orderId)).status).toBe('canceled');
    });
  },
});
```


- [ ] **Step 6: 실패 확인**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern wallet-refund-projection`
Expected: FAIL — 첫 테스트에서 refunds 가 `[]`(지금은 metadata 만 쓴다), 넷째 테스트에서 `/refund` 호출 1회

- [ ] **Step 7: 구현** — `route.ts`

(a) `POST` 의 환불 분기:

```ts
    } else if (REFUND_EVENT_TYPES.has(effectiveEventType)) {
      await handleRefundProjection(req.scope, intentId, amount, messageId, channelOrderId, logger, {
        refundId: typeof payload?.refundId === 'string' ? payload.refundId : undefined,
        reasonCode: typeof payload?.reasonCode === 'string' ? payload.reasonCode : undefined,
      });
```

(b) `handleRefundProjection` 시그니처에 `refund?: { refundId?: string; reasonCode?: string }` 를 더하고, **Step 1(payment metadata 기록) 바로 뒤, Step 2(order metadata) 앞**에 장부 기록을 넣는다:

```ts
import { refundPaymentWorkflow } from '@medusajs/core-flows';
import { classifyWalletRefund } from './classify-wallet-refund';
import { readWalletRefundIds, withExternalRefund } from '../../../modules/almond-payment/refund-data';

  // ── Step 1.5: Medusa 장부에 환불 레코드 (ADR-0042 원칙 3) ─────────────────
  // Medusa 밖에서 끝난 환불만 넣는다. 넣지 않으면 나중의 Medusa 취소가 「캡처 − 환불」을 전액으로 보고
  // wallet 에 환불을 다시 요청한다(#1016 35번).
  const fresh = (await paymentModule.retrievePayment(payment.id, { select: ['id', 'data'] })) as { id: string; data?: Record<string, unknown> };
  const decision = classifyWalletRefund({
    refundId: refund?.refundId,
    reasonCode: refund?.reasonCode,
    knownWalletRefundIds: readWalletRefundIds(fresh.data),
  });
  if (decision === 'record_external') {
    await paymentModule.updatePayment({
      id: payment.id,
      data: withExternalRefund(fresh.data ?? {}, { walletRefundId: refund!.refundId!, amount: refundAmount }),
    });
    await refundPaymentWorkflow(scope).run({
      input: { payment_id: payment.id, amount: refundAmount, note: `wallet:${refund!.refundId}` },
    });
    logger.info(`[payment-events] handleRefundProjection: recorded external refund payment_id=${payment.id} walletRefundId=${refund!.refundId}`);
  }
```

중간 상태 안전성은 캡처 투영과 같다: 표식을 쓴 뒤 워크플로가 실패하면 처리기가 500 → 재배달 → 같은 표식으로 다시 돈다(provider 가 금액이 같은 표식을 보고 wallet 을 건너뛴다). 성공하면 provider 가 표식을 지우고 id 를 기록하므로 다음 배달은 `skip_already_recorded`.

- [ ] **Step 8: 통과 확인**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern wallet-refund-projection`
Expected: 4 PASS. 넷째가 실패하면(취소가 여전히 `/refund` 를 부르면) Step 7 의 기록 순서를 확인한다 — 레코드가 `payment.refunds` 에 보여야 `refundCapturedPaymentsWorkflow` 가 0 을 계산한다.

- [ ] **Step 9: 기존 스펙 회귀 확인**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'deferred-approval|coupon-consume'`
Expected: PASS

- [ ] **Step 10: 커밋**

```bash
git add apps/medusa/src/api/hooks/payment-events apps/medusa/integration-tests/http/wallet-refund-projection.spec.ts apps/medusa/integration-tests/http/fixtures/partial-cancel-fixture.ts
git commit -m "feat(medusa): Medusa 밖의 wallet 환불을 Medusa 환불 레코드로 투영 (#1016 35번 PR-A, ADR-0042 원칙 3)"
```

---

### Task 5: 배송 정책 스냅샷

**Files:**
- Modify: `apps/medusa/src/modules/almond-fulfillment/service.ts` (`validateFulfillmentData`)
- Modify: `apps/medusa/src/modules/almond-fulfillment/types.ts` (`ShippingPolicySnapshot` 타입)
- Test: `apps/medusa/src/modules/almond-fulfillment/__tests__/validate-fulfillment-data.unit.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export type ShippingPolicySnapshot = { policy: ShippingFeePolicy; shippingGroupCode: string; shippingProfileId: string };
  export const POLICY_SNAPSHOT_KEY = 'policySnapshot';
  ```
  배송 방법 `data.policySnapshot` = 그 값

- [ ] **Step 1: 실패하는 테스트**

```ts
// apps/medusa/src/modules/almond-fulfillment/__tests__/validate-fulfillment-data.unit.spec.ts
import { AlmondFulfillmentProviderService } from '../service';

describe('validateFulfillmentData', () => {
  const svc = new AlmondFulfillmentProviderService({} as any);
  const optionData = {
    shippingGroupCode: 'g1',
    shippingProfileId: 'sp_1',
    policy: { type: 'conditional_free', baseFee: 3000, freeThreshold: 50000, jejuExtraFee: 3000, islandExtraFee: 5000 },
  };

  it('주문 시점 정책을 배송 방법 data 에 스냅샷으로 남긴다 — 부분취소 배송비 재계산의 근거', async () => {
    const out = await svc.validateFulfillmentData(optionData, { foo: 1 }, {} as any);
    expect(out).toEqual({ foo: 1, policySnapshot: { policy: optionData.policy, shippingGroupCode: 'g1', shippingProfileId: 'sp_1' } });
  });

  it('옵션에 정책이 없으면 지금처럼 거절한다', async () => {
    await expect(svc.validateFulfillmentData({}, {}, {} as any)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/medusa && TEST_TYPE=unit npx jest src/modules/almond-fulfillment/__tests__/validate-fulfillment-data.unit.spec.ts`
Expected: FAIL — `policySnapshot` 없음

- [ ] **Step 3: 구현**

`types.ts` 끝에:

```ts
/**
 * 주문 시점의 배송비 정책. 배송 방법 data 에 남아 카트 → 주문으로 복사된다.
 * 그룹 정책을 나중에 바꿔도 부분취소 배송비는 이 값으로 다시 계산한다(#1016 35번, 스펙 §6.1).
 */
export type ShippingPolicySnapshot = { policy: ShippingFeePolicy; shippingGroupCode: string; shippingProfileId: string };
export const POLICY_SNAPSHOT_KEY = 'policySnapshot';
```

`service.ts`:

```ts
  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const { policy, shippingGroupCode, shippingProfileId } = this.readOptionData(optionData);
    const snapshot: ShippingPolicySnapshot = { policy, shippingGroupCode, shippingProfileId };
    return { ...(data ?? {}), [POLICY_SNAPSHOT_KEY]: snapshot };
  }
```

(`ShippingPolicySnapshot`, `POLICY_SNAPSHOT_KEY` 를 `./types` 에서 import)

- [ ] **Step 4: 통과 확인**

Run: `cd apps/medusa && TEST_TYPE=unit npx jest src/modules/almond-fulfillment`
Expected: PASS

- [ ] **Step 5: 통합 확인 — 스냅샷이 주문까지 오는가**

`order-edit-characterization.spec.ts` 에 한 케이스를 더한다:

```ts
    it('배송 정책 스냅샷이 주문의 배송 방법 data 까지 복사된다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] });
      const o = await loadOrder(getContainer(), orderId);
      expect(o.shipping_methods[0].data.policySnapshot).toEqual(
        expect.objectContaining({ shippingGroupCode: 'pc-cond', shippingProfileId: c.groups.cond.shippingProfileId }),
      );
    });
```

Run: `scripts/local/run-medusa-integration.sh --testPathPattern order-edit-characterization`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/medusa/src/modules/almond-fulfillment apps/medusa/integration-tests/http/order-edit-characterization.spec.ts
git commit -m "feat(medusa): 배송 방법에 주문 시점 배송비 정책 스냅샷 (#1016 35번 PR-A)"
```

---

### Task 6: 부분취소 계산 — 순수 함수

**Files:**
- Create: `apps/medusa/src/workflows/orders/partial-cancel/amount.ts`
- Create: `apps/medusa/src/workflows/orders/partial-cancel/prorate-adjustments.ts`
- Create: `apps/medusa/src/workflows/orders/partial-cancel/plan-shipping.ts`
- Create: `apps/medusa/src/workflows/orders/partial-cancel/plan-partial-cancel.ts`
- Test: `apps/medusa/src/workflows/orders/partial-cancel/__tests__/*.unit.spec.ts` (파일마다 하나)

**Interfaces:**
- Produces:
  ```ts
  // amount.ts
  export function toNumber(v: unknown): number; // number | numeric string | BigNumber({ numeric_ } | { value }) → number, 아니면 NaN

  // prorate-adjustments.ts
  export type OrderAdjustment = { amount: number; code?: string | null; promotion_id?: string | null; description?: string | null; is_tax_inclusive?: boolean };
  export function prorateAdjustments(adjs: OrderAdjustment[], oldQty: number, newQty: number): OrderAdjustment[];
  export function cancelledAdjustmentShare(adjs: OrderAdjustment[], oldQty: number, newQty: number): number;

  // plan-partial-cancel.ts
  export type OrderLine = { id: string; quantity: number; unitPrice: number; productId: string | null; requiresShipping: boolean; adjustments: OrderAdjustment[] };
  export type CancelRequestItem = { itemId: string; quantity: number };
  export type PartialCancelPlan = {
    lines: Array<{ itemId: string; oldQty: number; newQty: number; replaceAdjustments: OrderAdjustment[] | null }>;
    itemRefundEstimate: number; // Σ (unitPrice × 취소 수량 − 취소분 할인). 배송비 차감 상한에만 쓴다
  };
  export function planPartialCancel(lines: OrderLine[], items: CancelRequestItem[]): PartialCancelPlan; // 위반 시 PartialCancelRejected throw
  export class PartialCancelRejected extends Error {}

  // plan-shipping.ts
  export type ShippingMethodView = { id: string; shippingOptionId: string | null; amount: number; snapshot: ShippingPolicySnapshot | null; isPartialCancelCharge: boolean };
  export type ShippingLineView = { itemId: string; productShippingProfileId: string | null; unitPrice: number; newQty: number; requiresShipping: boolean };
  export type PriorGroupFees = Record<string, number>; // shippingProfileId → 직전 부분취소가 남긴 그룹 요금
  export type ShippingPlan =
    | { adjustable: false; reason: 'NO_SNAPSHOT' | 'GROUP_MISMATCH' }
    | { adjustable: true; groups: Array<{ shippingProfileId: string; shippingOptionId: string; currentFee: number; newFee: number }>; charge: number; refund: number };
  export function planShipping(input: { methods: ShippingMethodView[]; lines: ShippingLineView[]; postalCode: string | null; priorGroupFees: PriorGroupFees; chargeCap: number }): ShippingPlan;
  ```

- [ ] **Step 1: `amount` + `prorate` 테스트**

```ts
// __tests__/prorate-adjustments.unit.spec.ts
import { prorateAdjustments, cancelledAdjustmentShare } from '../prorate-adjustments';
import { toNumber } from '../amount';

describe('toNumber', () => {
  it('Medusa 금액 표현을 숫자로', () => {
    expect(toNumber(3)).toBe(3);
    expect(toNumber('3')).toBe(3);
    expect(toNumber({ numeric_: 3 })).toBe(3);
    expect(toNumber({ value: '3' })).toBe(3);
    expect(Number.isNaN(toNumber(null))).toBe(true);
  });
});

describe('prorateAdjustments', () => {
  it('남은 수량 비율로 줄인다 — 원 단위 반올림(half-up)', () => {
    // 할인 2,500원, 3개 중 1개 취소 → 남길 할인 1,666.67 → 1,667
    expect(prorateAdjustments([{ amount: 2500, code: 'P' }], 3, 2)).toEqual([{ amount: 1667, code: 'P' }]);
  });
  it('.5 는 올린다', () => {
    expect(prorateAdjustments([{ amount: 1001 }], 2, 1)).toEqual([{ amount: 501 }]);
  });
  it('할인 줄이 여럿이면 줄마다 따로', () => {
    expect(prorateAdjustments([{ amount: 1000, code: 'A' }, { amount: 300, code: 'B' }], 2, 1)).toEqual([
      { amount: 500, code: 'A' }, { amount: 150, code: 'B' },
    ]);
  });
  it('취소분 할인 = 원래 − 남길 할인', () => {
    expect(cancelledAdjustmentShare([{ amount: 2500 }], 3, 2)).toBe(833);
  });
  it('newQty 가 0 이거나 oldQty 이상이면 쓰지 않는 입력이다', () => {
    expect(() => prorateAdjustments([{ amount: 1 }], 2, 0)).toThrow();
    expect(() => prorateAdjustments([{ amount: 1 }], 2, 2)).toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/medusa && TEST_TYPE=unit npx jest src/workflows/orders/partial-cancel`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// amount.ts
/** Medusa 금액은 number / string / BigNumber 로 섞여 온다. 숫자가 아니면 NaN. */
export function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v.trim() === '' ? NaN : Number(v);
  if (v && typeof v === 'object') {
    const raw = (v as { numeric_?: unknown; value?: unknown }).numeric_ ?? (v as { value?: unknown }).value;
    if (raw !== undefined) return toNumber(raw);
  }
  return NaN;
}
```

```ts
// prorate-adjustments.ts
export type OrderAdjustment = {
  amount: number;
  code?: string | null;
  promotion_id?: string | null;
  description?: string | null;
  is_tax_inclusive?: boolean;
};

const roundHalfUp = (n: number) => Math.floor(n + 0.5);

/**
 * 수량만 줄어든 줄의 할인을 구매 시점 배분대로 남은 수량에 맞춘다(스펙 D5).
 * Medusa 의 줄 할인은 «줄 전체 금액»이라, 재계산을 끄고 수량만 줄이면 할인이 남은 수량에 몰린다.
 * 줄을 통째로 빼는 경우(newQty 0)는 Medusa 가 할인도 같이 빼므로 이 함수를 부르지 않는다.
 */
export function prorateAdjustments(adjs: OrderAdjustment[], oldQty: number, newQty: number): OrderAdjustment[] {
  if (!(newQty > 0 && newQty < oldQty)) throw new Error(`prorateAdjustments: 0 < newQty(${newQty}) < oldQty(${oldQty}) 이어야 한다`);
  return adjs.map((a) => ({ ...a, amount: roundHalfUp((a.amount * newQty) / oldQty) }));
}

export function cancelledAdjustmentShare(adjs: OrderAdjustment[], oldQty: number, newQty: number): number {
  const kept = newQty === 0 ? 0 : prorateAdjustments(adjs, oldQty, newQty).reduce((s, a) => s + a.amount, 0);
  return adjs.reduce((s, a) => s + a.amount, 0) - kept;
}
```

(`cancelledAdjustmentShare` 는 newQty 0 도 받는다 — 줄 통째 제거면 할인 전부가 취소분이다. 테스트에 `expect(cancelledAdjustmentShare([{ amount: 2500 }], 3, 0)).toBe(2500)` 를 더한다.)

- [ ] **Step 4: 통과 확인** — Run 위와 같음, Expected: PASS

- [ ] **Step 5: `planPartialCancel` 테스트**

```ts
// __tests__/plan-partial-cancel.unit.spec.ts
import { planPartialCancel, PartialCancelRejected, OrderLine } from '../plan-partial-cancel';

const line = (id: string, quantity: number, unitPrice: number, adj = 0): OrderLine => ({
  id, quantity, unitPrice, productId: `p_${id}`, requiresShipping: true,
  adjustments: adj ? [{ amount: adj, code: 'P' }] : [],
});

describe('planPartialCancel', () => {
  it('수량 감소는 비례 할인 재작성, 줄 제거는 재작성 없음', () => {
    const plan = planPartialCancel([line('a', 3, 10000, 3000), line('b', 1, 5000, 500)], [
      { itemId: 'a', quantity: 1 },
      { itemId: 'b', quantity: 1 },
    ]);
    expect(plan.lines).toEqual([
      { itemId: 'a', oldQty: 3, newQty: 2, replaceAdjustments: [{ amount: 2000, code: 'P' }] },
      { itemId: 'b', oldQty: 1, newQty: 0, replaceAdjustments: null },
    ]);
    // a: 10,000 − 1,000 + b: 5,000 − 500
    expect(plan.itemRefundEstimate).toBe(13500);
  });

  it('할인 없는 줄의 수량 감소는 재작성할 것이 없다', () => {
    expect(planPartialCancel([line('a', 2, 1000)], [{ itemId: 'a', quantity: 1 }]).lines[0].replaceAdjustments).toBeNull();
  });

  it.each([
    ['없는 줄', [{ itemId: 'zz', quantity: 1 }]],
    ['0 이하 수량', [{ itemId: 'a', quantity: 0 }]],
    ['현재 수량 초과', [{ itemId: 'a', quantity: 3 }]],
    ['같은 줄 두 번', [{ itemId: 'a', quantity: 1 }, { itemId: 'a', quantity: 1 }]],
    ['빈 요청', []],
  ])('%s 는 거절한다', (_label, items) => {
    expect(() => planPartialCancel([line('a', 2, 1000)], items as any)).toThrow(PartialCancelRejected);
  });

  it('모든 줄을 0 으로 만드는 요청은 거절한다 — 전체취소 경로를 써야 한다', () => {
    expect(() => planPartialCancel([line('a', 1, 1000)], [{ itemId: 'a', quantity: 1 }])).toThrow(PartialCancelRejected);
  });
});
```

- [ ] **Step 6: 실패 확인 → 구현**

```ts
// plan-partial-cancel.ts
import { cancelledAdjustmentShare, prorateAdjustments, type OrderAdjustment } from './prorate-adjustments';

export type OrderLine = {
  id: string;
  quantity: number;
  unitPrice: number;
  productId: string | null;
  requiresShipping: boolean;
  adjustments: OrderAdjustment[];
};
export type CancelRequestItem = { itemId: string; quantity: number };
export type PartialCancelPlan = {
  lines: Array<{ itemId: string; oldQty: number; newQty: number; replaceAdjustments: OrderAdjustment[] | null }>;
  itemRefundEstimate: number;
};

/** 결과가 정해진 거절 — 라우트가 400 `not_allowed` 로 내보낸다. */
export class PartialCancelRejected extends Error {}

export function planPartialCancel(lines: OrderLine[], items: CancelRequestItem[]): PartialCancelPlan {
  if (items.length === 0) throw new PartialCancelRejected('취소할 줄이 없습니다');
  const byId = new Map(lines.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const planned: PartialCancelPlan['lines'] = [];
  let itemRefundEstimate = 0;

  for (const it of items) {
    const l = byId.get(it.itemId);
    if (!l) throw new PartialCancelRejected(`주문에 없는 줄입니다: ${it.itemId}`);
    if (seen.has(it.itemId)) throw new PartialCancelRejected(`같은 줄이 두 번 왔습니다: ${it.itemId}`);
    seen.add(it.itemId);
    if (!Number.isInteger(it.quantity) || it.quantity <= 0) throw new PartialCancelRejected(`취소 수량이 올바르지 않습니다: ${it.itemId}`);
    if (it.quantity > l.quantity) throw new PartialCancelRejected(`취소 수량이 남은 수량보다 많습니다: ${it.itemId}`);

    const newQty = l.quantity - it.quantity;
    const replaceAdjustments = newQty > 0 && l.adjustments.length > 0 ? prorateAdjustments(l.adjustments, l.quantity, newQty) : null;
    planned.push({ itemId: l.id, oldQty: l.quantity, newQty, replaceAdjustments });
    itemRefundEstimate += l.unitPrice * it.quantity - cancelledAdjustmentShare(l.adjustments, l.quantity, newQty);
  }

  const remaining = lines.reduce((s, l) => s + (planned.find((p) => p.itemId === l.id)?.newQty ?? l.quantity), 0);
  if (remaining === 0) throw new PartialCancelRejected('모든 줄이 취소됩니다 — 전체취소로 요청해야 합니다');

  return { lines: planned, itemRefundEstimate };
}
```

Run: `cd apps/medusa && TEST_TYPE=unit npx jest src/workflows/orders/partial-cancel` → PASS

- [ ] **Step 7: `planShipping` 테스트**

```ts
// __tests__/plan-shipping.unit.spec.ts
import { planShipping, ShippingMethodView, ShippingLineView } from '../plan-shipping';

const cond = { policy: { type: 'conditional_free' as const, baseFee: 3000, freeThreshold: 50000 }, shippingGroupCode: 'cond', shippingProfileId: 'sp_cond' };
const flat = { policy: { type: 'flat' as const, baseFee: 3000 }, shippingGroupCode: 'flat', shippingProfileId: 'sp_flat' };
const perq = { policy: { type: 'per_quantity' as const, baseFee: 1000 }, shippingGroupCode: 'perq', shippingProfileId: 'sp_perq' };
const m = (id: string, snapshot: any, amount: number): ShippingMethodView => ({ id, shippingOptionId: `so_${id}`, amount, snapshot, isPartialCancelCharge: false });
const l = (itemId: string, profile: string | null, unitPrice: number, newQty: number, requiresShipping = true): ShippingLineView =>
  ({ itemId, productShippingProfileId: profile, unitPrice, newQty, requiresShipping });

const base = { postalCode: '04524', priorGroupFees: {}, chargeCap: 1_000_000 };

describe('planShipping', () => {
  it('조건부 무료 그룹이 기준 아래로 내려가면 기본 배송비를 받는다', () => {
    const p = planShipping({ ...base, methods: [m('c', cond, 0)], lines: [l('a', 'sp_cond', 30000, 1), l('b', 'sp_cond', 30000, 0)] });
    expect(p).toEqual({ adjustable: true, groups: [{ shippingProfileId: 'sp_cond', shippingOptionId: 'so_c', currentFee: 0, newFee: 3000 }], charge: 3000, refund: 0 });
  });

  it('받을 배송비는 상품 환불액을 넘지 않는다', () => {
    const p = planShipping({ ...base, chargeCap: 1000, methods: [m('c', cond, 0)], lines: [l('a', 'sp_cond', 30000, 1)] });
    expect(p.adjustable && p.charge).toBe(1000);
  });

  it('그룹이 통째로 비면 그 그룹 배송비를 돌려준다', () => {
    const p = planShipping({ ...base, methods: [m('c', cond, 0), m('f', flat, 3000)], lines: [l('a', 'sp_cond', 60000, 1), l('x', 'sp_flat', 10000, 0)] });
    expect(p.adjustable && { charge: p.charge, refund: p.refund }).toEqual({ charge: 0, refund: 3000 });
  });

  it('수량당 그룹은 줄어든 수량만큼 돌려준다', () => {
    const p = planShipping({ ...base, methods: [m('q', perq, 3000)], lines: [l('d', 'sp_perq', 5000, 1)] });
    expect(p.adjustable && p.refund).toBe(2000);
  });

  it('제주 우편번호면 지역 추가비가 남는다(그룹이 비어도 0 이 아니면 그만큼만 돌려준다)', () => {
    const jeju = { ...flat, policy: { ...flat.policy, jejuExtraFee: 3000 } };
    const p = planShipping({ ...base, postalCode: '63000', methods: [m('f', jeju, 6000)], lines: [l('x', 'sp_flat', 10000, 1)] });
    expect(p.adjustable && p.refund).toBe(0);
  });

  it('직전 부분취소가 남긴 그룹 요금을 «지금 요금»으로 쓴다', () => {
    const p = planShipping({ ...base, priorGroupFees: { sp_cond: 3000 }, methods: [m('c', cond, 0)], lines: [l('a', 'sp_cond', 30000, 1)] });
    expect(p.adjustable && { charge: p.charge, refund: p.refund }).toEqual({ charge: 0, refund: 0 });
  });

  it('배송 대상이 아닌 줄은 그룹 판정에서 빠진다', () => {
    const p = planShipping({ ...base, methods: [m('c', cond, 0)], lines: [l('a', 'sp_cond', 60000, 1), l('dig', null, 1000, 0, false)] });
    expect(p.adjustable).toBe(true);
  });

  it('스냅샷 없는 배송 방법이 있으면 조정하지 않는다', () => {
    expect(planShipping({ ...base, methods: [m('c', null, 0)], lines: [l('a', 'sp_cond', 30000, 1)] })).toEqual({ adjustable: false, reason: 'NO_SNAPSHOT' });
  });

  it('줄의 배송 프로필이 스냅샷 중 어디에도 맞지 않으면 조정하지 않는다', () => {
    expect(planShipping({ ...base, methods: [m('c', cond, 0)], lines: [l('a', 'sp_moved', 30000, 1)] })).toEqual({ adjustable: false, reason: 'GROUP_MISMATCH' });
  });

  it('직전 부분취소가 더한 «부분취소 배송비» 방법은 그룹 판정에서 빼고 본다', () => {
    const extra: ShippingMethodView = { id: 'x', shippingOptionId: 'so_c', amount: 3000, snapshot: null, isPartialCancelCharge: true };
    const p = planShipping({ ...base, priorGroupFees: { sp_cond: 3000 }, methods: [m('c', cond, 0), extra], lines: [l('a', 'sp_cond', 30000, 1)] });
    expect(p.adjustable).toBe(true);
  });
});
```

- [ ] **Step 8: 실패 확인 → 구현**

```ts
// plan-shipping.ts
import { calculateShippingFee } from '../../../modules/almond-fulfillment/calculate-shipping-fee';
import type { ShippingPolicySnapshot } from '../../../modules/almond-fulfillment/types';

export type ShippingMethodView = {
  id: string;
  shippingOptionId: string | null;
  amount: number;
  snapshot: ShippingPolicySnapshot | null;
  /** 이전 부분취소가 더한 «부분취소 배송비» 방법. 그룹의 원래 방법이 아니다. */
  isPartialCancelCharge: boolean;
};
export type ShippingLineView = {
  itemId: string;
  productShippingProfileId: string | null;
  unitPrice: number;
  newQty: number;
  requiresShipping: boolean;
};
export type PriorGroupFees = Record<string, number>;
export type ShippingPlan =
  | { adjustable: false; reason: 'NO_SNAPSHOT' | 'GROUP_MISMATCH' }
  | {
      adjustable: true;
      groups: Array<{ shippingProfileId: string; shippingOptionId: string; currentFee: number; newFee: number }>;
      charge: number;
      refund: number;
    };

/**
 * 부분취소 뒤 배송비를 주문 시점 정책으로 다시 계산한다(스펙 D6·D7, §6.1).
 * 그룹 소속은 «지금» 상품의 배송 프로필로 정하고, 모든 배송 대상 줄이 스냅샷 하나에 정확히 맞을 때만 조정한다.
 * 그룹의 «지금 요금»은 직전 부분취소가 남긴 값(priorGroupFees)이 있으면 그것, 없으면 원래 배송 방법 금액이다.
 */
export function planShipping(input: {
  methods: ShippingMethodView[];
  lines: ShippingLineView[];
  postalCode: string | null;
  priorGroupFees: PriorGroupFees;
  chargeCap: number;
}): ShippingPlan {
  const originals = input.methods.filter((m) => !m.isPartialCancelCharge);
  if (originals.some((m) => !m.snapshot || !m.shippingOptionId)) return { adjustable: false, reason: 'NO_SNAPSHOT' };

  const byProfile = new Map(originals.map((m) => [m.snapshot!.shippingProfileId, m]));
  const shipLines = input.lines.filter((l) => l.requiresShipping);
  if (shipLines.some((l) => !l.productShippingProfileId || !byProfile.has(l.productShippingProfileId))) {
    return { adjustable: false, reason: 'GROUP_MISMATCH' };
  }

  const groups = originals.map((m) => {
    const profileId = m.snapshot!.shippingProfileId;
    const remaining = shipLines
      .filter((l) => l.productShippingProfileId === profileId && l.newQty > 0)
      .map((l) => ({ subtotal: l.unitPrice * l.newQty, quantity: l.newQty }));
    const currentFee = input.priorGroupFees[profileId] ?? m.amount;
    const newFee = remaining.length === 0 ? 0 : calculateShippingFee(m.snapshot!.policy, remaining, input.postalCode);
    return { shippingProfileId: profileId, shippingOptionId: m.shippingOptionId!, currentFee, newFee };
  });

  const up = groups.reduce((s, g) => s + Math.max(0, g.newFee - g.currentFee), 0);
  const down = groups.reduce((s, g) => s + Math.max(0, g.currentFee - g.newFee), 0);
  return { adjustable: true, groups, charge: Math.min(up, Math.max(0, input.chargeCap)), refund: down };
}
```

주의: 제주 케이스 — 그룹이 통째로 비면 `newFee = 0` 이라 지역 추가비까지 돌려준다. 테스트의 제주 케이스는 «줄이 남아 있는» 경우라 `calculateShippingFee` 가 6,000 을 낸다(refund 0). 그룹이 통째로 비면 지역 추가비도 돌려주는 게 맞다(그 그룹 상자가 안 나간다).

Run: `cd apps/medusa && TEST_TYPE=unit npx jest src/workflows/orders/partial-cancel` → PASS

- [ ] **Step 9: 커밋**

```bash
git add apps/medusa/src/workflows/orders/partial-cancel
git commit -m "feat(medusa): 부분취소 계산 — 할인 비례·배송비 재계산·요청 검증 순수 함수 (#1016 35번 PR-A)"
```

---

### Task 7: 부분취소 오케스트레이터

**Files:**
- Create: `apps/medusa/src/workflows/orders/partial-cancel/partial-cancel-order.ts`
- Test: `apps/medusa/integration-tests/http/partial-cancel.spec.ts`

**Interfaces:**
- Consumes: Task 6 전부, Task 3 (환불이 almond-payment 를 탄다)
- Produces:
  ```ts
  export type PartialCancelInput = { orderId: string; requestId: string; items: CancelRequestItem[]; actorId?: string };
  export type PartialCancelRecord = {
    requestHash: string;
    stage: 'edited' | 'refunded';
    items: CancelRequestItem[];
    refundAmount: number;      // 이번에 환불할(한) 총액
    shippingCharge: number;
    shippingRefund: number;
    shippingNotAdjusted: boolean;
    groupFees: Record<string, number>; // 이 부분취소 뒤 그룹 요금 — 다음 부분취소의 priorGroupFees
    at: string;
  };
  export type PartialCancelResult = { requestId: string; refundAmount: number; shippingDelta: number; shippingNotAdjusted: boolean; stage: 'refunded' };
  export class PartialCancelRefundPending extends Error { constructor(readonly requestId: string, message: string) }
  export async function partialCancelOrder(container: MedusaContainer, input: PartialCancelInput): Promise<PartialCancelResult>;
  export const PARTIAL_CANCEL_CHARGE_NAME = '부분취소 배송비';
  ```
  주문 `metadata.partialCancels: Record<requestId, PartialCancelRecord>`

- [ ] **Step 1: 통합 테스트 작성**

```ts
// apps/medusa/integration-tests/http/partial-cancel.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import {
  partialCancelOrder, PartialCancelRefundPending,
} from '../../src/workflows/orders/partial-cancel/partial-cancel-order';
import { PartialCancelRejected } from '../../src/workflows/orders/partial-cancel/plan-partial-cancel';
import {
  FakeWallet, WALLET_BASE_URL, setupCommerce, placeOrder, createOrderFixedPromo, loadOrder, Commerce,
} from './fixtures/partial-cancel-fixture';

jest.setTimeout(300 * 1000);
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';
const wallet = new FakeWallet();
const num = (v: any) => Number(v?.numeric_ ?? v?.value ?? v);

medusaIntegrationTestRunner({
  inApp: true,
  env: { WALLET_BASE_URL, WALLET_API_KEY: 'test-wallet-key' },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let c: Commerce;
    const ctx = { api, getContainer };
    beforeAll(async () => {
      await wallet.start();
      c = await setupCommerce(ctx);
      await createOrderFixedPromo(ctx, c, 'PC6000', 6000);
    });
    afterAll(async () => wallet.stop());
    beforeEach(() => wallet.reset());

    const itemOf = (o: any, unitPrice: number) => o.items.find((i: any) => num(i.unit_price) === unitPrice);
    const balance = (o: any) => num(o.summary.pending_difference);

    it('줄 제거 + 조건부 무료 미달: 상품값 − 할인분 − 배송비를 한 번 환불하고 장부가 0 이 된다', async () => {
      // A 30,000 + B 30,000 (cond, 60,000 ≥ 50,000 → 무료), 할인 6,000 across → 줄마다 3,000
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }, { variant: 'B', quantity: 1 }], promoCode: 'PC6000' });
      const o = await loadOrder(getContainer(), orderId);
      const b = o.items.find((i: any) => i.product_id !== itemOf(o, 30000).product_id) ?? o.items[1];

      const res = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-1', items: [{ itemId: b.id, quantity: 1 }] });

      // 30,000 − 3,000(B 의 할인) − 3,000(남은 A 가 기준 미달)
      expect(res.refundAmount).toBe(24000);
      expect(res.shippingDelta).toBe(3000);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([24000]);
      const after = await loadOrder(getContainer(), orderId);
      expect(balance(after)).toBe(0);
      expect(after.metadata.partialCancels['req-1'].stage).toBe('refunded');
    });

    it('수량 감소: 할인을 비례로 다시 쓴다', async () => {
      // A × 3 = 90,000, 할인 6,000 전부 A 줄. 1개 취소 → 남길 할인 4,000, 취소분 2,000. 남은 60,000 ≥ 50,000 → 배송비 변화 없음
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }], promoCode: 'PC6000' });
      const o = await loadOrder(getContainer(), orderId);

      const res = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-2', items: [{ itemId: o.items[0].id, quantity: 1 }] });

      expect(res.refundAmount).toBe(28000);
      const after = await loadOrder(getContainer(), orderId);
      expect(after.items[0].adjustments.reduce((s: number, a: any) => s + num(a.amount), 0)).toBe(4000);
      expect(balance(after)).toBe(0);
    });

    it('그룹이 통째로 비면 그 그룹 배송비를 함께 돌려주고, 그 몫은 크레딧 라인으로 장부를 맞춘다', async () => {
      // A 60,000 이상 위해 A × 2(cond 무료) + C 10,000(flat 3,000)
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }, { variant: 'C', quantity: 1 }] });
      const o = await loadOrder(getContainer(), orderId);

      const res = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-3', items: [{ itemId: itemOf(o, 10000).id, quantity: 1 }] });

      expect(res.refundAmount).toBe(13000);
      expect(res.shippingDelta).toBe(-3000);
      const after = await loadOrder(getContainer(), orderId);
      expect(balance(after)).toBe(0);
      expect(after.credit_lines.reduce((s: number, l: any) => s + num(l.amount), 0)).toBe(3000);
    });

    it('같은 requestId 로 다시 부르면 아무것도 다시 하지 않고 같은 결과를 돌려준다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
      const o = await loadOrder(getContainer(), orderId);
      const input = { orderId, requestId: 'req-4', items: [{ itemId: o.items[0].id, quantity: 1 }] };

      const first = await partialCancelOrder(getContainer(), input);
      const second = await partialCancelOrder(getContainer(), input);

      expect(second).toEqual(first);
      expect(wallet.refunds).toHaveLength(1);
    });

    it('같은 requestId 인데 내용이 다르면 거절한다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
      const o = await loadOrder(getContainer(), orderId);
      await partialCancelOrder(getContainer(), { orderId, requestId: 'req-5', items: [{ itemId: o.items[0].id, quantity: 1 }] });

      await expect(
        partialCancelOrder(getContainer(), { orderId, requestId: 'req-5', items: [{ itemId: o.items[0].id, quantity: 2 }] }),
      ).rejects.toThrow(PartialCancelRejected);
    });

    it('환불이 한 번 실패하면 refund_pending 으로 멈추고, 다시 부르면 환불 단계부터 이어 간다(주문 수정은 한 번)', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
      const o = await loadOrder(getContainer(), orderId);
      const input = { orderId, requestId: 'req-6', items: [{ itemId: o.items[0].id, quantity: 1 }] };
      wallet.failNextRefund = true;

      await expect(partialCancelOrder(getContainer(), input)).rejects.toThrow(PartialCancelRefundPending);
      const mid = await loadOrder(getContainer(), orderId);
      expect(mid.metadata.partialCancels['req-6'].stage).toBe('edited');
      const versionAfterEdit = mid.version;

      const res = await partialCancelOrder(getContainer(), input);
      expect(res.refundAmount).toBe(30000);
      const after = await loadOrder(getContainer(), orderId);
      expect(after.version).toBe(versionAfterEdit);
      expect(balance(after)).toBe(0);
    });

    it('같은 주문 두 번째 부분취소는 첫 번째가 남긴 그룹 요금에서 계산한다', async () => {
      // A × 2 (60,000 무료) → A 1개 취소(30,000 → 기준 미달, 3,000 차감) → 남은 A 1개 취소는 전체취소라 거절, 대신 D 를 섞는다
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }, { variant: 'D', quantity: 2 }] });
      const o = await loadOrder(getContainer(), orderId);
      const a = itemOf(o, 30000);
      const d = itemOf(o, 5000);

      const first = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-7a', items: [{ itemId: a.id, quantity: 1 }] });
      expect(first.shippingDelta).toBe(3000);
      const second = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-7b', items: [{ itemId: d.id, quantity: 1 }] });
      // cond 그룹은 그대로(이미 3,000), perq 는 2,000 → 1,000
      expect(second.shippingDelta).toBe(-1000);
      expect(balance(await loadOrder(getContainer(), orderId))).toBe(0);
    });

    it('스냅샷 없는 주문은 배송비를 건드리지 않고 표시한다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }, { variant: 'C', quantity: 1 }] });
      // 배포 전 주문을 흉내: 배송 방법 data 에서 스냅샷을 지운다
      const orderModule: any = getContainer().resolve('order');
      const o = await loadOrder(getContainer(), orderId);
      await orderModule.updateOrderShippingMethods(o.shipping_methods.map((m: any) => ({ id: m.id, data: {} })));

      const res = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-8', items: [{ itemId: itemOf(o, 10000).id, quantity: 1 }] });
      expect(res.shippingNotAdjusted).toBe(true);
      expect(res.refundAmount).toBe(10000);
    });

    it('검증 거절은 주문을 건드리지 않는다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] });
      const o = await loadOrder(getContainer(), orderId);
      await expect(
        partialCancelOrder(getContainer(), { orderId, requestId: 'req-9', items: [{ itemId: o.items[0].id, quantity: 1 }] }),
      ).rejects.toThrow(PartialCancelRejected);
      expect((await loadOrder(getContainer(), orderId)).version).toBe(o.version);
    });
  },
});
```

(`updateOrderShippingMethods` 이름은 Medusa Order 모듈 서비스에서 확인한다: `grep -n "updateOrderShippingMethods\|updateShippingMethods" apps/medusa/node_modules/@medusajs/order/dist/services/order-module-service.d.ts`. 없으면 같은 일을 하는 메서드로 바꾼다. 모듈 키는 `Modules.ORDER`.)

- [ ] **Step 2: 실패 확인**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern partial-cancel.spec`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// apps/medusa/src/workflows/orders/partial-cancel/partial-cancel-order.ts
import { createHash } from 'crypto';
import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import {
  beginOrderEditOrderWorkflow,
  cancelBeginOrderEditWorkflow,
  confirmOrderEditRequestWorkflow,
  createOrderChangeActionsWorkflow,
  createOrderEditShippingMethodWorkflow,
  orderEditUpdateItemQuantityWorkflow,
  refundPaymentWorkflow,
  requestOrderEditRequestWorkflow,
} from '@medusajs/medusa/core-flows';
import { ChangeActionType, OrderChangeStatus } from '@medusajs/framework/utils';

import { POLICY_SNAPSHOT_KEY, type ShippingPolicySnapshot } from '../../../modules/almond-fulfillment/types';
import { toNumber } from './amount';
import { planPartialCancel, PartialCancelRejected, type CancelRequestItem, type OrderLine } from './plan-partial-cancel';
import { planShipping, type ShippingMethodView } from './plan-shipping';

export const PARTIAL_CANCEL_CHARGE_NAME = '부분취소 배송비';

export type PartialCancelInput = { orderId: string; requestId: string; items: CancelRequestItem[]; actorId?: string };
export type PartialCancelRecord = {
  requestHash: string;
  stage: 'edited' | 'refunded';
  items: CancelRequestItem[];
  refundAmount: number;
  shippingCharge: number;
  shippingRefund: number;
  shippingNotAdjusted: boolean;
  groupFees: Record<string, number>;
  at: string;
};
export type PartialCancelResult = {
  requestId: string;
  refundAmount: number;
  shippingDelta: number;
  shippingNotAdjusted: boolean;
  stage: 'refunded';
};

/** 주문 수정은 확정됐는데 환불을 끝내지 못했다. 같은 requestId 로 다시 부르면 환불부터 이어 간다. */
export class PartialCancelRefundPending extends Error {
  constructor(readonly requestId: string, message: string) {
    super(message);
  }
}

const hashItems = (items: CancelRequestItem[]) =>
  createHash('sha256')
    .update(JSON.stringify([...items].sort((a, b) => a.itemId.localeCompare(b.itemId))))
    .digest('hex');

const toResult = (requestId: string, r: PartialCancelRecord): PartialCancelResult => ({
  requestId,
  refundAmount: r.refundAmount,
  shippingDelta: r.shippingCharge - r.shippingRefund,
  shippingNotAdjusted: r.shippingNotAdjusted,
  stage: 'refunded',
});

/**
 * 채널 주문 부분취소 (#1016 35번, 스펙 §6.2, ADR-0042).
 *
 * Medusa 공식 워크플로를 차례로 부른다: 주문 수정(수량 감소 · 할인 비례 재작성 · 필요하면 «부분취소 배송비») → 확정 →
 * refundPaymentWorkflow 한 번. 배송비 환불 몫은 refundPaymentWorkflow 가 «돌려줄 차액»을 넘는 환불분에 크레딧 라인을
 * 스스로 붙여 장부를 맞춘다. 진행 단계는 주문 metadata.partialCancels[requestId] 에 남아, 같은 requestId 로 다시 부르면
 * 끊긴 곳부터 이어 간다.
 */
export async function partialCancelOrder(container: MedusaContainer, input: PartialCancelInput): Promise<PartialCancelResult> {
  const locking = container.resolve(Modules.LOCKING);
  return locking.execute(`partial-cancel:${input.orderId}`, () => run(container, input), { timeout: 30 });
}

async function run(container: MedusaContainer, input: PartialCancelInput): Promise<PartialCancelResult> {
  const requestHash = hashItems(input.items);
  let order = await loadOrder(container, input.orderId);
  const existing = readRecords(order.metadata)[input.requestId];
  if (existing && existing.requestHash !== requestHash) {
    throw new PartialCancelRejected(`같은 requestId 로 다른 요청이 왔습니다: ${input.requestId}`);
  }
  if (existing?.stage === 'refunded') return toResult(input.requestId, existing);

  let record = existing ?? (await edit(container, input, order, requestHash));
  order = await loadOrder(container, input.orderId);

  try {
    await refund(container, order, record.refundAmount, input.actorId);
  } catch (error) {
    throw new PartialCancelRefundPending(input.requestId, error instanceof Error ? error.message : String(error));
  }
  record = { ...record, stage: 'refunded', at: new Date().toISOString() };
  await writeRecord(container, input.orderId, input.requestId, record);
  return toResult(input.requestId, record);
}

async function edit(container: MedusaContainer, input: PartialCancelInput, order: any, requestHash: string): Promise<PartialCancelRecord> {
  if (order.status === 'canceled') throw new PartialCancelRejected('이미 취소된 주문입니다');

  const lines: OrderLine[] = order.items.map((i: any) => ({
    id: i.id,
    quantity: toNumber(i.quantity),
    unitPrice: toNumber(i.unit_price),
    productId: i.product_id ?? null,
    requiresShipping: i.requires_shipping !== false,
    adjustments: (i.adjustments ?? []).map((a: any) => ({
      amount: toNumber(a.amount),
      code: a.code ?? null,
      promotion_id: a.promotion_id ?? null,
      description: a.description ?? null,
      is_tax_inclusive: !!a.is_tax_inclusive,
    })),
  }));
  const plan = planPartialCancel(lines, input.items);

  const profiles = await productShippingProfiles(container, lines.map((l) => l.productId).filter((x): x is string => !!x));
  const newQty = new Map(plan.lines.map((p) => [p.itemId, p.newQty]));
  const methods: ShippingMethodView[] = (order.shipping_methods ?? []).map((m: any) => ({
    id: m.id,
    shippingOptionId: m.shipping_option_id ?? null,
    amount: toNumber(m.amount),
    snapshot: (m.data?.[POLICY_SNAPSHOT_KEY] as ShippingPolicySnapshot | undefined) ?? null,
    isPartialCancelCharge: m.name === PARTIAL_CANCEL_CHARGE_NAME,
  }));
  const priorGroupFees = Object.values(readRecords(order.metadata))
    .sort((a, b) => a.at.localeCompare(b.at))
    .reduce<Record<string, number>>((acc, r) => ({ ...acc, ...r.groupFees }), {});
  const shipping = planShipping({
    methods,
    lines: lines.map((l) => ({
      itemId: l.id,
      productShippingProfileId: l.productId ? profiles.get(l.productId) ?? null : null,
      unitPrice: l.unitPrice,
      newQty: newQty.get(l.id) ?? l.quantity,
      requiresShipping: l.requiresShipping,
    })),
    postalCode: order.shipping_address?.postal_code ?? null,
    priorGroupFees,
    chargeCap: plan.itemRefundEstimate,
  });

  await beginOrderEditOrderWorkflow(container).run({
    input: { order_id: order.id, created_by: input.actorId, internal_note: `partial-cancel:${input.requestId}` },
  });
  try {
    await orderEditUpdateItemQuantityWorkflow(container).run({
      input: { order_id: order.id, items: plan.lines.map((p) => ({ id: p.itemId, quantity: p.newQty })) },
    });

    const toReplace = plan.lines.filter((p) => p.replaceAdjustments);
    if (toReplace.length > 0) {
      const change = await activeOrderChange(container, order.id);
      await createOrderChangeActionsWorkflow(container).run({
        input: toReplace.map((p) => ({
          order_change_id: change.id,
          order_id: order.id,
          version: change.version,
          action: ChangeActionType.ITEM_ADJUSTMENTS_REPLACE,
          details: { reference_id: p.itemId, adjustments: p.replaceAdjustments },
        })),
      });
    }

    if (shipping.adjustable && shipping.charge > 0) {
      const target = shipping.groups.find((g) => g.newFee > g.currentFee)!;
      await createOrderEditShippingMethodWorkflow(container).run({
        input: { order_id: order.id, shipping_option_id: target.shippingOptionId, custom_amount: shipping.charge },
      });
      // 이름으로 «부분취소 배송비»를 표시한다 — 다음 부분취소의 그룹 판정에서 이 방법을 뺀다
      await renameLastShippingMethod(container, order.id, target.shippingOptionId, PARTIAL_CANCEL_CHARGE_NAME);
    }

    await requestOrderEditRequestWorkflow(container).run({ input: { order_id: order.id, requested_by: input.actorId } });
    await confirmOrderEditRequestWorkflow(container).run({ input: { order_id: order.id, confirmed_by: input.actorId } });
  } catch (error) {
    // 확정 전 실패 — 열린 주문 수정을 버려 주문을 원래대로 둔다
    await cancelBeginOrderEditWorkflow(container).run({ input: { order_id: order.id } }).catch(() => undefined);
    throw error;
  }

  const edited = await loadOrder(container, order.id);
  const owed = Math.max(0, -toNumber(edited.summary?.pending_difference ?? 0));
  const record: PartialCancelRecord = {
    requestHash,
    stage: 'edited',
    items: input.items,
    refundAmount: owed + (shipping.adjustable ? shipping.refund : 0),
    shippingCharge: shipping.adjustable ? shipping.charge : 0,
    shippingRefund: shipping.adjustable ? shipping.refund : 0,
    shippingNotAdjusted: !shipping.adjustable,
    groupFees: shipping.adjustable ? Object.fromEntries(shipping.groups.map((g) => [g.shippingProfileId, g.newFee])) : {},
    at: new Date().toISOString(),
  };
  await writeRecord(container, order.id, input.requestId, record);
  return record;
}

/** 캡처된 결제들에서 차례로 환불한다. 결제마다 «캡처 − 환불» 남은 만큼만. */
async function refund(container: MedusaContainer, order: any, amount: number, actorId?: string) {
  let left = amount;
  const payments = (order.payment_collections ?? []).flatMap((pc: any) => pc.payments ?? []);
  for (const p of payments) {
    if (left <= 0) break;
    const captured = (p.captures ?? []).reduce((s: number, x: any) => s + toNumber(x.amount), 0);
    const refunded = (p.refunds ?? []).reduce((s: number, x: any) => s + toNumber(x.amount), 0);
    const room = captured - refunded;
    if (room <= 0) continue;
    const take = Math.min(room, left);
    await refundPaymentWorkflow(container).run({ input: { payment_id: p.id, amount: take, created_by: actorId } });
    left -= take;
  }
  if (left > 0) throw new Error(`환불할 캡처 잔액이 부족합니다: 남은 ${left}`);
}
```

이어 같은 파일에 조회·기록 도우미:

```ts
async function loadOrder(container: MedusaContainer, orderId: string): Promise<any> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'order',
    fields: [
      'id', 'status', 'version', 'metadata', 'summary.*',
      'items.id', 'items.quantity', 'items.unit_price', 'items.product_id', 'items.requires_shipping', 'items.adjustments.*',
      'shipping_methods.id', 'shipping_methods.name', 'shipping_methods.amount', 'shipping_methods.shipping_option_id', 'shipping_methods.data',
      'shipping_address.postal_code',
      'payment_collections.payments.id', 'payment_collections.payments.captures.amount', 'payment_collections.payments.refunds.amount',
    ],
    filters: { id: orderId },
  });
  if (!data[0]) throw new PartialCancelRejected(`주문을 찾을 수 없습니다: ${orderId}`);
  return data[0];
}

function readRecords(metadata: unknown): Record<string, PartialCancelRecord> {
  const v = (metadata as Record<string, unknown> | null)?.partialCancels;
  return v && typeof v === 'object' ? (v as Record<string, PartialCancelRecord>) : {};
}

async function writeRecord(container: MedusaContainer, orderId: string, requestId: string, record: PartialCancelRecord) {
  const orderModule = container.resolve(Modules.ORDER);
  const current = await orderModule.retrieveOrder(orderId, { select: ['id', 'metadata'] });
  const meta = (current.metadata ?? {}) as Record<string, unknown>;
  await orderModule.updateOrders([
    { id: orderId, metadata: { ...meta, partialCancels: { ...readRecords(meta), [requestId]: record } } },
  ]);
}

async function productShippingProfiles(container: MedusaContainer, productIds: string[]) {
  const map = new Map<string, string>();
  if (productIds.length === 0) return map;
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({ entity: 'product', fields: ['id', 'shipping_profile.id'], filters: { id: productIds } });
  for (const p of data as any[]) if (p.shipping_profile?.id) map.set(p.id, p.shipping_profile.id);
  return map;
}

async function activeOrderChange(container: MedusaContainer, orderId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'order_change',
    fields: ['id', 'version'],
    filters: { order_id: orderId, status: [OrderChangeStatus.PENDING, OrderChangeStatus.REQUESTED] },
  });
  if (!data[0]) throw new Error(`열린 주문 수정이 없습니다: ${orderId}`);
  return data[0] as { id: string; version: number };
}

/** createOrderEditShippingMethodWorkflow 는 이름을 받지 않는다 — 방금 더한 방법의 이름을 바꾼다. */
async function renameLastShippingMethod(container: MedusaContainer, orderId: string, optionId: string, name: string) {
  const orderModule: any = container.resolve(Modules.ORDER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'order_change',
    fields: ['id', 'actions.action', 'actions.reference_id'],
    filters: { order_id: orderId, status: [OrderChangeStatus.PENDING] },
  });
  const added = ((data[0] as any)?.actions ?? []).filter((a: any) => a.action === ChangeActionType.SHIPPING_ADD).map((a: any) => a.reference_id);
  const id = added[added.length - 1];
  if (id) await orderModule.updateOrderShippingMethods([{ id, name }]);
}
```

구현 메모:
- `renameLastShippingMethod` 의 `updateOrderShippingMethods` 이름은 Step 1 의 메모처럼 Order 모듈 `.d.ts` 로 확인한다. `optionId` 인자는 쓰이지 않으면 지운다.
- `Modules.LOCKING` 의 `execute` 는 Medusa 기본 locking provider 로 돈다(`medusa-config.js` 에 `locking-redis` 가 있다).
- `OrderChangeStatus`·`ChangeActionType` 이 `@medusajs/framework/utils` 에서 export 되는지 확인한다(`grep -n "OrderChangeStatus\|ChangeActionType" apps/medusa/node_modules/@medusajs/utils/dist/order/index.d.ts`).

- [ ] **Step 4: 통과 확인**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern partial-cancel.spec`
Expected: 9 PASS. 금액이 어긋나면 먼저 `order.summary` 를 찍어 «돌려줄 차액»이 기대와 같은지 본다 — 다르면 Task 1 의 특성과 실제가 갈린 것이니 멈추고 보고한다.

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/workflows/orders/partial-cancel/partial-cancel-order.ts apps/medusa/integration-tests/http/partial-cancel.spec.ts
git commit -m "feat(medusa): 부분취소 오케스트레이터 — 주문 수정 + 환불 한 번, 단계 이어 가기 (#1016 35번 PR-A)"
```

---

### Task 8: 부분취소 라우트

**Files:**
- Create: `apps/medusa/src/api/admin/orders/[id]/partial-cancel/parse-input.ts`
- Create: `apps/medusa/src/api/admin/orders/[id]/partial-cancel/route.ts`
- Test: `apps/medusa/src/api/admin/orders/[id]/partial-cancel/__tests__/parse-input.unit.spec.ts`
- Test: `apps/medusa/integration-tests/http/partial-cancel.spec.ts` (라우트 케이스 추가)

**Interfaces:**
- Consumes: Task 7 `partialCancelOrder`, `PartialCancelRefundPending`, `PartialCancelRejected`
- Produces: HTTP 계약 (Global Constraints 그대로)
  - 200 `{ requestId, refundAmount, shippingDelta, shippingNotAdjusted, stage: 'refunded' }`
  - 400 `{ type: 'not_allowed', message }`
  - 502 `{ type: 'refund_pending', stage: 'edited', requestId, message }`
  - `parseInput(body: unknown): { requestId: string; items: Array<{ itemId: string; quantity: number }> }` — 위반은 `MedusaError(INVALID_DATA)`

- [ ] **Step 1: 파서 테스트**

```ts
// __tests__/parse-input.unit.spec.ts
import { parseInput } from '../parse-input';

describe('partial-cancel parseInput', () => {
  it('item_id/quantity 를 itemId/quantity 로', () => {
    expect(parseInput({ requestId: 'r1', items: [{ item_id: 'i1', quantity: 2 }] })).toEqual({ requestId: 'r1', items: [{ itemId: 'i1', quantity: 2 }] });
  });
  it.each([
    [{}],
    [{ requestId: '', items: [{ item_id: 'i', quantity: 1 }] }],
    [{ requestId: 'r', items: [] }],
    [{ requestId: 'r', items: [{ item_id: 'i', quantity: 1.5 }] }],
    [{ requestId: 'r', items: [{ item_id: 'i', quantity: '1' }] }],
  ])('거절: %j', (body) => {
    expect(() => parseInput(body)).toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현**

```ts
// parse-input.ts
import { MedusaError } from '@medusajs/framework/utils';

export type PartialCancelBody = { requestId: string; items: Array<{ itemId: string; quantity: number }> };

export function parseInput(body: unknown): PartialCancelBody {
  const b = (body ?? {}) as { requestId?: unknown; items?: unknown };
  if (typeof b.requestId !== 'string' || b.requestId.trim() === '') {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'requestId 가 필요합니다');
  }
  if (!Array.isArray(b.items) || b.items.length === 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'items 가 비어 있습니다');
  }
  const items = b.items.map((raw, i) => {
    const it = (raw ?? {}) as { item_id?: unknown; quantity?: unknown };
    if (typeof it.item_id !== 'string' || it.item_id === '' || typeof it.quantity !== 'number' || !Number.isInteger(it.quantity) || it.quantity <= 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `items[${i}] 가 올바르지 않습니다`);
    }
    return { itemId: it.item_id, quantity: it.quantity };
  });
  return { requestId: b.requestId.trim(), items };
}
```

Run: `cd apps/medusa && TEST_TYPE=unit npx jest "src/api/admin/orders"` → PASS

- [ ] **Step 3: 라우트**

```ts
// route.ts
import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { partialCancelOrder, PartialCancelRefundPending } from '../../../../../workflows/orders/partial-cancel/partial-cancel-order';
import { PartialCancelRejected } from '../../../../../workflows/orders/partial-cancel/plan-partial-cancel';
import { parseInput } from './parse-input';

/**
 * 채널 주문 부분취소 (#1016 35번, ADR-0042). channel-adapter 가 core 의 CancelChannelOrder 명령을 받아 부른다.
 * 응답 계약은 channel-adapter 가 읽는다 — 400 not_allowed = 정해진 거절, 502 refund_pending = 수정은 됐고 환불이 남음(재시도).
 * POST /admin/orders/:id/partial-cancel
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { requestId, items } = parseInput(req.body);
  try {
    const result = await partialCancelOrder(req.scope, {
      orderId: req.params.id,
      requestId,
      items,
      actorId: req.auth_context?.actor_id,
    });
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof PartialCancelRejected) {
      res.status(400).json({ type: 'not_allowed', message: error.message });
      return;
    }
    if (error instanceof PartialCancelRefundPending) {
      res.status(502).json({ type: 'refund_pending', stage: 'edited', requestId: error.requestId, message: error.message });
      return;
    }
    throw error;
  }
};
```

(인증은 `src/api/admin/middlewares.ts` 의 `/admin/*` POST 규칙이 이미 건다.)

- [ ] **Step 4: 라우트 통합 테스트 추가** — `partial-cancel.spec.ts` 의 `describe` 에

```ts
    it('라우트: 성공 200, 거절 400 not_allowed, 환불 실패 502 refund_pending', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
      const o = await loadOrder(getContainer(), orderId);
      const item = o.items[0].id;

      const bad = await api.post(`/admin/orders/${orderId}/partial-cancel`, { requestId: 'r-route-1', items: [{ item_id: item, quantity: 3 }] }, c.adminHeaders).catch((e: any) => e.response);
      expect(bad.status).toBe(400);
      expect(bad.data.type).toBe('not_allowed');

      wallet.failNextRefund = true;
      const pending = await api.post(`/admin/orders/${orderId}/partial-cancel`, { requestId: 'r-route-2', items: [{ item_id: item, quantity: 1 }] }, c.adminHeaders).catch((e: any) => e.response);
      expect(pending.status).toBe(502);
      expect(pending.data).toEqual(expect.objectContaining({ type: 'refund_pending', stage: 'edited', requestId: 'r-route-2' }));

      const ok = await api.post(`/admin/orders/${orderId}/partial-cancel`, { requestId: 'r-route-2', items: [{ item_id: item, quantity: 1 }] }, c.adminHeaders);
      expect(ok.status).toBe(200);
      expect(ok.data.stage).toBe('refunded');
    });
```

- [ ] **Step 5: 통과 확인**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern partial-cancel.spec`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add "apps/medusa/src/api/admin/orders" apps/medusa/integration-tests/http/partial-cancel.spec.ts
git commit -m "feat(medusa): POST /admin/orders/:id/partial-cancel 라우트 (#1016 35번 PR-A)"
```

---

### Task 9: 게이트와 문서

**Files:**
- Modify: `docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md` (§6.2 7·8단계 합침, §6.4 판별 근거, §10-4 답)
- Modify: `apps/medusa/src/modules/almond-payment/README.md` (refundPayment 표식 두 줄)

- [ ] **Step 1: 스펙 갱신**

§6.2 의 7·8단계를 다음으로 바꾼다:

```
7. 환불 한 번: (확정 뒤 Medusa 의 돌려줄 금액) + 배송비 환불액 → 결제마다 `refundPaymentWorkflow`(캡처 잔액 안에서 차례로) →
   almond-payment → wallet. 돌려줄 금액을 넘는 몫(= 배송비 환불)은 `refundPaymentWorkflow` 가 크레딧 라인을 스스로 붙여 장부를
   0 으로 맞춘다(`core-flows/dist/payment/workflows/refund-payment.js` 의 `creditLineAmount`). `stage = refunded`
```

`stage` 목록을 `edited → refunded` 로, D9 의 근거에 «표준 `refundPaymentWorkflow` 가 붙인다»를 더한다. §6.4 의 판별 문장을 «wallet 이 환불 사실에 싣는 `reasonCode`(PR-A 에서 추가) 또는 provider 가 기록한 wallet 환불 id(`walletRefundIds`)» 로, Idempotency-Key 문장을 «Medusa 가 주는 `context.idempotency_key`(= refund 행 id)로 `medusa-refund:<id>`» 로 바꾼다. §10-4 에 «답(2026-10-07): 실리지 않았다 → wallet 이 싣게 했다» 를 적는다. §6.2 의 «워크플로 `partialCancelOrderWorkflow`» 를 «오케스트레이터 `partialCancelOrder`(공식 워크플로를 차례로 부른다)» 로 바꾼다.

- [ ] **Step 2: 전체 게이트**

Run (루트): `npm run type-check`
Expected: 에러 0

Run (루트): `npx jest --maxWorkers=2`
Expected: 실패 0

Run: `cd apps/medusa && npm run test:unit`
Expected: PASS (`no-duplicate-validate-hooks` 포함)

Run: `scripts/local/run-medusa-integration.sh`
Expected: 전부 PASS

- [ ] **Step 3: 커밋**

```bash
git add docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md apps/medusa/src/modules/almond-payment/README.md
git commit -m "docs: PR-A 계획 단계 발견을 스펙에 반영 — 크레딧 라인은 표준 환불이 붙인다, reasonCode 판별 (#1016 35번)"
```

---

## 배포 메모 (PR 설명에 옮길 것)

- 마이그레이션 0. 부르는 쪽이 없어 부분취소 라우트는 잠들어 있다.
- **즉시 효과가 있는 것:** Task 3·4 — Medusa 밖 wallet 환불이 Medusa 장부에 들어가고, almond-payment 환불 키가 결정적이 된다. 무통장 PENDING 충돌(스펙 §1)이 줄어든다.
- wallet 과 Medusa 가 같은 스택이라 배포 순서가 없다. 겹침 창에서 `reasonCode` 가 비어도 `walletRefundIds` 가 판별한다.
- 배송 정책 스냅샷은 배포 뒤 들어온 주문부터 생긴다 — PR-C 전에 먼저 나갈수록 «배송비 미조정»이 줄어든다.
