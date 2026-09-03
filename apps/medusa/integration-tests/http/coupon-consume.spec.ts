import { createServer, type Server } from 'http';
import { dirname, join } from 'path';
import jwt from 'jsonwebtoken';
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import {
  createApiKeysWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from '@medusajs/core-flows';
import { PROMOTION_META_MODULE } from '../../src/modules/promotion-meta';
import handleCouponGrantRestore from '../../src/subscribers/coupon-grant-restore';
import { restoreStuckCouponConsumptions } from '../../src/scripts/restore-stuck-coupon-consumptions';

jest.setTimeout(180 * 1000);

/**
 * 쿠폰 «소모» 경로의 HTTP 커버리지 (ADR-0034 2026-09-04 개정 「증명 — 스펙」). 이 파일 이전엔
 * 카트를 완료하면서 장의 상태를 단언하는 스펙이 없었다.
 *
 * wallet 스텁: `coupon-cap.spec.ts` 의 최소 스텁에 GET intent(승인 판정)·capture·cancel 을 더한 것.
 * `intentStatus` 로 승인 결과를 조종한다 — 'AUTHORIZED' 면 주문이 서고, 'FAILED' 면
 * `authorizePaymentSessionStep` 이 던져 워크플로가 보상된다(③).
 */
// 🔴 포트를 상수로 박으면 안 된다 — 앞 실행의 리스너가 잠깐 살아남아 EADDRINUSE 로 전 스펙이 죽는다.
const WALLET_PORT = 39500 + (process.pid % 400);
const WALLET_BASE_URL = `http://127.0.0.1:${WALLET_PORT}`;
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';

let walletStub: Server | undefined;
let intentSeq = 0;
/** GET /v1/payment-intents/:id 가 돌려줄 상태. almond-payment 의 mapStatus 가 'authorized' | 'error' 로 접는다. */
let intentStatus: 'AUTHORIZED' | 'FAILED' = 'AUTHORIZED';

const startWalletStub = () =>
  new Promise<void>((resolve, reject) => {
    walletStub = createServer((req, res) => {
      const url = req.url ?? '';
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'POST' && url === '/v1/payment-intents') {
        intentSeq += 1;
        return json(200, { id: `pi_consume_${intentSeq}`, status: 'REQUIRES_ACTION' });
      }
      const match = /^\/v1\/payment-intents\/([^/?]+)(\/[^?]*)?/.exec(url);
      if (match && req.method === 'GET' && !match[2]) {
        return json(200, { id: match[1], status: intentStatus, payableAmount: 0, currency: 'KRW' });
      }
      if (match && match[2] === '/capture') return json(200, { status: 'CAPTURED' });
      if (match && match[2] === '/cancel') return json(200, { status: 'CANCELED' });
      return json(404, { error: 'NOT_FOUND', message: `not stubbed: ${req.method} ${url}` });
    });
    walletStub.once('error', reject);
    walletStub.listen(WALLET_PORT, '127.0.0.1', resolve);
  });

const stopWalletStub = () =>
  new Promise<void>((resolve) => {
    if (!walletStub) return resolve();
    walletStub.close(() => resolve());
  });

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: { headers: Record<string, string> };
    let jwtSecret: string;
    let pk: string;
    let regionId: string;
    let salesChannelId: string;
    let variantId: string;
    let seq = 0;
    /** 고객 이메일 유니크용 — 한 테스트(⑥)가 고객을 둘 만든다. */
    let custSeq = 0;

    afterAll(async () => {
      await stopWalletStub();
    });

    beforeAll(async () => {
      await startWalletStub();

      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      jwtSecret = config.projectConfig.http.jwtSecret;
      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: 'admin@consume.test' }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'a', app_metadata: { user_id: user.id } },
            jwtSecret,
          )}`,
        },
      };

      const { result: scRes } = await createSalesChannelsWorkflow(container).run({
        input: { salesChannelsData: [{ name: 'Consume SC' }] },
      });
      salesChannelId = scRes[0].id;

      const { result: regionRes } = await createRegionsWorkflow(container).run({
        input: { regions: [{ name: 'KR-consume', currency_code: 'krw', countries: ['kr'] }] },
      });
      regionId = regionRes[0].id;

      const fulfillment = container.resolve(Modules.FULFILLMENT);
      const profiles = await fulfillment.listShippingProfiles({});
      const shippingProfileId =
        profiles[0]?.id ??
        (await fulfillment.createShippingProfiles([{ name: 'default', type: 'default' }]))[0].id;

      const { result: prodRes } = await createProductsWorkflow(container).run({
        input: {
          products: [
            {
              title: 'Consume Product',
              status: 'published',
              shipping_profile_id: shippingProfileId,
              sales_channels: [{ id: salesChannelId }],
              options: [{ title: 'Size', values: ['M'] }],
              variants: [
                {
                  title: 'M',
                  sku: 'CONSUME-M',
                  manage_inventory: false,
                  options: { Size: 'M' },
                  prices: [{ amount: 10000, currency_code: 'krw' }],
                },
              ],
            },
          ],
        },
      });
      variantId = prodRes[0].variants[0].id;

      const { result: keyRes } = await createApiKeysWorkflow(container).run({
        input: { api_keys: [{ title: 'pk-consume', type: 'publishable', created_by: user.id }] },
      });
      await linkSalesChannelsToApiKeyWorkflow(container).run({
        input: { id: keyRes[0].id, add: [salesChannelId] },
      });
      pk = keyRes[0].token;
    });

    const metaService = () => getContainer().resolve(PROMOTION_META_MODULE) as any;

    /** 고객 하나 + 그 고객으로 인증된 스토어 헤더. */
    const newCustomer = async () => {
      custSeq++;
      const customerModule = getContainer().resolve(Modules.CUSTOMER);
      const [cust] = await customerModule.createCustomers([{ email: `consume${custSeq}@consume.test` }]);
      const custHeaders = {
        headers: {
          'x-publishable-api-key': pk,
          authorization: `Bearer ${jwt.sign(
            { actor_id: cust.id, actor_type: 'customer', auth_identity_id: 'c', app_metadata: { customer_id: cust.id } },
            jwtSecret,
          )}`,
        },
      };
      return { customerId: cust.id as string, custHeaders };
    };

    /** 발급형(assigned_only) 정률 쿠폰. 장이 사용을 지배한다 — `grantsGovernUsage` 가 true 인 쪽. */
    const createAssignedPromo = async (code: string) => {
      const res = await api.post(
        '/admin/promotions',
        {
          code, type: 'standard', is_automatic: false, status: 'active',
          application_method: { type: 'percentage', value: 10, target_type: 'order', currency_code: 'krw' },
          additional_data: { visibility: 'assigned_only' },
        },
        adminHeaders,
      );
      return res.data.promotion.id as string;
    };

    const issueGrant = (promotionId: string, customerId: string, key: string) =>
      metaService().issueGrantWithSlot({
        promotion_id: promotionId, customer_id: customerId, issue_key: key,
        issued_via: 'admin_manual', expires_at: null, now: new Date(),
        max_claims: null, enforce_cap: false,
      });

    const grantsOf = async (customerId: string) => (await metaService().listGrantsForCustomer(customerId)) as Array<any>;

    /** 고객 카트 + 쿠폰 부착 + 결제 세션까지 — `POST /store/carts/:id/complete` 직전 상태. */
    const cartReadyToComplete = async (custHeaders: { headers: Record<string, string> }, code: string) => {
      const cartRes = await api.post(
        '/store/carts',
        { region_id: regionId, sales_channel_id: salesChannelId, items: [{ variant_id: variantId, quantity: 1 }] },
        custHeaders,
      );
      const cartId = cartRes.data.cart.id as string;
      await api.post(`/store/carts/${cartId}/promotions`, { promo_codes: [code] }, custHeaders);

      // 배송은 이 스펙의 대상이 아니다 — 라인아이템을 배송 불필요로 두어 validateShippingStep 을 통과시킨다.
      const cartModule: any = getContainer().resolve(Modules.CART);
      const cartRow = await cartModule.retrieveCart(cartId, { relations: ['items'] });
      await cartModule.updateLineItems(
        (cartRow.items ?? []).map((line: any) => ({ id: line.id, requires_shipping: false })),
      );
      const pcRes = await api.post('/store/payment-collections', { cart_id: cartId }, custHeaders);
      await api.post(
        `/store/payment-collections/${pcRes.data.payment_collection.id}/payment-sessions`,
        { provider_id: 'pp_almond-payment_almond-payment' },
        custHeaders,
      );
      return cartId;
    };

    /** 완료 호출. 워크플로 엔진을 거친 에러는 Error 인스턴스가 아니므로 응답을 그대로 돌려준다. */
    const complete = async (cartId: string, custHeaders: { headers: Record<string, string> }) => {
      try {
        const res = await api.post(`/store/carts/${cartId}/complete`, {}, custHeaders);
        return { status: res.status as number, data: res.data as any };
      } catch (error: any) {
        return { status: error?.response?.status as number, data: error?.response?.data as any };
      }
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

    afterEach(() => {
      intentStatus = 'AUTHORIZED';
    });

    it('① 완료하면 장이 소모되고 cart_id 가 찍힌다 — 주문이 선다', async () => {
      seq++;
      const { customerId, custHeaders } = await newCustomer();
      const promotionId = await createAssignedPromo(`CONSUME_OK_${seq}`);
      await issueGrant(promotionId, customerId, 'k1');
      const cartId = await cartReadyToComplete(custHeaders, `CONSUME_OK_${seq}`);

      const res = await complete(cartId, custHeaders);

      expect(res.status).toBe(200);
      expect(res.data.type).toBe('order');
      const [grant] = await grantsOf(customerId);
      expect(grant.used_at).not.toBeNull();
      expect(grant.cart_id).toBe(cartId);
      expect(await orderIdForCart(cartId)).toBe(res.data.order.id);
    });

    it('② 같은 고객의 두 카트에 장 하나 — 늦은 쪽은 COUPON_EXPIRED 이고 주문이 서지 않는다 (검사 = 소모)', async () => {
      seq++;
      const { customerId, custHeaders } = await newCustomer();
      const promotionId = await createAssignedPromo(`CONSUME_RACE_${seq}`);
      await issueGrant(promotionId, customerId, 'k1');
      // 둘 다 장이 미사용일 때 붙인다 — 카트 미들웨어는 둘 다 통과시킨다. 옛 구조에선 완료도 둘 다 통과했다.
      const cartA = await cartReadyToComplete(custHeaders, `CONSUME_RACE_${seq}`);
      const cartB = await cartReadyToComplete(custHeaders, `CONSUME_RACE_${seq}`);

      const first = await complete(cartA, custHeaders);
      const second = await complete(cartB, custHeaders);

      expect(first.status).toBe(200);
      expect(second.status).toBe(400);
      expect(second.data.message).toContain('COUPON_EXPIRED');
      expect(await orderIdForCart(cartB)).toBeNull();
      const [grant] = await grantsOf(customerId);
      expect(grant.cart_id).toBe(cartA);
    });

    it('③ validate 뒤 스텝(결제 승인)이 실패하면 훅 보상이 장을 돌려놓는다', async () => {
      seq++;
      const { customerId, custHeaders } = await newCustomer();
      const promotionId = await createAssignedPromo(`CONSUME_COMP_${seq}`);
      await issueGrant(promotionId, customerId, 'k1');
      const cartId = await cartReadyToComplete(custHeaders, `CONSUME_COMP_${seq}`);

      intentStatus = 'FAILED'; // mapStatus → 'error' → 결제 모듈이 NOT_ALLOWED 로 던진다 → 워크플로 보상
      const res = await complete(cartId, custHeaders);

      expect(res.status).toBe(400);
      expect(await orderIdForCart(cartId)).toBeNull();
      const [grant] = await grantsOf(customerId);
      expect(grant.used_at).toBeNull();
      expect(grant.cart_id).toBeNull();
    });

    it('④ 완료된 카트를 다시 완료하면 200 · 같은 주문 · 장은 그대로 (already)', async () => {
      seq++;
      const { customerId, custHeaders } = await newCustomer();
      const promotionId = await createAssignedPromo(`CONSUME_AGAIN_${seq}`);
      await issueGrant(promotionId, customerId, 'k1');
      const cartId = await cartReadyToComplete(custHeaders, `CONSUME_AGAIN_${seq}`);
      const first = await complete(cartId, custHeaders);
      expect(first.status).toBe(200);

      // 옛 구조는 여기서 validate 가 «장이 이미 사용됨» 으로 COUPON_EXPIRED 를 냈다 — 주문이 있는데 거절.
      const again = await complete(cartId, custHeaders);

      expect(again.status).toBe(200);
      expect(again.data.type).toBe('order');
      expect(again.data.order.id).toBe(first.data.order.id);
      const [grant] = await grantsOf(customerId);
      expect(grant.used_at).not.toBeNull();
      expect(grant.cart_id).toBe(cartId);
    });

    it('⑤ 주문 취소 구독자는 order_cart 링크로 카트를 찾아 장을 되돌린다', async () => {
      seq++;
      const { customerId, custHeaders } = await newCustomer();
      const promotionId = await createAssignedPromo(`CONSUME_CANCEL_${seq}`);
      await issueGrant(promotionId, customerId, 'k1');
      const cartId = await cartReadyToComplete(custHeaders, `CONSUME_CANCEL_${seq}`);
      const res = await complete(cartId, custHeaders);
      expect(res.status).toBe(200);

      // 이벤트 버스(in-memory, 비동기)를 기다리지 않고 구독자를 직접 부른다 — 여기서 증명할 것은
      // 링크 조회와 복원이지 이벤트 배선이 아니다(배선은 단위 스펙 `config.event` 가 고정한다).
      await handleCouponGrantRestore({ event: { data: { id: res.data.order.id } }, container: getContainer() } as any);

      const [grant] = await grantsOf(customerId);
      expect(grant.used_at).toBeNull();
      expect(grant.cart_id).toBeNull();
    });

    it('⑥ 스위퍼는 주문 없는 소모만 되돌리고, 주문이 선 소모는 놓지 않는다', async () => {
      seq++;
      // 주문이 선 소모 — 놓으면 안 된다.
      const ordered = await newCustomer();
      const orderedPromo = await createAssignedPromo(`CONSUME_SWEEP_KEEP_${seq}`);
      await issueGrant(orderedPromo, ordered.customerId, 'k1');
      const orderedCart = await cartReadyToComplete(ordered.custHeaders, `CONSUME_SWEEP_KEEP_${seq}`);
      expect((await complete(orderedCart, ordered.custHeaders)).status).toBe(200);

      // 주문 없는 소모 — 훅이 커밋한 뒤 프로세스가 죽은 상태를 모듈 호출로 만든다.
      const stuck = await newCustomer();
      const stuckPromo = await createAssignedPromo(`CONSUME_SWEEP_STUCK_${seq}`);
      await issueGrant(stuckPromo, stuck.customerId, 'k1');
      const stuckCartRes = await api.post(
        '/store/carts',
        { region_id: regionId, sales_channel_id: salesChannelId, items: [{ variant_id: variantId, quantity: 1 }] },
        stuck.custHeaders,
      );
      const stuckCartId = stuckCartRes.data.cart.id as string;
      const outcome = await metaService().consumeOneUsableGrantForCart({
        promotion_id: stuckPromo, customer_id: stuck.customerId, cart_id: stuckCartId, now: new Date(),
      });
      expect(outcome.outcome).toBe('consumed');

      const summary = await restoreStuckCouponConsumptions(getContainer(), { minAgeMs: 0, limit: 100 });

      expect(summary.restored).toBeGreaterThanOrEqual(1);
      const [stuckGrant] = await grantsOf(stuck.customerId);
      expect(stuckGrant.used_at).toBeNull();
      expect(stuckGrant.cart_id).toBeNull();
      const [orderedGrant] = await grantsOf(ordered.customerId);
      expect(orderedGrant.used_at).not.toBeNull();
      expect(orderedGrant.cart_id).toBe(orderedCart);
    });

    it('⑦ 훅 입력 카트에서 고객 id 는 customer.id 로 읽힌다 (ADR-0034 측정 4 실측)', async () => {
      seq++;
      const { customerId, custHeaders } = await newCustomer();
      const promotionId = await createAssignedPromo(`CONSUME_FIELDS_${seq}`);
      await issueGrant(promotionId, customerId, 'k1');
      const cartId = await cartReadyToComplete(custHeaders, `CONSUME_FIELDS_${seq}`);

      // completeCartWorkflow 가 validate 훅에 넘기는 카트와 같은 필드 목록으로 읽는다.
      // 🔴 `@medusajs/core-flows` 의 package.json `exports` 는 루트(`.`)만 열어 둔다 —
      // `require('@medusajs/core-flows/dist/cart/utils/fields')` 는 jest 든 node 든
      // `Cannot find module` 이고(실측), 루트도 이 상수를 재수출하지 않는다. `exports` 를 우회하는
      // 유일한 길은 실제 파일 경로다 — 루트를 resolve 해 같은 `dist/` 안으로 들어간다.
      const fieldsModulePath = join(dirname(require.resolve('@medusajs/core-flows')), 'cart', 'utils', 'fields.js');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { completeCartFields } = require(fieldsModulePath) as { completeCartFields: string[] };
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const { data } = await query.graph({ entity: 'cart', fields: completeCartFields, filters: { id: cartId } });
      const row = data[0] as any;

      expect(row.customer?.id).toBe(customerId);
      // 최상위 customer_id 가 함께 오는지는 단언하지 않는다 — 측정값이다. 리포트에 적는다.
      // eslint-disable-next-line no-console
      console.info(`[measure] completeCartFields row has top-level customer_id: ${typeof row.customer_id === 'string'}`);
    });
  },
});
