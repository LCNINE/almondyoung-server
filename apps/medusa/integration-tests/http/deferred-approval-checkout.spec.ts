import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { createServer, Server } from 'http';
import jwt from 'jsonwebtoken';
import { PROMOTION_META_MODULE } from '../../src/modules/promotion-meta';
import {
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createProductsWorkflow,
  createApiKeysWorkflow,
  createStockLocationsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from '@medusajs/core-flows';

jest.setTimeout(300 * 1000);

/**
 * 지연 승인(deferred approval) end-to-end 검증 — 고아결제 원천 차단.
 *
 * 요지: 카드/토스는 capture 가 아니라 **승인(approve)** 에서 돈이 빠진다. 승인이 주문 생성보다
 * 먼저 일어나면 재고예약 실패 시 "돈은 빠졌는데 주문 없음" 이 된다. 그래서 승인을
 * completeCartWorkflow 의 마지막 단계로 옮겼다.
 *
 * 가짜 wallet 서버가 실제 wallet 의 규칙을 그대로 흉내낸다:
 *   - 결제창 완료(simulateCheckout) 시, intent 에 approvalMode='DEFERRED' 표식이 **없으면**
 *     그 자리에서 승인 + 자동캡처 (= 수정 전 동작)
 *   - 표식이 **있으면** 승인 파라미터만 적재하고 REQUIRES_ACTION 유지, 승인은 finalize-approval 때
 *
 * 따라서 "재고 부족인데 승인이 일어났는가" 를 그대로 관찰할 수 있고, 수정 전 코드(표식 미부여)에서는
 * 아래 재고 관련 케이스들이 실제로 실패한다.
 */

const WALLET_PORT = 39117;
const WALLET_BASE_URL = `http://127.0.0.1:${WALLET_PORT}`;
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';

interface FakeIntent {
  id: string;
  amount: number;
  deferred: boolean;
  staged: boolean;
  approved: boolean;
  status: string;
  refunded: number;
  canceled: boolean;
}

/** 실제 wallet 의 상태/규칙을 흉내내는 최소 스텁. */
class FakeWallet {
  server?: Server;
  intents = new Map<string, FakeIntent>();
  calls: Array<{ path: string; method: string; intentId?: string }> = [];
  /** true 면 finalize-approval 이 PG 승인 거절(422)로 응답한다. */
  rejectApproval = false;
  private seq = 0;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', WALLET_BASE_URL);
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const parsed: any = body ? JSON.parse(body) : {};
        const { status, payload } = this.route(req.method ?? 'GET', url.pathname, parsed);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(WALLET_PORT, '127.0.0.1', resolve));
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }

  reset(): void {
    this.intents.clear();
    this.calls = [];
    this.rejectApproval = false;
  }

  /** 고객이 결제창을 완료한 상황. 실제 wallet 의 TossApproveService.approve 규칙과 동일하게 분기한다. */
  simulateCheckout(intentId: string): void {
    const intent = this.intents.get(intentId)!;
    if (intent.deferred) {
      intent.staged = true;
      intent.status = 'REQUIRES_ACTION';
      return;
    }
    // 수정 전 동작: 결제창을 닫는 즉시 승인 + 자동캡처 (= 이 시점에 돈이 빠진다)
    intent.approved = true;
    intent.status = 'CAPTURED';
  }

  /** 무통장 입금대기 상태. almond-payment 는 이 상태를 'authorized' 로 매핑한다. */
  simulateAwaitingDeposit(intentId: string): void {
    const intent = this.intents.get(intentId)!;
    intent.staged = false;
    intent.status = 'AWAITING_DEPOSIT';
  }

  callsTo(suffix: string): number {
    return this.calls.filter((c) => c.path.endsWith(suffix)).length;
  }

  private route(method: string, path: string, body: any): { status: number; payload: any } {
    this.calls.push({ path, method });

    if (method === 'POST' && path === '/v1/payment-intents') {
      const id = `int_${++this.seq}`;
      this.intents.set(id, {
        id,
        amount: body.amount ?? 0,
        deferred: body.metadata?.approvalMode === 'DEFERRED',
        staged: false,
        approved: false,
        status: 'CREATED',
        refunded: 0,
        canceled: false,
      });
      return { status: 201, payload: { id } };
    }

    const match = /^\/v1\/payment-intents\/([^/]+)(\/.*)?$/.exec(path);
    if (!match) return { status: 404, payload: { error: 'NOT_FOUND', message: path } };

    const intent = this.intents.get(match[1]);
    if (!intent) return { status: 404, payload: { error: 'INTENT_NOT_FOUND', message: match[1] } };
    const action = match[2] ?? '';

    if (method === 'GET' && !action) {
      return {
        status: 200,
        payload: { id: intent.id, status: intent.status, payableAmount: intent.amount, currency: 'KRW' },
      };
    }

    if (action === '/finalize-approval') {
      if (intent.approved) return { status: 200, payload: { status: intent.status } };
      if (!intent.staged) {
        return { status: 409, payload: { error: 'NO_STAGED_APPROVAL', message: 'nothing staged' } };
      }
      if (this.rejectApproval) {
        // 승인 실패 시 실제 wallet 은 charge FAILED + intent CREATED 로 되돌린다.
        intent.staged = false;
        intent.status = 'CREATED';
        return { status: 422, payload: { error: 'REJECT_CARD_COMPANY', message: '카드사 승인 거절' } };
      }
      intent.approved = true;
      intent.status = 'CAPTURED'; // 실제 wallet 은 승인 직후 auto-capture 한다
      return { status: 200, payload: { status: intent.status } };
    }

    if (action === '/capture') {
      if (!intent.approved) return { status: 400, payload: { error: 'INTENT_NOT_CAPTURABLE', message: intent.status } };
      intent.status = 'CAPTURED';
      return { status: 200, payload: { status: intent.status } };
    }

    if (action === '/cancel') {
      intent.canceled = true;
      intent.status = 'CANCELED';
      return { status: 200, payload: { status: intent.status } };
    }

    if (action === '/refund') {
      intent.refunded += body.amount ?? 0;
      return { status: 200, payload: { status: intent.status, refunded: intent.refunded } };
    }

    return { status: 404, payload: { error: 'NOT_FOUND', message: path } };
  }
}

const wallet = new FakeWallet();

medusaIntegrationTestRunner({
  inApp: true,
  env: { WALLET_BASE_URL, WALLET_API_KEY: 'test-wallet-key' },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let storeHeaders: { headers: Record<string, string> };
    let adminHeaders: { headers: Record<string, string> };
    let jwtSecret: string;
    let regionId: string;
    let salesChannelId: string;
    let variantId: string;
    let inventoryItemId: string;
    let locationId: string;

    const setStock = async (quantity: number) => {
      const inventory = getContainer().resolve(Modules.INVENTORY);
      const [level] = await inventory.listInventoryLevels({
        inventory_item_id: inventoryItemId,
        location_id: locationId,
      });
      await inventory.updateInventoryLevels([
        { inventory_item_id: inventoryItemId, location_id: locationId, stocked_quantity: quantity, id: level.id },
      ]);
    };

    const reservationCount = async (): Promise<number> => {
      const inventory = getContainer().resolve(Modules.INVENTORY);
      const reservations = await inventory.listReservationItems({ inventory_item_id: inventoryItemId });
      return reservations.length;
    };

    const orderIdForCart = async (cartId: string): Promise<string | null> => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const { data } = await query.graph({
        entity: 'order_cart',
        fields: ['cart_id', 'order_id'],
        filters: { cart_id: cartId },
      });
      return (data[0] as any)?.order_id ?? null;
    };

    const cartCompletedAt = async (cartId: string) => {
      const cartModule = getContainer().resolve(Modules.CART);
      const cart = await cartModule.retrieveCart(cartId, { select: ['id', 'completed_at'] });
      return cart.completed_at ?? null;
    };

    /** 카트 생성 → 결제 세션 생성 → 결제창 완료까지. 반환값의 intentId 로 wallet 상태를 관찰한다. */
    const startCheckout = async (quantity: number) => {
      const cartRes = await api.post(
        '/store/carts',
        {
          region_id: regionId,
          sales_channel_id: salesChannelId,
          email: 'buyer@deferred.test',
          items: [{ variant_id: variantId, quantity }],
        },
        storeHeaders,
      );
      const cartId = cartRes.data.cart.id as string;

      // 배송수단 설정은 이 스펙의 검증 대상이 아니다(결제·재고 순서가 대상). 라인아이템을
      // 배송 불필요로 두어 validateShippingStep 을 통과시킨다.
      const cartModule = getContainer().resolve(Modules.CART);
      const cartRow = await cartModule.retrieveCart(cartId, { relations: ['items'] });
      await cartModule.updateLineItems(
        (cartRow.items ?? []).map((item: any) => ({ id: item.id, requires_shipping: false })),
      );

      const pcRes = await api.post('/store/payment-collections', { cart_id: cartId }, storeHeaders);
      const paymentCollectionId = pcRes.data.payment_collection.id as string;

      const sessionRes = await api.post(
        `/store/payment-collections/${paymentCollectionId}/payment-sessions`,
        { provider_id: 'pp_almond-payment_almond-payment' },
        storeHeaders,
      );
      const session = sessionRes.data.payment_collection.payment_sessions[0];
      const intentId = session.data.intentId as string;

      wallet.simulateCheckout(intentId);
      return { cartId, intentId };
    };

    beforeAll(async () => {
      await wallet.start();

      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;
      jwtSecret = secret;
      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: 'admin@deferred.test' }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'a', app_metadata: { user_id: user.id } },
            secret,
          )}`,
        },
      };

      const { result: scRes } = await createSalesChannelsWorkflow(container).run({
        input: { salesChannelsData: [{ name: 'Deferred SC' }] },
      });
      salesChannelId = scRes[0].id;

      const { result: regionRes } = await createRegionsWorkflow(container).run({
        input: { regions: [{ name: 'KR-deferred', currency_code: 'krw', countries: ['kr'] }] },
      });
      regionId = regionRes[0].id;

      const { result: locRes } = await createStockLocationsWorkflow(container).run({
        input: { locations: [{ name: 'Deferred WH' }] },
      });
      locationId = locRes[0].id;
      await linkSalesChannelsToStockLocationWorkflow(container).run({
        input: { id: locationId, add: [salesChannelId] },
      });

      const fulfillment = container.resolve(Modules.FULFILLMENT);
      const profiles = await fulfillment.listShippingProfiles({});
      const shippingProfileId =
        profiles[0]?.id ??
        (await fulfillment.createShippingProfiles([{ name: 'default', type: 'default' }]))[0].id;

      const { result: prodRes } = await createProductsWorkflow(container).run({
        input: {
          products: [
            {
              title: 'Deferred Product',
              status: 'published',
              shipping_profile_id: shippingProfileId,
              sales_channels: [{ id: salesChannelId }],
              options: [{ title: 'Size', values: ['M'] }],
              variants: [
                {
                  title: 'M',
                  sku: 'DEFERRED-M',
                  manage_inventory: true,
                  allow_backorder: false,
                  options: { Size: 'M' },
                  prices: [{ amount: 10000, currency_code: 'krw' }],
                },
              ],
            },
          ],
        },
      });
      variantId = prodRes[0].variants[0].id;

      const query = container.resolve(ContainerRegistrationKeys.QUERY);
      const { data: variantInventory } = await query.graph({
        entity: 'product_variant_inventory_item',
        fields: ['variant_id', 'inventory_item_id'],
        filters: { variant_id: variantId },
      });
      inventoryItemId = (variantInventory[0] as any).inventory_item_id;

      const inventory = container.resolve(Modules.INVENTORY);
      // 배송 없는 상품으로 두어 shipping option 설정 없이 카트를 완료할 수 있게 한다
      // (검증 대상은 결제·재고 순서이지 배송이 아니다).
      await inventory.updateInventoryItems([{ id: inventoryItemId, requires_shipping: false }]);
      await inventory.createInventoryLevels([
        { inventory_item_id: inventoryItemId, location_id: locationId, stocked_quantity: 5 },
      ]);

      const { result: keyRes } = await createApiKeysWorkflow(container).run({
        input: { api_keys: [{ title: 'pk-deferred', type: 'publishable', created_by: user.id }] },
      });
      await linkSalesChannelsToApiKeyWorkflow(container).run({
        input: { id: keyRes[0].id, add: [salesChannelId] },
      });
      storeHeaders = { headers: { 'x-publishable-api-key': keyRes[0].token } };
    });

    afterAll(async () => {
      await wallet.stop();
    });

    beforeEach(async () => {
      wallet.reset();
      // 케이스 간 격리: 이전 테스트가 만든 예약이 남아 있으면 가용재고 판정이 오염된다.
      const inventory = getContainer().resolve(Modules.INVENTORY);
      const leftovers = await inventory.listReservationItems({ inventory_item_id: inventoryItemId });
      if (leftovers.length) {
        await inventory.deleteReservationItems(leftovers.map((r: any) => r.id));
      }
      await setStock(5);
    });

    it('결제 세션 생성 시 지연 승인 표식을 wallet 에 전달한다', async () => {
      const { intentId } = await startCheckout(1);

      expect(wallet.intents.get(intentId)!.deferred).toBe(true);
      // 표식이 있으므로 결제창 완료만으로는 승인되지 않는다 (= 아직 돈이 안 빠진 상태)
      expect(wallet.intents.get(intentId)!.approved).toBe(false);
    });

    it('정상 결제: 주문 생성 후에 승인되고 캡처까지 반영된다', async () => {
      const { cartId, intentId } = await startCheckout(1);

      const res = await api.post(`/store/carts/${cartId}/complete`, {}, storeHeaders);

      expect(res.data.type).toBe('order');
      expect(wallet.callsTo('/finalize-approval')).toBe(1);
      expect(wallet.intents.get(intentId)!.approved).toBe(true);
      expect(await orderIdForCart(cartId)).toBeTruthy();
      expect(await reservationCount()).toBe(1);

      const paymentModule = getContainer().resolve(Modules.PAYMENT);
      const [payment] = await paymentModule.listPayments({}, { order: { created_at: 'DESC' }, take: 1 });
      expect(payment.captured_at).toBeTruthy();
    });

    it('재고 초과 주문: 승인에 도달하지 못해 돈이 빠지지 않는다', async () => {
      // 담기 시점엔 재고가 충분했고(그래서 카트에 담겼고), 결제 시점에 부족해진 상황.
      // (담기 시점 초과는 Medusa 가 카트 생성에서 이미 거부한다 — 1차 방어)
      const { cartId, intentId } = await startCheckout(2);
      await setStock(1);

      await api.post(`/store/carts/${cartId}/complete`, {}, storeHeaders).catch((e: any) => e.response);

      // 핵심: 재고예약이 승인보다 먼저이므로 승인 자체가 일어나지 않는다.
      expect(wallet.intents.get(intentId)!.approved).toBe(false);
      expect(wallet.callsTo('/finalize-approval')).toBe(0);
      expect(await orderIdForCart(cartId)).toBeNull();
      expect(await cartCompletedAt(cartId)).toBeNull();
      expect(await reservationCount()).toBe(0);
    });

    it('담은 뒤 재고가 0이 된 경우(드리프트): 승인 없이 실패하고 주문도 없다', async () => {
      await setStock(1);
      const { cartId, intentId } = await startCheckout(1);

      // 결제창을 완료한 사이에 다른 주문/재고조정으로 재고가 사라진 상황
      await setStock(0);

      await api.post(`/store/carts/${cartId}/complete`, {}, storeHeaders).catch((e: any) => e.response);

      expect(wallet.intents.get(intentId)!.approved).toBe(false);
      expect(await orderIdForCart(cartId)).toBeNull();
      expect(await reservationCount()).toBe(0);
    });

    it('동시 2주문 경쟁: 재고 1개면 한 건만 주문되고 나머지는 미승인으로 남는다', async () => {
      await setStock(1);
      const a = await startCheckout(1);
      const b = await startCheckout(1);

      await Promise.all([
        api.post(`/store/carts/${a.cartId}/complete`, {}, storeHeaders).catch((e: any) => e.response),
        api.post(`/store/carts/${b.cartId}/complete`, {}, storeHeaders).catch((e: any) => e.response),
      ]);

      const orders = [await orderIdForCart(a.cartId), await orderIdForCart(b.cartId)].filter(Boolean);
      const approved = [a.intentId, b.intentId].filter((id) => wallet.intents.get(id)!.approved);

      expect(orders).toHaveLength(1);
      // 주문이 안 된 쪽은 돈도 빠지지 않아야 한다 (오버셀도 고아결제도 없음)
      expect(approved).toHaveLength(1);
      expect(await reservationCount()).toBe(1);
    });

    it('PG 승인 거절: 주문·재고예약·카트완료가 모두 롤백된다', async () => {
      const { cartId, intentId } = await startCheckout(1);
      wallet.rejectApproval = true;

      const res = await api
        .post(`/store/carts/${cartId}/complete`, {}, storeHeaders)
        .catch((e: any) => e.response);

      expect(res.data.type).not.toBe('order');
      expect(wallet.callsTo('/finalize-approval')).toBe(1);
      expect(wallet.intents.get(intentId)!.approved).toBe(false);
      expect(await orderIdForCart(cartId)).toBeNull();
      expect(await cartCompletedAt(cartId)).toBeNull();
      expect(await reservationCount()).toBe(0);
    });

    it('승인 거절 후 재시도하면 정상적으로 주문된다', async () => {
      const { cartId, intentId } = await startCheckout(1);
      wallet.rejectApproval = true;
      await api.post(`/store/carts/${cartId}/complete`, {}, storeHeaders).catch((e: any) => e.response);

      // 고객이 결제를 다시 시도 (wallet 은 실패 시 intent 를 CREATED 로 되돌려 세션을 재사용한다)
      wallet.rejectApproval = false;
      wallet.simulateCheckout(intentId);
      const res = await api.post(`/store/carts/${cartId}/complete`, {}, storeHeaders);

      expect(res.data.type).toBe('order');
      expect(wallet.intents.get(intentId)!.approved).toBe(true);
      expect(await reservationCount()).toBe(1);
    });

    it('complete 재호출은 멱등: 같은 주문을 돌려주고 승인을 다시 하지 않는다', async () => {
      const { cartId } = await startCheckout(1);
      const first = await api.post(`/store/carts/${cartId}/complete`, {}, storeHeaders);
      const orderId = first.data.order.id;

      const second = await api
        .post(`/store/carts/${cartId}/complete`, {}, storeHeaders)
        .catch((e: any) => e.response);

      expect(wallet.callsTo('/finalize-approval')).toBe(1);
      expect(await orderIdForCart(cartId)).toBe(orderId);
    });

    it('무통장 입금대기는 폴백 경로로도 완료되지 않는다 (미입금 출고 차단)', async () => {
      // 정상 무통장 주문은 wallet 웹훅이 marker 와 함께 선생성한다. 이 경로로 완료되면
      // marker 없는 authorized 주문이 생겨 WMS 수집 게이트를 통과해버린다.
      const { cartId, intentId } = await startCheckout(1);
      wallet.simulateAwaitingDeposit(intentId);

      const res = await api
        .post(`/store/payment-intents/${intentId}/complete`, {}, storeHeaders)
        .catch((e: any) => e.response);

      expect(res.status).toBe(409);
      expect(res.data.code).toBe('BANK_TRANSFER_AWAITING_DEPOSIT');
      expect(await orderIdForCart(cartId)).toBeNull();
      expect(await cartCompletedAt(cartId)).toBeNull();
    });

    it('무통장 입금대기는 cart.complete 로도 완료되지 않는다 (기존 가드 회귀)', async () => {
      const { cartId, intentId } = await startCheckout(1);
      wallet.simulateAwaitingDeposit(intentId);

      const res = await api
        .post(`/store/carts/${cartId}/complete`, {}, storeHeaders)
        .catch((e: any) => e.response);

      expect(res.status).toBe(409);
      expect(await orderIdForCart(cartId)).toBeNull();
    });

    it('카트를 특정 못 한 콜백 폴백: intent 로 서버사이드 완료가 된다', async () => {
      const { cartId, intentId } = await startCheckout(1);

      const res = await api.post(`/store/payment-intents/${intentId}/complete`, {}, storeHeaders);

      expect(res.data.type).toBe('order');
      expect(res.data.cart_id).toBe(cartId);
      expect(wallet.intents.get(intentId)!.approved).toBe(true);
      expect(await orderIdForCart(cartId)).toBe(res.data.order_id);
    });

    /**
     * C1(2026-08-31 최종 리뷰) 회귀 + T6 완결.
     *
     * 이 파일이 유일하게 `completeCartWorkflow` 를 실제 주문까지 끝까지 태우는 스펙이라 여기
     * 붙인다 — `record-coupon-usage.ts` 의 `orderCreated` 훅이 **실 결제 완료 경로**에서 도는지
     * 확인하는 유일한 자리다(다른 쿠폰 스펙은 카트 단계까지만 가거나 백스톱에서 일부러 실패시킨다).
     *
     * C1 의 사고 경로: `public` 쿠폰은 발급 사건이 없어 링크 행이 원래 없다. 훅이 필터 없이
     * `Link.create` 를 부르면 upsert 라 그 자리에서 INSERT 되고, 그 행의 `expires_at` 은
     * NULL(무기한)로 박혀 정책의 `ends_at` 을 지나도 그 고객에게만 영구 유효가 된다.
     *
     * 🔴 T6 재작성(#488 그랜트 모델, Task 14 리뷰): 사용 기록의 정본이 링크 행에서
     * `coupon_grant` 로 옮겨갔다(`record-coupon-usage.ts` 가 `consumeGrantIfUnused()` 로 grant 를
     * 갱신하지, 링크 행의 `used_at`/`order_id` 를 쓰지 않는다 — 링크는 이제 표시 조인 전용).
     * 그래서 T6 은 이제 링크 행이 아니라 **grant** 를 본다. C1(링크 행에 사용사건이 새면 안
     * 된다)은 여전히 링크 행을 봐야 하므로 `linkRowsFor` 는 그대로 둔다 — 두 불변식은
     * 그랜트 모델 전환 후에도 별개로 유효하다.
     */
    describe('C1: public 쿠폰 사용이 발급 링크를 만들면 안 된다', () => {
      let c1Seq = 0;
      let customerId: string;
      let customerHeaders: { headers: Record<string, string> };

      const linkRowsFor = async (promotionId: string, custId: string) =>
        (getContainer().resolve(ContainerRegistrationKeys.LINK) as any)
          .getLinkModule(Modules.CUSTOMER, 'customer_id', Modules.PROMOTION, 'promotion_id')
          .list(
            { customer_id: custId, promotion_id: promotionId },
            { select: ['customer_id', 'promotion_id', 'expires_at', 'used_at', 'order_id'] },
          ) as Promise<any[]>;

      /** grant 조회. 사용 기록(`used_at`/`order_id`)의 정본은 T6 이후로 여기다. */
      const grantsFor = async (promotionId: string, custId: string) => {
        const svc = getContainer().resolve(PROMOTION_META_MODULE) as any;
        const grants = (await svc.listGrantsForCustomer(custId)) as Array<{
          promotion_id: string;
          used_at: Date | string | null;
          order_id: string | null;
        }>;
        return grants.filter((g) => g.promotion_id === promotionId);
      };

      const createPromo = async (code: string, additional_data: Record<string, unknown>) => {
        const res = await api.post(
          '/admin/promotions',
          {
            code,
            type: 'standard',
            is_automatic: false,
            status: 'active',
            application_method: { type: 'percentage', value: 10, target_type: 'order', currency_code: 'krw' },
            additional_data,
          },
          adminHeaders,
        );
        return res.data.promotion.id as string;
      };

      /**
       * `startCheckout` 과 같은 모양이지만 둘이 다르다: (1) 인증된 고객 헤더로 카트를 만든다
       * (C1 은 "로그인한 고객"에게서만 재현되므로 — 링크 테이블은 customer_id 가 있어야 행이
       * 남는다), (2) `promo_codes` 로 쿠폰을 카트 생성 시점에 붙인다.
       */
      const checkoutWithPromo = async (promoCode: string) => {
        const cartRes = await api.post(
          '/store/carts',
          {
            region_id: regionId,
            sales_channel_id: salesChannelId,
            items: [{ variant_id: variantId, quantity: 1 }],
            promo_codes: [promoCode],
          },
          customerHeaders,
        );
        const cartId = cartRes.data.cart.id as string;

        const cartModule = getContainer().resolve(Modules.CART);
        const cartRow = await cartModule.retrieveCart(cartId, { relations: ['items'] });
        await cartModule.updateLineItems(
          (cartRow.items ?? []).map((item: any) => ({ id: item.id, requires_shipping: false })),
        );

        const pcRes = await api.post('/store/payment-collections', { cart_id: cartId }, customerHeaders);
        const paymentCollectionId = pcRes.data.payment_collection.id as string;

        const sessionRes = await api.post(
          `/store/payment-collections/${paymentCollectionId}/payment-sessions`,
          { provider_id: 'pp_almond-payment_almond-payment' },
          customerHeaders,
        );
        const session = sessionRes.data.payment_collection.payment_sessions[0];
        const intentId = session.data.intentId as string;

        wallet.simulateCheckout(intentId);

        const completeRes = await api.post(`/store/carts/${cartId}/complete`, {}, customerHeaders);
        return { cartId, intentId, completeRes };
      };

      beforeEach(async () => {
        c1Seq += 1;
        const customerModule = getContainer().resolve(Modules.CUSTOMER);
        const [cust] = await customerModule.createCustomers([{ email: `c1-${c1Seq}@deferred.test` }]);
        customerId = cust.id;
        customerHeaders = {
          headers: {
            'x-publishable-api-key': storeHeaders.headers['x-publishable-api-key'],
            authorization: `Bearer ${jwt.sign(
              {
                actor_id: customerId,
                actor_type: 'customer',
                auth_identity_id: `c1_${c1Seq}`,
                app_metadata: { customer_id: customerId },
              },
              jwtSecret,
            )}`,
          },
        };
      });

      it('만료일 있는 public 쿠폰으로 주문을 완료해도 그 고객·프로모션 쌍의 링크 행은 생기지 않는다', async () => {
        const promoCode = `C1PUB${c1Seq}`;
        // 지금은 아직 살아있는(=카트에 붙는) 정책 만료일. 하루 뒤 만료라 사용 시점엔 유효하다.
        const futureEndsAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        const promotionId = await createPromo(promoCode, { visibility: 'public', ends_at: futureEndsAt });

        const { completeRes } = await checkoutWithPromo(promoCode);
        expect(completeRes.data.type).toBe('order');

        // 되돌리면(=필터 제거) 여기서 길이 1인 행이 생긴다 — 그게 바로 C1.
        const rows = await linkRowsFor(promotionId, customerId);
        expect(rows).toHaveLength(0);
      });

      it('발급된(assigned_only) 쿠폰으로 주문을 완료하면 그 grant 정확히 한 장이 used_at/order_id 를 갖는다 (T6)', async () => {
        const promoCode = `C1ISSUED${c1Seq}`;
        const promotionId = await createPromo(promoCode, { visibility: 'assigned_only' });

        // 발급 3경로 중 하나로 실제 발급한다 — grant 1장을 만드는 유일하게 정당한 방법
        // (관리자 수동 발급 경로, `issued_via='admin_manual'`). 링크 행도 표시 조인용으로
        // 같이 생기지만(위 route.ts 참고), 사용 기록의 정본은 아래에서 보는 grant 다.
        await api.post(
          `/admin/customers/${customerId}/promotions`,
          { promotion_ids: [promotionId], submit_id: `c1issued-${c1Seq}` },
          adminHeaders,
        );

        const { completeRes } = await checkoutWithPromo(promoCode);
        expect(completeRes.data.type).toBe('order');
        const orderId = completeRes.data.order.id as string;

        // 「무언가 기록됐다」가 아니라 「어느 장이 그 주문으로 소모됐다」를 본다 — 발급이
        // 정확히 한 장이었으므로 소모도 정확히 그 한 장이어야 한다.
        const grants = await grantsFor(promotionId, customerId);
        expect(grants).toHaveLength(1);
        expect(grants[0].used_at).not.toBeNull();
        expect(grants[0].order_id).toEqual(orderId);
      });
    });
  },
});
