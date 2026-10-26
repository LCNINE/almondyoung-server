// apps/medusa/integration-tests/http/fixtures/partial-cancel-fixture.ts
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import {
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createProductsWorkflow,
  createShippingOptionsWorkflow,
  beginReturnOrderWorkflow,
  requestItemReturnWorkflow,
  createReturnShippingMethodWorkflow,
  confirmReturnRequestWorkflow,
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
/** 돈이 움직인(또는 송금 대기·PG 진행 중인) 환불. FAILED 는 남기지 않는다 — 실제 wallet 에서도 남은 금액을 안 줄인다 */
export type FakeRefund = {
  id: string;
  intentId: string;
  amount: number;
  status: 'SUCCEEDED' | 'PENDING';
  execution: 'AUTO' | 'MANUAL';
  reasonCode?: string;
  idempotencyKey?: string;
  createdAt: string;
};
type Failed200 = { failureCode: string | null; retryable: boolean | null; message: string };

/** 실제 wallet 의 환불 규칙(환불가능액 초과 거절, Idempotency-Key 재생, #1048 의 목록·분류·수동 실행)을 흉내내는 최소 스텁. */
export class FakeWallet {
  server?: Server;
  intents = new Map<string, Intent>();
  refunds: FakeRefund[] = [];
  calls: Array<{ path: string; method: string; body?: any }> = [];
  failNextRefund = false;
  /** 실제 wallet 처럼 PG 거절을 200 + FAILED 환불 행으로 돌려준다(RefundsService.create 가 예외를 삼킨다). 객체면 그 분류(#1048)를 싣는다 */
  failNextRefundAs200Failed: boolean | Failed200 = false;
  /** wallet 의 4xx 거절 — 본문 `{ error, message, retryable }`(#1048). retryable 을 안 주면 칸이 없다(ValidationPipe 처럼) */
  rejectNextRefundWith: { status: number; error: string; message?: string; retryable?: boolean } | null = null;
  /** 환불은 해 놓고 응답을 잃는다(504, 본문 없음) — Medusa 는 실패로 보고 자기 환불 행을 지운다 */
  loseNextRefundResponse = false;
  /**
   * 자동 환불 행을 PENDING 으로 커밋한 채 응답을 잃는다(504) — 실제 wallet 이 PG 를 부르기 «전»에 행을 커밋하고, PG 호출 중 연결이
   * 끊기거나 wallet 이 죽은 상태(D8). PG 결과는 테스트가 `refunds[i].status` 를 바꿔 낸다
   */
  loseNextRefundResponseInFlight = false;
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
        res.end(payload === null ? undefined : JSON.stringify(payload));
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
    this.failNextRefundAs200Failed = false;
    this.rejectNextRefundWith = null;
    this.loseNextRefundResponse = false;
    this.loseNextRefundResponseInFlight = false;
  }
  /** 결제창 완료 = 즉시 승인 + 캡처(지연 승인 표식이 없을 때의 wallet 동작). */
  simulateCheckout(intentId: string) {
    const i = this.intents.get(intentId)!;
    i.status = 'CAPTURED';
    i.captured = i.amount;
  }
  /** Medusa 를 거치지 않은 wallet 환불(관리자 환불 등) — 웹훅이 빠져 장부에 없는 상황을 흉내낸다 */
  addExternalRefund(intentId: string, amount: number, reasonCode = 'ADMIN_REFUND'): FakeRefund {
    this.intents.get(intentId)!.refunded += amount;
    return this.pushRefund({ intentId, amount, status: 'SUCCEEDED', execution: 'AUTO', reasonCode });
  }
  callsTo(suffix: string) {
    return this.calls.filter((c) => c.path.endsWith(suffix)).length;
  }
  /** 환불 요청(POST …/refund)만 — 목록 조회(GET …/refunds)는 세지 않는다 */
  refundCalls() {
    return this.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/refund'));
  }
  private pushRefund(r: Omit<FakeRefund, 'id' | 'createdAt'>): FakeRefund {
    const seq = ++this.seq;
    const refund: FakeRefund = { ...r, id: `ref_${seq}`, createdAt: new Date(Date.UTC(2026, 9, 11) + seq * 1000).toISOString() };
    this.refunds.push(refund);
    return refund;
  }
  private route(method: string, path: string, body: any, key?: string): { status: number; payload: any } {
    this.calls.push({ path, method, body });
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
    if (method === 'GET' && action === '/refunds') {
      return {
        status: 200,
        payload: this.refunds
          .filter((r) => r.intentId === intent.id)
          .map((r) => ({
            id: r.id,
            chargeId: `ch_${intent.id}`,
            status: r.status,
            amount: r.amount,
            reasonCode: r.reasonCode ?? null,
            execution: r.execution,
            createdAt: r.createdAt,
          })),
      };
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
      if (replay) return { status: 200, payload: { intentId: intent.id, refunds: [{ id: replay.id, amount: replay.amount, status: replay.status }] } };
      if (this.rejectNextRefundWith) {
        const { status, error, message, retryable } = this.rejectNextRefundWith;
        this.rejectNextRefundWith = null;
        return { status, payload: { error, message: message ?? 'injected', ...(retryable !== undefined ? { retryable } : {}) } };
      }
      if (this.failNextRefund) {
        this.failNextRefund = false;
        return { status: 502, payload: { error: 'PG_UNAVAILABLE', message: 'injected' } };
      }
      // 실제 wallet 의 DTO 검증(@IsInt @Min(1))처럼 거절한다 — amount:null 같은 결함이 0 원 환불로 조용히 통과하지 않게.
      const amount = body.amount;
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
        return { status: 400, payload: { error: 'VALIDATION_ERROR', message: `amount must be a positive integer: ${JSON.stringify(amount)}` } };
      }
      if (this.failNextRefundAs200Failed) {
        const f: Failed200 =
          this.failNextRefundAs200Failed === true
            ? { failureCode: null, retryable: null, message: 'injected PG decline' }
            : this.failNextRefundAs200Failed;
        this.failNextRefundAs200Failed = false;
        return {
          status: 200,
          payload: {
            intentId: intent.id,
            refunds: [
              {
                id: `ref_${++this.seq}`,
                amount,
                status: 'FAILED',
                reasonCode: body.reasonCode ?? null,
                reasonMessage: f.message,
                failureCode: f.failureCode,
                retryable: f.retryable,
              },
            ],
          },
        };
      }
      if (amount > intent.captured - intent.refunded) {
        return { status: 400, payload: { error: 'REFUND_AMOUNT_EXCEEDS_AVAILABLE', message: `${amount}`, retryable: true } };
      }
      intent.refunded += amount;
      // 실제 wallet 의 수동 실행은 외부 결제 몫을 PG 없이 송금 대기로 남긴다(포인트 몫 분할은 흉내내지 않는다)
      const manual = body.execution === 'MANUAL';
      const inFlight = !manual && this.loseNextRefundResponseInFlight;
      const refund = this.pushRefund({
        intentId: intent.id,
        amount,
        status: manual || inFlight ? 'PENDING' : 'SUCCEEDED',
        execution: manual ? 'MANUAL' : 'AUTO',
        reasonCode: body.reasonCode,
        idempotencyKey: key,
      });
      if (this.loseNextRefundResponse || inFlight) {
        this.loseNextRefundResponse = false;
        this.loseNextRefundResponseInFlight = false;
        return { status: 504, payload: null };
      }
      return { status: 200, payload: { intentId: intent.id, refunds: [{ id: refund.id, amount, status: refund.status }] } };
    }
    return { status: 404, payload: { error: 'NOT_FOUND', message: path } };
  }
}

/**
 * 반품 배송 옵션(is_return: true, 고정 0원). 우리 almond-fulfillment provider 는 아직 createReturnFulfillment 가 없어
 * manual provider 로 만든다. 반품 배송 방법은 호출마다 custom_amount 로 금액을 정한다.
 */
export async function createReturnShippingOption(container: any, shippingProfileId: string): Promise<string> {
  const { serviceZoneId } = await ensureKoreanShippingInfrastructure(container);
  const { result } = await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: '반품 택배',
        price_type: 'flat',
        provider_id: 'manual_manual',
        service_zone_id: serviceZoneId,
        shipping_profile_id: shippingProfileId,
        type: { label: '반품 택배', description: '반품', code: 'return' },
        prices: [{ currency_code: 'krw', amount: 0 }],
        rules: [
          { attribute: 'enabled_in_store', value: 'false', operator: 'eq' },
          { attribute: 'is_return', value: 'true', operator: 'eq' },
        ],
      },
    ],
  });
  return result[0].id as string;
}

/** 주문 줄 하나를 반품 요청으로 확정한다(반품 배송 방법 포함). 반환: return id. */
export async function requestReturnWithShipping(
  container: any,
  p: { orderId: string; itemId: string; quantity: number; returnOptionId: string; shippingAmount: number },
): Promise<string> {
  const { result: change } = await beginReturnOrderWorkflow(container).run({ input: { order_id: p.orderId } });
  const returnId = (change as any).return_id as string;
  await requestItemReturnWorkflow(container).run({
    input: { return_id: returnId, items: [{ id: p.itemId, quantity: p.quantity }] },
  });
  await createReturnShippingMethodWorkflow(container).run({
    input: { return_id: returnId, shipping_option_id: p.returnOptionId, custom_amount: p.shippingAmount },
  });
  await confirmReturnRequestWorkflow(container).run({ input: { return_id: returnId, confirmed_by: 'test' } });
  return returnId;
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

/** 배송비 할인(어드민의 «배송비 할인» 쿠폰과 같은 모양: target_type shipping_methods). */
export async function createShippingFixedPromo({ api }: Ctx, c: Commerce, code: string, value: number) {
  const res = await api.post(
    '/admin/promotions',
    {
      code, type: 'standard', is_automatic: false, status: 'active',
      application_method: { type: 'fixed', value, target_type: 'shipping_methods', allocation: 'each', max_quantity: 1, currency_code: 'krw' },
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
  opts: {
    lines: Array<{ variant: 'A' | 'B' | 'C' | 'D'; quantity: number }>;
    promoCode?: string;
    /** 배송 방법을 넣은 «뒤»에 적용한다 — 배송 방법이 없는 카트에선 배송비 할인이 붙을 대상이 없다. */
    shippingPromoCode?: string;
    postalCode?: string;
  },
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

  // 주문에 쓰인 그룹마다 배송 방법 하나. 기본 라우트는 호출마다 기존 방법을 전부 지우므로 bulk 라우트로 한 번에 넣는다.
  const used = [...new Set(opts.lines.map((l) => ({ A: 'cond', B: 'cond', C: 'flat', D: 'perq' } as const)[l.variant]))];
  await api.post(
    `/store/carts/${cartId}/shipping-methods/bulk`,
    { option_ids: used.map((g) => c.groups[g].shippingOptionId) },
    c.storeHeaders,
  );
  if (opts.shippingPromoCode) {
    await api.post(`/store/carts/${cartId}/promotions`, { promo_codes: [opts.shippingPromoCode] }, c.storeHeaders);
  }

  const pc = await api.post('/store/payment-collections', { cart_id: cartId }, c.storeHeaders);
  const ses = await api.post(
    `/store/payment-collections/${pc.data.payment_collection.id}/payment-sessions`,
    { provider_id: 'pp_almond-payment_almond-payment' },
    c.storeHeaders,
  );
  const intentId = ses.data.payment_collection.payment_sessions[0].data.intentId as string;
  wallet.simulateCheckout(intentId);
  const done = await api.post(`/store/carts/${cartId}/complete`, {}, c.storeHeaders).catch((e: any) => { throw new Error('complete: ' + JSON.stringify(e.response?.data)); });
  if (done.data.type !== 'order') throw new Error(`cart complete failed: ${JSON.stringify(done.data)}`);
  return { orderId: done.data.order.id as string, intentId };
}

/**
 * 주문을 현재 버전 기준으로 읽는다. query.graph 의 `summary.*`·`items.*` 는 주문 수정이 한 번 확정되고 나면
 * 버전이 섞여 나온다(수정 뒤 summary 가 v1 pending_difference 와 v2 current_order_total 의 혼합으로 보였다).
 * 그래서 버전을 아는 order 모듈로 읽고, 결제 컬렉션만 link 로 읽는다.
 */
export async function loadOrder(container: any, orderId: string) {
  const orderModule = container.resolve(Modules.ORDER);
  const o = await orderModule.retrieveOrder(orderId, {
    select: ['id', 'status', 'version', 'metadata'],
    relations: ['items', 'items.detail', 'items.adjustments', 'shipping_methods', 'summary', 'credit_lines', 'shipping_address'],
  });
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'order',
    fields: [
      'id',
      'payment_collections.id',
      'payment_collections.payments.id',
      'payment_collections.payments.data',
      'payment_collections.payments.captures.amount',
      'payment_collections.payments.refunds.amount',
    ],
    filters: { id: orderId },
  });
  return {
    ...o,
    summary: Array.isArray(o.summary) ? o.summary.find((x: any) => x.version === o.version) ?? o.summary[0] : o.summary,
    payment_collections: (data[0] as any)?.payment_collections ?? [],
  } as any;
}
