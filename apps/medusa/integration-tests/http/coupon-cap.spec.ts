import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { createServer, Server } from 'http';
import jwt from 'jsonwebtoken';
import {
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createProductsWorkflow,
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from '@medusajs/core-flows';
import { PROMOTION_META_MODULE } from '../../src/modules/promotion-meta';

jest.setTimeout(180 * 1000);

/**
 * 백스톱 테스트 하나만을 위한 **최소** wallet 스텁.
 *
 * `completeCartWorkflow` 는 `validateCartPaymentsStep`(`complete-cart.js:285`)에서 결제 세션을
 * 요구하고, 그건 우리 백스톱 훅(`:291`)보다 **먼저** 돈다. 세션을 만들려면 결제 프로바이더의
 * `initiatePayment` 가 성공해야 하는데 그게 wallet 을 부른다.
 *
 * 필요한 것은 `POST /v1/payment-intents` **하나**다 — 백스톱이 그보다 뒤·승인보다 앞에서
 * 던지므로 `authorizePayment` 는 영원히 안 불린다. `deferred-approval-checkout.spec.ts` 의
 * 완전한 FakeWallet 을 복제하지 않는 이유다.
 */
// 🔴 포트를 상수로 박으면 안 된다. jest 가 "Force exiting" 으로 끝나면 앞 실행의 리스너가
// 잠깐 살아남아 다음 실행이 EADDRINUSE 로 **전 스펙** 실패한다(실측). pid 로 흩어 놓으면
// 죽은 프로세스의 포트를 다시 잡을 일이 없다. 이 값은 앱 부팅(=프로바이더 생성)보다 먼저
// 정해져야 하므로 모듈 로드 시점에 계산한다 — beforeAll 은 이미 늦다.
const WALLET_PORT = 39100 + (process.pid % 400);
const WALLET_BASE_URL = `http://127.0.0.1:${WALLET_PORT}`;
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';

let walletStub: Server | undefined;
let intentSeq = 0;

const startWalletStub = () =>
  new Promise<void>((resolve, reject) => {
    walletStub = createServer((req, res) => {
      if (req.method === 'POST' && (req.url ?? '').startsWith('/v1/payment-intents')) {
        intentSeq += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: `pi_cap_${intentSeq}`, status: 'REQUIRES_ACTION' }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'not stubbed' }));
    });
    walletStub.once('error', reject);
    walletStub.listen(WALLET_PORT, '127.0.0.1', resolve);
  });

const stopWalletStub = () =>
  new Promise<void>((resolve) => {
    if (!walletStub) return resolve();
    walletStub.close(() => resolve());
  });

/**
 * #488 A4 / P10-B — 정률 쿠폰 최대 할인금액이 **실제로 강제되는가**.
 *
 * 엔진에는 상한 개념이 없으므로 이 스펙이 빨개지면 「캡이 안 걸린다」가 아니라
 * 「캡을 거는 자리가 사라졌다」는 뜻이다(Medusa 업그레이드가 재계산 경로를 옮겼을 때).
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: { headers: Record<string, string> };
    let storeHeaders: { headers: Record<string, string> };
    let regionId: string;
    let salesChannelId: string;
    let variantId: string;
    let seq = 0;

    afterAll(async () => {
      await stopWalletStub();
    });

    beforeAll(async () => {
      await startWalletStub();

      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;
      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: 'admin@cap.test' }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'a', app_metadata: { user_id: user.id } },
            secret,
          )}`,
        },
      };

      const { result: scRes } = await createSalesChannelsWorkflow(container).run({
        input: { salesChannelsData: [{ name: 'Cap SC' }] },
      });
      salesChannelId = scRes[0].id;

      const { result: regionRes } = await createRegionsWorkflow(container).run({
        input: { regions: [{ name: 'KR', currency_code: 'krw', countries: ['kr'] }] },
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
              title: 'Cap Product',
              status: 'published',
              shipping_profile_id: shippingProfileId,
              sales_channels: [{ id: salesChannelId }],
              options: [{ title: 'Size', values: ['M'] }],
              variants: [
                {
                  title: 'M',
                  sku: 'CAP-M',
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
        input: { api_keys: [{ title: 'pk-cap', type: 'publishable', created_by: user.id }] },
      });
      await linkSalesChannelsToApiKeyWorkflow(container).run({
        input: { id: keyRes[0].id, add: [salesChannelId] },
      });
      storeHeaders = { headers: { 'x-publishable-api-key': keyRes[0].token } };
    });

    /** 정률 쿠폰 + 캡. `additional_data.max_discount_amount` 는 P10-A 배선을 그대로 탄다. */
    const createCappedPromo = async (code: string, percent: number, cap: number | null) => {
      const res = await api.post(
        '/admin/promotions',
        {
          code,
          type: 'standard',
          is_automatic: false,
          status: 'active',
          application_method: { type: 'percentage', value: percent, target_type: 'order', currency_code: 'krw' },
          additional_data: {
            visibility: 'public',
            ...(cap != null ? { max_discount_amount: cap } : {}),
          },
        },
        adminHeaders,
      );
      return res.data.promotion.id as string;
    };

    const newCart = async (quantity: number, promoCodes?: string[]) => {
      const res = await api.post(
        '/store/carts',
        {
          region_id: regionId,
          sales_channel_id: salesChannelId,
          items: [{ variant_id: variantId, quantity }],
          ...(promoCodes ? { promo_codes: promoCodes } : {}),
        },
        storeHeaders,
      );
      return res.data.cart;
    };

    it('캡이 저장된다 (P10-A 쓰기 배선 확인)', async () => {
      seq++;
      const promotionId = await createCappedPromo(`CAP_SAVE_${seq}`, 10, 3000);
      const metaService = getContainer().resolve(PROMOTION_META_MODULE) as any;
      const meta = await metaService.getByPromotionId(promotionId);
      expect(Number(meta.max_discount_amount)).toBe(3000);
    });

    it('캡 미만이면 할인이 그대로다', async () => {
      seq++;
      await createCappedPromo(`CAP_UNDER_${seq}`, 10, 3000);
      // 10,000원 × 1개 → 10% = 1,000원. 캡 3,000원 미만.
      const cart = await newCart(1);
      const res = await api.post(
        `/store/carts/${cart.id}`,
        { promo_codes: [`CAP_UNDER_${seq}`] },
        storeHeaders,
      );
      expect(res.data.cart.discount_total).toBe(1000);
    });

    it('캡을 넘으면 할인이 정확히 캡이다 (POST /store/carts/:id — 스토어프론트 경로)', async () => {
      seq++;
      await createCappedPromo(`CAP_OVER_${seq}`, 50, 3000);
      // 10,000원 × 5개 = 50,000원 → 50% = 25,000원. 캡 3,000원.
      const cart = await newCart(5);
      const res = await api.post(
        `/store/carts/${cart.id}`,
        { promo_codes: [`CAP_OVER_${seq}`] },
        storeHeaders,
      );
      expect(res.data.cart.discount_total).toBe(3000);
    });

    it('캡이 없는 정률 쿠폰은 깎이지 않는다 (음성 대조)', async () => {
      seq++;
      await createCappedPromo(`CAP_NONE_${seq}`, 50, null);
      const cart = await newCart(5);
      const res = await api.post(
        `/store/carts/${cart.id}`,
        { promo_codes: [`CAP_NONE_${seq}`] },
        storeHeaders,
      );
      expect(res.data.cart.discount_total).toBe(25000);
    });

    it('카트 생성 시 promo_codes 로 붙여도 캡이 걸린다 (createCartWorkflow.cartCreated)', async () => {
      seq++;
      await createCappedPromo(`CAP_CREATE_${seq}`, 50, 3000);
      const cart = await newCart(5, [`CAP_CREATE_${seq}`]);
      const res = await api.get(`/store/carts/${cart.id}`, storeHeaders);
      expect(res.data.cart.discount_total).toBe(3000);
    });

    it('캡 적용 뒤 카트를 또 건드려도 금액이 진동하지 않는다 (멱등)', async () => {
      seq++;
      await createCappedPromo(`CAP_IDEM_${seq}`, 50, 3000);
      const cart = await newCart(5);
      await api.post(`/store/carts/${cart.id}`, { promo_codes: [`CAP_IDEM_${seq}`] }, storeHeaders);
      const again = await api.post(`/store/carts/${cart.id}`, { email: 'idem@cap.test' }, storeHeaders);
      expect(again.data.cart.discount_total).toBe(3000);
    });

    it('POST /store/carts/:id/promotions 로 붙여도 캡이 걸린다 (코어 라우트 자리)', async () => {
      seq++;
      await createCappedPromo(`CAP_ROUTE_${seq}`, 50, 3000);
      const cart = await newCart(5);
      const res = await api.post(
        `/store/carts/${cart.id}/promotions`,
        { promo_codes: [`CAP_ROUTE_${seq}`] },
        storeHeaders,
      );
      expect(res.data.cart.discount_total).toBe(3000);
    });

    it('DELETE /store/carts/:id/promotions 는 쿠폰을 떼고 할인을 0 으로 돌린다', async () => {
      seq++;
      await createCappedPromo(`CAP_DEL_${seq}`, 50, 3000);
      const cart = await newCart(5);
      await api.post(
        `/store/carts/${cart.id}/promotions`,
        { promo_codes: [`CAP_DEL_${seq}`] },
        storeHeaders,
      );
      const res = await api.delete(`/store/carts/${cart.id}/promotions`, {
        ...storeHeaders,
        data: { promo_codes: [`CAP_DEL_${seq}`] },
      });
      expect(res.data.cart.discount_total).toBe(0);
    });

    it('백스톱: 캡을 넘은 카트는 주문이 만들어지지 않는다', async () => {
      seq++;
      await createCappedPromo(`CAP_BACKSTOP_${seq}`, 50, 3000);
      const cart = await newCart(5);
      await api.post(
        `/store/carts/${cart.id}`,
        { promo_codes: [`CAP_BACKSTOP_${seq}`], email: 'backstop@cap.test' },
        storeHeaders,
      );

      // 캡을 우회한 상태를 인위적으로 만든다 — adjustment 를 캡 이전 금액으로 되돌린다.
      // 정상 경로로는 이 상태를 만들 수 없으므로(그게 이 플랜의 요점) 직접 심는다.
      const container = getContainer();
      const query = container.resolve(ContainerRegistrationKeys.QUERY);
      const { data: carts } = await query.graph({
        entity: 'cart',
        fields: ['id', 'items.id', 'items.adjustments.id'],
        filters: { id: cart.id },
      });
      const item = (carts[0] as any).items[0];
      const cartModule: any = container.resolve(Modules.CART);
      await cartModule.upsertLineItemAdjustments([
        { id: item.adjustments[0].id, item_id: item.id, amount: 25000 },
      ]);

      // 백스톱(`complete-cart.js:291`)보다 앞선 `validateCartPaymentsStep`(`:285`)을 통과시킨다.
      // 배송도 마찬가지 이유로 비활성화 — 이 테스트의 대상은 캡 검사이지 체크아웃 전체가 아니다.
      const cartRow = await cartModule.retrieveCart(cart.id, { relations: ['items'] });
      await cartModule.updateLineItems(
        (cartRow.items ?? []).map((line: any) => ({ id: line.id, requires_shipping: false })),
      );
      const pcRes = await api.post('/store/payment-collections', { cart_id: cart.id }, storeHeaders);
      await api.post(
        `/store/payment-collections/${pcRes.data.payment_collection.id}/payment-sessions`,
        { provider_id: 'pp_almond-payment_almond-payment' },
        storeHeaders,
      );

      // 🔴 워크플로 엔진을 거친 에러는 Error 인스턴스가 아니다 — .rejects.toThrow() 를 쓰지 말 것.
      let message = '';
      try {
        await api.post(`/store/carts/${cart.id}/complete`, {}, storeHeaders);
      } catch (error: any) {
        message = error?.response?.data?.message ?? error?.message ?? '';
      }
      expect(message).toContain('쿠폰 할인 한도');
    });
  },
});
