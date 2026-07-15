import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import jwt from 'jsonwebtoken';
import {
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createProductCategoriesWorkflow,
  createCollectionsWorkflow,
  createProductsWorkflow,
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from '@medusajs/core-flows';

jest.setTimeout(180 * 1000);

/**
 * P0-1 검증: items.product.categories.id / collection_id / product.id 타겟 룰이
 * 실제 카트 라인아이템에 할인을 적용하는지 end-to-end 로 확인한다.
 * (플랫 키 product_category_id 였다면 매칭 0 → 할인 0 이었을 것)
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
    let categoryId: string;
    let collectionId: string;
    let productId: string;
    let seq = 0;

    beforeAll(async () => {
      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;
      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: 'admin@cart.test' }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'a', app_metadata: { user_id: user.id } },
            secret,
          )}`,
        },
      };

      const { result: scRes } = await createSalesChannelsWorkflow(container).run({
        input: { salesChannelsData: [{ name: 'Cart SC' }] },
      });
      salesChannelId = scRes[0].id;

      const { result: regionRes } = await createRegionsWorkflow(container).run({
        input: { regions: [{ name: 'KR', currency_code: 'krw', countries: ['kr'] }] },
      });
      regionId = regionRes[0].id;

      const { result: catRes } = await createProductCategoriesWorkflow(container).run({
        input: { product_categories: [{ name: 'Target Cat', is_active: true }] },
      });
      categoryId = catRes[0].id;

      const { result: colRes } = await createCollectionsWorkflow(container).run({
        input: { collections: [{ title: 'Target Col' }] },
      });
      collectionId = colRes[0].id;

      const fulfillment = container.resolve(Modules.FULFILLMENT);
      const profiles = await fulfillment.listShippingProfiles({});
      const shippingProfileId =
        profiles[0]?.id ??
        (await fulfillment.createShippingProfiles([{ name: 'default', type: 'default' }]))[0].id;

      const { result: prodRes } = await createProductsWorkflow(container).run({
        input: {
          products: [
            {
              title: 'Target Product',
              status: 'published',
              category_ids: [categoryId],
              collection_id: collectionId,
              shipping_profile_id: shippingProfileId,
              sales_channels: [{ id: salesChannelId }],
              options: [{ title: 'Size', values: ['M'] }],
              variants: [
                {
                  title: 'M',
                  sku: 'TARGET-M',
                  manage_inventory: false,
                  options: { Size: 'M' },
                  prices: [{ amount: 10000, currency_code: 'krw' }],
                },
              ],
            },
          ],
        },
      });
      productId = prodRes[0].id;
      variantId = prodRes[0].variants[0].id;

      const { result: keyRes } = await createApiKeysWorkflow(container).run({
        input: { api_keys: [{ title: 'pk-cart', type: 'publishable', created_by: user.id }] },
      });
      const pkToken = keyRes[0].token;
      await linkSalesChannelsToApiKeyWorkflow(container).run({
        input: { id: keyRes[0].id, add: [salesChannelId] },
      });
      storeHeaders = { headers: { 'x-publishable-api-key': pkToken } };
      pk = pkToken;
      jwtSecret = secret;
    });

    let pk: string;
    let jwtSecret: string;

    // 인증된 고객 컨텍스트로 카트 생성/적용 (per-customer-limit 게이트 검증용)
    const newCustomerCart = async () => {
      const customerModule = getContainer().resolve(Modules.CUSTOMER);
      const [cust] = await customerModule.createCustomers([{ email: `gate${seq}@cart.test` }]);
      const custHeaders = {
        headers: {
          'x-publishable-api-key': pk,
          authorization: `Bearer ${jwt.sign(
            { actor_id: cust.id, actor_type: 'customer', auth_identity_id: 'c', app_metadata: { customer_id: cust.id } },
            jwtSecret,
          )}`,
        },
      };
      const res = await api.post(
        '/store/carts',
        { region_id: regionId, sales_channel_id: salesChannelId, items: [{ variant_id: variantId, quantity: 1 }] },
        custHeaders,
      );
      return { cartId: res.data.cart.id as string, custHeaders, customerId: cust.id };
    };

    const createAssignedOnlyPromo = async (code: string) => {
      const res = await api.post(
        '/admin/promotions',
        {
          code, type: 'standard', is_automatic: false, status: 'active',
          application_method: { type: 'percentage', value: 50, target_type: 'order', currency_code: 'krw' },
          additional_data: { visibility: 'assigned_only' },
        },
        adminHeaders,
      );
      return res.data.promotion.id as string;
    };

    const createTargetPromo = async (code: string, attribute: string, values: string[]) => {
      const res = await api.post(
        '/admin/promotions',
        {
          code,
          type: 'standard',
          is_automatic: false,
          status: 'active',
          application_method: {
            type: 'percentage',
            value: 50,
            target_type: 'items',
            allocation: 'across',
            currency_code: 'krw',
            target_rules: [{ attribute, operator: 'in', values }],
          },
          additional_data: { visibility: 'public' },
        },
        adminHeaders,
      );
      return res.data.promotion.id as string;
    };

    const newCartWithItem = async () => {
      const res = await api.post(
        '/store/carts',
        { region_id: regionId, sales_channel_id: salesChannelId, items: [{ variant_id: variantId, quantity: 1 }] },
        storeHeaders,
      );
      return res.data.cart.id as string;
    };

    const applyAndGetDiscount = async (cartId: string, code: string) => {
      const res = await api.post(`/store/carts/${cartId}/promotions`, { promo_codes: [code] }, storeHeaders);
      return res.data.cart.discount_total as number;
    };

    it('category target rule (items.product.categories.id) discounts the matching item (P0-1)', async () => {
      seq++;
      await createTargetPromo(`CAT_${seq}`, 'items.product.categories.id', [categoryId]);
      const cartId = await newCartWithItem();
      const discount = await applyAndGetDiscount(cartId, `CAT_${seq}`);
      expect(discount).toBeGreaterThan(0); // 5000 (50% of 10000)
    });

    it('collection target rule (items.product.collection_id) discounts the matching item (P0-1)', async () => {
      seq++;
      await createTargetPromo(`COL_${seq}`, 'items.product.collection_id', [collectionId]);
      const cartId = await newCartWithItem();
      const discount = await applyAndGetDiscount(cartId, `COL_${seq}`);
      expect(discount).toBeGreaterThan(0);
    });

    it('product target rule (items.product.id) discounts the matching item', async () => {
      seq++;
      await createTargetPromo(`PROD_${seq}`, 'items.product.id', [productId]);
      const cartId = await newCartWithItem();
      const discount = await applyAndGetDiscount(cartId, `PROD_${seq}`);
      expect(discount).toBeGreaterThan(0);
    });

    it('NEGATIVE control: a category rule for a DIFFERENT category yields no discount', async () => {
      seq++;
      const { result } = await createProductCategoriesWorkflow(getContainer()).run({
        input: { product_categories: [{ name: `Other ${seq}`, is_active: true }] },
      });
      await createTargetPromo(`NEG_${seq}`, 'items.product.categories.id', [result[0].id]);
      const cartId = await newCartWithItem();
      const discount = await applyAndGetDiscount(cartId, `NEG_${seq}`);
      expect(discount).toEqual(0);
    });

    it('gate: assigned_only coupon is BLOCKED for a non-assigned customer (7-9/P2-5)', async () => {
      seq++;
      await createAssignedOnlyPromo(`GATE_${seq}`);
      const { cartId, custHeaders } = await newCustomerCart();
      await expect(
        api.post(`/store/carts/${cartId}/promotions`, { promo_codes: [`GATE_${seq}`] }, custHeaders),
      ).rejects.toMatchObject({ response: { status: 400, data: { message: 'COUPON_NOT_ASSIGNED' } } });
    });

    it('gate: assigned_only coupon is ALLOWED once the customer is assigned', async () => {
      seq++;
      const promoId = await createAssignedOnlyPromo(`GATEOK_${seq}`);
      const { cartId, custHeaders, customerId } = await newCustomerCart();
      const remoteLink = getContainer().resolve(ContainerRegistrationKeys.REMOTE_LINK) as any;
      await remoteLink.create([
        { [Modules.CUSTOMER]: { customer_id: customerId }, [Modules.PROMOTION]: { promotion_id: promoId } },
      ]);
      const res = await api.post(`/store/carts/${cartId}/promotions`, { promo_codes: [`GATEOK_${seq}`] }, custHeaders);
      expect(res.status).toEqual(200);
      expect(res.data.cart.discount_total).toBeGreaterThan(0);
    });

    it('gate: normalized middleware enforces the gate even for a lowercase code (P2-4)', async () => {
      seq++;
      // assigned_only 쿠폰에 고객 미할당. 소문자 코드로 적용 시도.
      // 수정 전: 미들웨어가 raw(소문자) 조회 실패 → 게이트 skip(우회). 수정 후: 대문자화해 게이트가 차단.
      await createAssignedOnlyPromo(`GATELOW_${seq}`);
      const { cartId, custHeaders } = await newCustomerCart();
      await expect(
        api.post(`/store/carts/${cartId}/promotions`, { promo_codes: [`gatelow_${seq}`] }, custHeaders),
      ).rejects.toMatchObject({ response: { status: 400, data: { message: 'COUPON_NOT_ASSIGNED' } } });
    });
  },
});
