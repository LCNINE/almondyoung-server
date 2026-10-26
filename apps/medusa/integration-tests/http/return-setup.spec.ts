// apps/medusa/integration-tests/http/return-setup.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { createOrderFulfillmentWorkflow, createShippingOptionsWorkflow } from '@medusajs/core-flows';
import {
  ALMOND_FULFILLMENT_PROVIDER_ID,
  ensureKoreanShippingInfrastructure,
  listShippingGroups,
  provisionShippingGroup,
} from '../../src/modules/almond-fulfillment/provision-shipping-group';
import {
  RETURN_SHIPPING_OPTION_PURPOSE,
  RETURN_SHIPPING_PROFILE_TYPE,
  ensureReturnShippingOption,
  findReturnShippingOptionId,
} from '../../src/modules/almond-fulfillment/return-shipping-option';
import { DEFAULT_SHIPPING_GROUP_DELIVERY } from '../../src/modules/almond-fulfillment/types';
import {
  FakeWallet, WALLET_BASE_URL, setupCommerce, requestReturnWithShipping, placeOrder, loadOrder, Commerce,
} from './fixtures/partial-cancel-fixture';

jest.setTimeout(300 * 1000);
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';
const wallet = new FakeWallet();

/** 반품이 쓸 배송 옵션·사유의 보장(K8 PR2). 케이스들이 한 DB 를 이어 쓰므로 순서에 기댄다. */
medusaIntegrationTestRunner({
  inApp: true,
  env: { WALLET_BASE_URL, WALLET_API_KEY: 'test-wallet-key' },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let c: Commerce;
    let groupCountBefore: number;
    const ctx = { api, getContainer };
    beforeAll(async () => {
      await wallet.start();
      c = await setupCommerce(ctx);
      groupCountBefore = (await listShippingGroups(getContainer())).length;
    });
    afterAll(async () => wallet.stop());

    const returnProfileOptions = async () => {
      const fulfillment = getContainer().resolve(Modules.FULFILLMENT);
      const [profile] = await fulfillment.listShippingProfiles({ type: RETURN_SHIPPING_PROFILE_TYPE });
      if (!profile) return [];
      return fulfillment.listShippingOptions({ shipping_profile_id: profile.id }, { relations: ['rules'] });
    };

    it('ensureReturnShippingOption 은 두 번 불러도 옵션 하나, 같은 id', async () => {
      const first = await ensureReturnShippingOption(getContainer());
      const second = await ensureReturnShippingOption(getContainer());
      expect(second).toBe(first);

      const options = await returnProfileOptions();
      expect(options).toHaveLength(1);
      const [option] = options;
      expect(option.id).toBe(first);
      expect(option.provider_id).toBe(ALMOND_FULFILLMENT_PROVIDER_ID);
      expect(option.price_type).toBe('flat');
      const rules = option.rules.map((r: any) => [r.attribute, r.operator, r.value]);
      expect(rules).toEqual(expect.arrayContaining([['is_return', 'eq', 'true'], ['enabled_in_store', 'eq', 'false']]));
    });

    it('listShippingGroups 에 반품 옵션이 안 나온다', async () => {
      const returnOptionId = await findReturnShippingOptionId(getContainer());
      const groups = await listShippingGroups(getContainer());
      expect(groups.map((g) => g.shippingOptionId)).not.toContain(returnOptionId);
      expect(groups).toHaveLength(groupCountBefore);
    });

    it('그룹을 새로 만들고 기존 그룹을 고쳐도 반품 옵션이 남는다', async () => {
      const before = await findReturnShippingOptionId(getContainer());
      await provisionShippingGroup(getContainer(), {
        code: 'rs-new', name: '새 그룹', policy: { type: 'flat', baseFee: 4000 }, delivery: DEFAULT_SHIPPING_GROUP_DELIVERY,
      });
      await provisionShippingGroup(getContainer(), {
        code: c.groups.cond.code, name: '조건부', policy: { type: 'conditional_free', baseFee: 3500, freeThreshold: 50000 },
        delivery: DEFAULT_SHIPPING_GROUP_DELIVERY,
      });
      expect(await findReturnShippingOptionId(getContainer())).toBe(before);
      expect(await returnProfileOptions()).toHaveLength(1);
    });

    it('시드된 옵션으로 반품 요청을 확정하면 almond 반품 fulfillment 가 생긴다', async () => {
      const container = getContainer();
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] });
      const itemId = (await loadOrder(container, orderId)).items[0].id;
      await createOrderFulfillmentWorkflow(container).run({ input: { order_id: orderId, items: [{ id: itemId, quantity: 1 }] } });
      const returnOptionId = (await findReturnShippingOptionId(container))!;

      const returnId = await requestReturnWithShipping(container, { orderId, itemId, quantity: 1, returnOptionId, shippingAmount: 0 });

      const query = container.resolve(ContainerRegistrationKeys.QUERY);
      const { data: [ret] } = await query.graph({
        entity: 'return', fields: ['id', 'status', 'fulfillments.provider_id'], filters: { id: returnId },
      });
      expect(ret.status).toBe('requested');
      expect(ret.fulfillments.map((f: any) => f.provider_id)).toEqual([ALMOND_FULFILLMENT_PROVIDER_ID]);
      const { data: [order] } = await query.graph({
        entity: 'order', fields: ['id', 'payment_collections.status'], filters: { id: orderId },
      });
      expect(order.payment_collections.filter((pc: any) => pc.status === 'not_paid')).toHaveLength(0);
    });

    it('카트 배송 옵션에 반품 옵션이 안 나온다', async () => {
      const returnOptionId = await findReturnShippingOptionId(getContainer());
      const cart = await api.post('/store/carts', {
        region_id: c.regionId, sales_channel_id: c.salesChannelId,
        items: [{ variant_id: c.variants.A, quantity: 1 }],
        shipping_address: { country_code: 'kr', postal_code: '04524', address_1: '서울', city: '서울' },
      }, c.storeHeaders);
      const res = await api.get(`/store/shipping-options?cart_id=${cart.data.cart.id}`, c.storeHeaders);
      const ids = res.data.shipping_options.map((o: any) => o.id);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids).not.toContain(returnOptionId);
    });

    it('옵션이 둘이어도 가장 오래된 하나를 고른다 — 부팅이 겹쳐 시드가 두 번 만든 경우', async () => {
      const container = getContainer();
      const first = await findReturnShippingOptionId(container);
      const [profile] = await container.resolve(Modules.FULFILLMENT).listShippingProfiles({ type: RETURN_SHIPPING_PROFILE_TYPE });
      const { serviceZoneId } = await ensureKoreanShippingInfrastructure(container);
      await createShippingOptionsWorkflow(container).run({
        input: [{
          name: '반품 회수', price_type: 'flat', provider_id: ALMOND_FULFILLMENT_PROVIDER_ID, service_zone_id: serviceZoneId,
          shipping_profile_id: profile.id, type: { label: '반품 회수', description: '고객 반품 회수', code: 'return' },
          prices: [{ currency_code: 'krw', amount: 0 }], data: { purpose: RETURN_SHIPPING_OPTION_PURPOSE },
          rules: [
            { attribute: 'enabled_in_store', value: 'false', operator: 'eq' },
            { attribute: 'is_return', value: 'true', operator: 'eq' },
          ],
        }],
      });
      expect(await returnProfileOptions()).toHaveLength(2);
      expect(await findReturnShippingOptionId(container)).toBe(first);
    });
  },
});
