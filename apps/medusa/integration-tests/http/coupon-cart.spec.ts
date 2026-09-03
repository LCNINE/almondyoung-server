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
import { PROMOTION_META_MODULE } from '../../src/modules/promotion-meta';

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

    /** `createAssignedOnlyPromo` 의 일반화 — additional_data 를 그대로 넘긴다(coupon-grant.spec.ts 관례). */
    const createPromo = async (code: string, additional_data: Record<string, unknown>) => {
      const res = await api.post(
        '/admin/promotions',
        {
          code, type: 'standard', is_automatic: false, status: 'active',
          application_method: { type: 'percentage', value: 50, target_type: 'order', currency_code: 'krw' },
          additional_data,
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
      // 게이트의 정본이 Task 5(#488 G5~G7)로 grant 로 옮겨갔다 — 「할당됨」은 이제 링크 행이
      // 아니라 coupon_grant 행으로 판정한다(실제 발급 라우트가 그렇게 쓴다).
      const service = getContainer().resolve(PROMOTION_META_MODULE) as any;
      await service.issueGrant({
        promotion_id: promoId, customer_id: customerId, issue_key: `gateok_${seq}`,
        issued_via: 'admin_manual', expires_at: null, now: new Date(),
      });
      const res = await api.post(`/store/carts/${cartId}/promotions`, { promo_codes: [`GATEOK_${seq}`] }, custHeaders);
      expect(res.status).toEqual(200);
      expect(res.data.cart.discount_total).toBeGreaterThan(0);
    });

    it('gate: assigned_only coupon is BLOCKED when attached at CART CREATE time (bypass fix)', async () => {
      seq++;
      // 수정 전: POST /store/carts 는 게이트가 없어 promo_codes 로 미할당 쿠폰을 붙여 우회 가능.
      // 수정 후: create 경로에도 게이트가 걸려 차단된다.
      await createAssignedOnlyPromo(`GATECREATE_${seq}`);
      const customerModule = getContainer().resolve(Modules.CUSTOMER);
      const [cust] = await customerModule.createCustomers([{ email: `create${seq}@cart.test` }]);
      const custHeaders = {
        headers: {
          'x-publishable-api-key': pk,
          authorization: `Bearer ${jwt.sign(
            { actor_id: cust.id, actor_type: 'customer', auth_identity_id: 'c', app_metadata: { customer_id: cust.id } },
            jwtSecret,
          )}`,
        },
      };
      await expect(
        api.post(
          '/store/carts',
          {
            region_id: regionId,
            sales_channel_id: salesChannelId,
            items: [{ variant_id: variantId, quantity: 1 }],
            promo_codes: [`GATECREATE_${seq}`],
          },
          custHeaders,
        ),
      ).rejects.toMatchObject({ response: { status: 400, data: { message: 'COUPON_NOT_ASSIGNED' } } });
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

    it('gate: 메타 행이 아예 없는 쿠폰은 «공개» 가 아니라 차단된다 (#488 N7 닫힌 기본값)', async () => {
      seq++;
      // additional_data 를 통째로 생략하면 검증기를 통과하고 promotion_meta 가 0행이 된다
      // (프레임워크가 z.object(shape).nullish() 로 감싸므로 객체 자체는 선택이다 — 실측).
      // 옛 기본값 'public' 이면 이 쿠폰은 아무나 쓸 수 있었다.
      const code = `NOMETA_${seq}`;
      await api.post(
        '/admin/promotions',
        {
          code, type: 'standard', is_automatic: false, status: 'active',
          application_method: { type: 'percentage', value: 50, target_type: 'order', currency_code: 'krw' },
        },
        adminHeaders,
      );

      const { cartId, custHeaders } = await newCustomerCart();
      await expect(
        api.post(`/store/carts/${cartId}/promotions`, { promo_codes: [code] }, custHeaders),
      ).rejects.toMatchObject({ response: { status: 400, data: { message: 'COUPON_NOT_ASSIGNED' } } });
    });

    it('G6: 쓸 수 있는 장이 없으면 카트에 붙지 않는다', async () => {
      seq++;
      const { cartId, custHeaders, customerId } = await newCustomerCart();
      const promotionId = await createPromo(`SPENT_${seq}`, { visibility: 'assigned_only' });
      const service = getContainer().resolve(PROMOTION_META_MODULE) as any;

      // 한 장 발급한 뒤 그 장을 소모시킨다 — 체크아웃 없이 「다 쓴 상태」를 만든다.
      await service.issueGrant({
        promotion_id: promotionId, customer_id: customerId, issue_key: 'k1',
        issued_via: 'admin_manual', expires_at: null, now: new Date(),
      });
      const [grant] = await service.listGrantsForCustomer(customerId);
      await service.consumeGrantIfUnused(grant.id, 'order_spent', new Date());

      const res = await api
        .post(`/store/carts/${cartId}/promotions`, { promo_codes: [`SPENT_${seq}`] }, custHeaders)
        .catch((e: any) => e.response);

      expect(res.status).toBe(400);
      expect(res.data.message).toBe('COUPON_EXPIRED');
    });

    it('G5: 2장 중 1장을 써도 남은 장으로 계속 붙는다', async () => {
      seq++;
      const { cartId, custHeaders, customerId } = await newCustomerCart();
      const promotionId = await createPromo(`TWO_${seq}`, { visibility: 'assigned_only' });
      const service = getContainer().resolve(PROMOTION_META_MODULE) as any;

      for (const key of ['k1', 'k2']) {
        await service.issueGrant({
          promotion_id: promotionId, customer_id: customerId, issue_key: key,
          issued_via: 'admin_manual', expires_at: null, now: new Date(),
        });
      }
      const grants = await service.listGrantsForCustomer(customerId);
      await service.consumeGrantIfUnused(grants[0].id, 'order_one', new Date());

      const res = await api.post(
        `/store/carts/${cartId}/promotions`,
        { promo_codes: [`TWO_${seq}`] },
        custHeaders,
      );

      expect(res.status).toBe(200);
      expect(res.data.cart.discount_total).toBeGreaterThan(0);
    });

    it('발급받지 않은 assigned_only 쿠폰은 여전히 거절된다 — 회귀 방지', async () => {
      seq++;
      const { cartId, custHeaders } = await newCustomerCart();
      await createPromo(`NONE_${seq}`, { visibility: 'assigned_only' });

      const res = await api
        .post(`/store/carts/${cartId}/promotions`, { promo_codes: [`NONE_${seq}`] }, custHeaders)
        .catch((e: any) => e.response);

      expect(res.status).toBe(400);
      expect(res.data.message).toBe('COUPON_NOT_ASSIGNED');
    });

    it('A2: public 쿠폰은 장을 다 써도 계속 붙는다 — 그 고객«만» 잠기지 않게', async () => {
      // 🔴 발급 3경로가 `public` 을 거절하므로 이 상태는 보통 안 생긴다. 그런데
      // **발급이 끝난 뒤 visibility 를 public 으로 바꾸면** 발급 시점 검사로는 못 잡는다 —
      // 그 순간 이미 발급받은 고객만 1회 제한에 걸리고 나머지는 무제한이 된다.
      // 위 G6 와 정확히 같은 상황(장 하나를 발급하고 소모)인데 visibility 만 다르다.
      seq++;
      const { cartId, custHeaders, customerId } = await newCustomerCart();
      const promotionId = await createPromo(`PUBSPENT_${seq}`, { visibility: 'public' });
      const service = getContainer().resolve(PROMOTION_META_MODULE) as any;

      await service.issueGrant({
        promotion_id: promotionId, customer_id: customerId, issue_key: 'k1',
        issued_via: 'admin_manual', expires_at: null, now: new Date(),
      });
      const [grant] = await service.listGrantsForCustomer(customerId);
      await service.consumeGrantIfUnused(grant.id, 'order_pub_spent', new Date());

      const res = await api.post(
        `/store/carts/${cartId}/promotions`,
        { promo_codes: [`PUBSPENT_${seq}`] },
        custHeaders,
      );

      expect(res.status).toBe(200);
      expect(res.data.cart.discount_total).toBeGreaterThan(0);
    });
  },
});
