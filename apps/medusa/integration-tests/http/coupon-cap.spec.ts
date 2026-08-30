import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
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

    beforeAll(async () => {
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
  },
});
