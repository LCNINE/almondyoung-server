import { createServer, type Server } from 'http';
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import {
  createApiKeysWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from '@medusajs/core-flows';
import jwt from 'jsonwebtoken';
import { defaultSaleDisplay, defaultTimeSaleSettings } from '../../../../packages/domain-types/time-sale';

jest.setTimeout(180 * 1000);

type Headers = { headers: Record<string, string> };

const REGULAR = 10000;

const GENERAL_SALE = 8000;

const MEMBERSHIP_SALE = 7000;

const MEMBERSHIP_METADATA = 9000;

const TIER_PRICE = 9500;

const STALE_GENERAL_SALE = 9800;

const SALE_NUMBERS = new RegExp(`\\b(${GENERAL_SALE}|${MEMBERSHIP_SALE}|${MEMBERSHIP_METADATA})\\b`);

const PRODUCT_FIELDS = '*variants.calculated_price,*variants.prices,+variants.metadata,+metadata';

const WALLET_PORT = 39900 + (process.pid % 90);

process.env.WALLET_BASE_URL = `http://127.0.0.1:${WALLET_PORT}`;
process.env.WALLET_API_KEY = 'test-wallet-key';

let walletStub: Server | undefined;

let intentSeq = 0;

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
        return json(200, { id: `pi_privacy_${intentSeq}`, status: 'REQUIRES_ACTION' });
      }

      const match = /^\/v1\/payment-intents\/([^/?]+)(\/[^?]*)?/.exec(url);
      if (match && req.method === 'GET' && !match[2])
        return json(200, { id: match[1], status: 'AUTHORIZED', payableAmount: 0, currency: 'KRW' });
      if (match && match[2] === '/capture') return json(200, { status: 'CAPTURED' });
      if (match && match[2] === '/cancel') return json(200, { status: 'CANCELED' });

      return json(404, { error: 'NOT_FOUND' });
    });
    walletStub.once('error', reject);
    walletStub.listen(WALLET_PORT, '127.0.0.1', resolve);
  });

medusaIntegrationTestRunner({
  inApp: true,
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: Headers;
    let anonHeaders: Headers;
    let nonMemberHeaders: Headers;
    let memberHeaders: Headers;
    let regionId = '';
    let salesChannelId = '';
    let groupId = '';
    let productId = '';
    let variantId = '';
    let plainVariantId = '';
    let tierVariantId = '';
    let originalMetadata: Record<string, unknown> | null = null;
    let pk = '';
    let jwtSecret = '';
    let customerSeq = 0;
    const previousGroupEnv = process.env.MEDUSA_MEMBERSHIP_GROUP_ID;

    const customerHeaders = (pk: string, secret: string, customerId: string): Headers => ({
      headers: {
        'x-publishable-api-key': pk,
        authorization: `Bearer ${jwt.sign(
          {
            actor_id: customerId,
            actor_type: 'customer',
            auth_identity_id: `auth-${customerId}`,
            app_metadata: { customer_id: customerId },
          },
          secret,
        )}`,
      },
    });

    beforeAll(async () => {
      await startWalletStub();

      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;

      const [user] = await container.resolve(Modules.USER).createUsers([{ email: 'admin@price-privacy.test' }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'a', app_metadata: { user_id: user.id } },
            secret,
          )}`,
        },
      };

      const { result: channels } = await createSalesChannelsWorkflow(container).run({
        input: { salesChannelsData: [{ name: 'Privacy SC' }] },
      });
      salesChannelId = channels[0].id;

      const { result: regions } = await createRegionsWorkflow(container).run({
        input: { regions: [{ name: 'KR-privacy', currency_code: 'krw', countries: ['kr'] }] },
      });
      regionId = regions[0].id;

      const customers = container.resolve(Modules.CUSTOMER);
      const [group] = await customers.createCustomerGroups([{ name: 'privacy-members' }]);
      groupId = group.id;
      process.env.MEDUSA_MEMBERSHIP_GROUP_ID = groupId;

      const [nonMember, member] = await customers.createCustomers([
        { email: 'regular@price-privacy.test' },
        { email: 'member@price-privacy.test' },
      ]);
      await customers.addCustomerToGroup({ customer_id: member.id, customer_group_id: groupId });

      const fulfillment = container.resolve(Modules.FULFILLMENT);
      const profiles = await fulfillment.listShippingProfiles({});
      const shippingProfileId =
        profiles[0]?.id ?? (await fulfillment.createShippingProfiles([{ name: 'default', type: 'default' }]))[0].id;

      const { result: products } = await createProductsWorkflow(container).run({
        input: {
          products: [
            {
              title: 'Private Sale Product',
              status: 'published',
              shipping_profile_id: shippingProfileId,
              sales_channels: [{ id: salesChannelId }],
              options: [{ title: 'Size', values: ['M'] }],
              variants: [
                {
                  title: 'M',
                  sku: 'PRIVACY-M',
                  manage_inventory: false,
                  options: { Size: 'M' },
                  metadata: { membershipPrice: MEMBERSHIP_METADATA },
                  prices: [{ amount: REGULAR, currency_code: 'krw' }],
                },
              ],
            },
            {
              title: 'Plain Product',
              status: 'published',
              shipping_profile_id: shippingProfileId,
              sales_channels: [{ id: salesChannelId }],
              options: [{ title: 'Size', values: ['M'] }],
              variants: [
                {
                  title: 'M',
                  sku: 'PLAIN-M',
                  manage_inventory: false,
                  options: { Size: 'M' },
                  prices: [{ amount: REGULAR, currency_code: 'krw' }],
                },
              ],
            },
            {
              title: 'Tier Product',
              status: 'published',
              shipping_profile_id: shippingProfileId,
              sales_channels: [{ id: salesChannelId }],
              options: [{ title: 'Size', values: ['M'] }],
              variants: [
                {
                  title: 'M',
                  sku: 'TIER-M',
                  manage_inventory: false,
                  options: { Size: 'M' },
                  prices: [
                    { amount: REGULAR, currency_code: 'krw' },
                    { amount: TIER_PRICE, currency_code: 'krw', min_quantity: 2 },
                  ],
                },
              ],
            },
          ],
        },
      });
      productId = products[0].id;
      variantId = products[0].variants[0].id;
      plainVariantId = products[1].variants[0].id;
      tierVariantId = products[2].variants[0].id;

      const { result: keys } = await createApiKeysWorkflow(container).run({
        input: { api_keys: [{ title: 'pk-privacy', type: 'publishable', created_by: user.id }] },
      });
      await linkSalesChannelsToApiKeyWorkflow(container).run({
        input: { id: keys[0].id, add: [salesChannelId] },
      });

      pk = keys[0].token;
      jwtSecret = secret;
      anonHeaders = { headers: { 'x-publishable-api-key': pk } };
      nonMemberHeaders = customerHeaders(pk, secret, nonMember.id);
      memberHeaders = customerHeaders(pk, secret, member.id);

      const stores = container.resolve(Modules.STORE);
      const [store] = await stores.listStores();
      if (!store)
        await stores.createStores([
          { name: 'privacy-spec', supported_currencies: [{ currency_code: 'krw', is_default: true }] },
        ]);

      const [current] = await stores.listStores();
      originalMetadata = current.metadata ?? {};
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => (walletStub ? walletStub.close(() => resolve()) : resolve()));
      if (previousGroupEnv === undefined) delete process.env.MEDUSA_MEMBERSHIP_GROUP_ID;
      else process.env.MEDUSA_MEMBERSHIP_GROUP_ID = previousGroupEnv;
    });

    afterEach(async () => {
      const container = getContainer();
      const stores = container.resolve(Modules.STORE);
      const [store] = await stores.listStores();
      const restored: Record<string, unknown> = { ...originalMetadata };

      for (const key of Object.keys(store.metadata ?? {})) {
        if (!(key in restored)) restored[key] = null;
      }

      await stores.updateStores(store.id, { metadata: restored });

      const pricing = container.resolve(Modules.PRICING);
      const lists = await pricing.listPriceLists({});
      if (lists.length > 0) await pricing.deletePriceLists(lists.map((list) => list.id));
    });

    const call = (fn: () => Promise<unknown>) =>
      fn().then(
        (res: any) => res,
        (err: any) => err.response,
      );

    const settingsNow = async () => (await api.get('/admin/time-sale-settings', adminHeaders)).data;

    const save = async (input: {
      membershipPriceOnly: boolean;
      saleId?: string;
      general?: boolean;
      membershipRules?: Record<string, string[]>;
      variant?: string;
      generalAmount?: number;
    }) => {
      const variant = input.variant ?? variantId;
      const now = Date.now();
      const { revision } = await settingsNow();

      return call(() =>
        api.post(
          '/admin/time-sales/save',
          {
            saleId: input.saleId ?? null,
            title: '비공개 세일',
            period: {
              startsAt: new Date(now - 60 * 60 * 1000).toISOString(),
              endsAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
            },
            general:
              input.general === false
                ? null
                : {
                    description: '타임세일 (전체)',
                    rules: { region_id: [regionId] },
                    prices: [
                      { amount: input.generalAmount ?? GENERAL_SALE, currency_code: 'krw', variant_id: variant },
                    ],
                  },
            membership: {
              description: '타임세일 (멤버십 구독자)',
              rules: input.membershipRules ?? { 'customer.groups.id': [groupId] },
              prices: [{ amount: MEMBERSHIP_SALE, currency_code: 'krw', variant_id: variant }],
            },
            display: { ...defaultSaleDisplay(), membershipPriceOnly: input.membershipPriceOnly },
            revision,
          },
          adminHeaders,
        ),
      );
    };

    const productList = async (headers: Headers) =>
      (
        await api.get(
          `/store/products?id=${productId}&region_id=${regionId}&fields=${encodeURIComponent(PRODUCT_FIELDS)}`,
          headers,
        )
      ).data;

    const productDetail = async (headers: Headers) =>
      (
        await api.get(
          `/store/products/${productId}?region_id=${regionId}&fields=${encodeURIComponent(PRODUCT_FIELDS)}`,
          headers,
        )
      ).data;

    const newCart = async (headers: Headers, variant = variantId, quantity = 1) => {
      const created = await api.post(
        '/store/carts',
        { region_id: regionId, sales_channel_id: salesChannelId },
        headers,
      );
      const res = await api.post(
        `/store/carts/${created.data.cart.id}/line-items`,
        { variant_id: variant, quantity },
        headers,
      );

      return res.data.cart;
    };

    const cartUnitPrice = async (headers: Headers) => (await newCart(headers)).items[0].unit_price as number;

    const newCustomer = async (member: boolean) => {
      customerSeq += 1;
      const customers = getContainer().resolve(Modules.CUSTOMER);
      const [customer] = await customers.createCustomers([{ email: `checkout${customerSeq}@price-privacy.test` }]);
      if (member) await customers.addCustomerToGroup({ customer_id: customer.id, customer_group_id: groupId });

      return { customerId: customer.id, headers: customerHeaders(pk, jwtSecret, customer.id) };
    };

    const prepareCheckout = async (cartId: string, headers: Headers) => {
      const cartModule: any = getContainer().resolve(Modules.CART);
      const cart = await cartModule.retrieveCart(cartId, { relations: ['items'] });
      await cartModule.updateLineItems(
        (cart.items ?? []).map((line: any) => ({ id: line.id, requires_shipping: false })),
      );

      const collection = await api.post('/store/payment-collections', { cart_id: cartId }, headers);
      await api.post(
        `/store/payment-collections/${collection.data.payment_collection.id}/payment-sessions`,
        { provider_id: 'pp_almond-payment_almond-payment' },
        headers,
      );
    };

    const complete = async (cartId: string, headers: Headers) => {
      const res = await call(() => api.post(`/store/carts/${cartId}/complete`, {}, headers));

      return { status: res.status as number, data: res.data as any };
    };

    const timeSaleLists = async () =>
      (await getContainer().resolve(Modules.PRICING).listPriceLists({})).filter((list) =>
        list.title.startsWith('비공개 세일'),
      );

    describe('가격 공개 제한 세일', () => {
      it('일반 세일 가격표 없이 멤버십 가격표만 만든다', async () => {
        const res = await save({ membershipPriceOnly: true });

        expect(res.status).toBe(200);
        expect(res.data.generalId).toBeNull();
        expect(res.data.membershipId).toBeTruthy();
        expect((await timeSaleLists()).map((list) => list.id)).toEqual([res.data.membershipId]);

        const [membership] = await getContainer()
          .resolve(Modules.PRICING)
          .listPriceLists({ id: [res.data.membershipId] }, { relations: ['price_list_rules'] });
        const attributes = (membership.price_list_rules ?? []).map((rule) => rule.attribute).sort();
        expect(attributes).toEqual(['customer.groups.id', 'region_id']);
      });

      it('상품 응답: 비회원·일반회원은 세일가 없이 정상가, 멤버십 회원은 멤버십 세일가', async () => {
        expect((await save({ membershipPriceOnly: true })).status).toBe(200);

        for (const headers of [anonHeaders, nonMemberHeaders]) {
          for (const body of [await productList(headers), await productDetail(headers)]) {
            const product = body.product ?? body.products[0];

            expect(JSON.stringify(body)).not.toMatch(SALE_NUMBERS);
            expect(product.variants[0].calculated_price.calculated_amount).toBe(REGULAR);
            expect(product.metadata.timeSalePriceHidden).toBe(true);
          }
        }

        const member = await productList(memberHeaders);
        expect(member.products[0].variants[0].calculated_price.calculated_amount).toBe(MEMBERSHIP_SALE);
        expect(member.products[0].metadata?.timeSalePriceHidden).toBeUndefined();
      });

      it('장바구니에는 비회원·일반회원은 정상가, 멤버십 회원은 멤버십 세일가로 담긴다', async () => {
        expect((await save({ membershipPriceOnly: true })).status).toBe(200);

        expect(await cartUnitPrice(anonHeaders)).toBe(REGULAR);
        expect(await cartUnitPrice(nonMemberHeaders)).toBe(REGULAR);
        expect(await cartUnitPrice(memberHeaders)).toBe(MEMBERSHIP_SALE);
      });

      it('공개 ↔ 비공개로 다시 저장하면 일반 세일 가격표가 생기고 지워진다', async () => {
        const opened = await save({ membershipPriceOnly: false });
        expect(opened.status).toBe(200);
        expect(opened.data.generalId).toBeTruthy();
        expect(await cartUnitPrice(anonHeaders)).toBe(GENERAL_SALE);

        const closed = await save({ membershipPriceOnly: true, saleId: opened.data.saleId });
        expect(closed.status).toBe(200);
        expect(closed.data.generalId).toBeNull();
        expect((await timeSaleLists()).map((list) => list.id)).toEqual([opened.data.membershipId]);
        expect(await cartUnitPrice(anonHeaders)).toBe(REGULAR);

        const reopened = await save({ membershipPriceOnly: false, saleId: opened.data.saleId });
        expect(reopened.status).toBe(200);
        expect(reopened.data.generalId).toBeTruthy();
        expect(await cartUnitPrice(anonHeaders)).toBe(GENERAL_SALE);
      });

      it('전체 설정이 가격 공개 제한이면 세일별 표시가 꺼져 있어도 비공개로 저장한다', async () => {
        const settings = { ...defaultTimeSaleSettings() };
        settings.environment = { ...settings.environment, membershipPriceOnly: true };
        const { revision } = await settingsNow();
        const put = await call(() => api.post('/admin/time-sale-settings', { settings, revision }, adminHeaders));
        expect(put.status).toBe(200);

        const res = await save({ membershipPriceOnly: false });
        expect(res.status).toBe(200);
        expect(res.data.generalId).toBeNull();
        expect(await cartUnitPrice(anonHeaders)).toBe(REGULAR);
      });

      it('멤버십 세일가 없이 가격 공개 제한으로 저장하면 400', async () => {
        const now = Date.now();
        const res = await call(async () =>
          api.post(
            '/admin/time-sales/save',
            {
              title: '비공개 세일',
              period: {
                startsAt: new Date(now - 60 * 60 * 1000).toISOString(),
                endsAt: new Date(now + 60 * 60 * 1000).toISOString(),
              },
              general: {
                description: '타임세일 (전체)',
                rules: { region_id: [regionId] },
                prices: [{ amount: GENERAL_SALE, currency_code: 'krw', variant_id: variantId }],
              },
              membership: null,
              display: { ...defaultSaleDisplay(), membershipPriceOnly: true },
              revision: (await settingsNow()).revision,
            },
            adminHeaders,
          ),
        );

        expect(res.status).toBe(400);
        expect(res.data.message).toContain('멤버십 세일가');
        expect(await timeSaleLists()).toHaveLength(0);
      });
    });

    describe('가격 공개 제한 세일 — 서버가 정하는 가격표 룰', () => {
      it('클라이언트가 멤버십 룰을 비워 보내도 멤버십 그룹 룰을 서버가 붙인다', async () => {
        const res = await save({ membershipPriceOnly: true, membershipRules: {} });
        expect(res.status).toBe(200);

        const [membership] = await getContainer()
          .resolve(Modules.PRICING)
          .listPriceLists({ id: [res.data.membershipId] }, { relations: ['price_list_rules'] });
        const rules = Object.fromEntries(
          (membership.price_list_rules ?? []).map((rule: any) => [rule.attribute, rule.value]),
        );

        expect(rules['customer.groups.id']).toEqual([groupId]);
        expect(await cartUnitPrice(anonHeaders)).toBe(REGULAR);
      });

      it('클라이언트가 다른 그룹을 보내도 멤버십 그룹으로 덮어쓴다', async () => {
        const res = await save({
          membershipPriceOnly: true,
          membershipRules: { 'customer.groups.id': ['cusgroup_x'] },
        });
        expect(res.status).toBe(200);
        expect(await cartUnitPrice(memberHeaders)).toBe(MEMBERSHIP_SALE);
      });

      it('멤버십 그룹 설정이 없으면 비공개 저장은 400', async () => {
        delete process.env.MEDUSA_MEMBERSHIP_GROUP_ID;
        try {
          const res = await save({ membershipPriceOnly: true });
          expect(res.status).toBe(400);
          expect(await timeSaleLists()).toHaveLength(0);
        } finally {
          process.env.MEDUSA_MEMBERSHIP_GROUP_ID = groupId;
        }
      });

      it('region 이 하나도 없으면 비공개 저장은 400', async () => {
        const regions = getContainer().resolve(Modules.REGION);
        const all = await regions.listRegions({}, { select: ['id'] });
        await regions.softDeleteRegions(all.map((region) => region.id));
        try {
          const res = await save({ membershipPriceOnly: true });
          expect(res.status).toBe(400);
          expect(await timeSaleLists()).toHaveLength(0);
        } finally {
          await regions.restoreRegions(all.map((region) => region.id));
        }
      });
    });

    describe('이미 담긴 카트와 결제', () => {
      it('공개 세일가로 담긴 카트도 비공개 전환 후 갱신하면 정상가', async () => {
        const opened = await save({ membershipPriceOnly: false });
        const cart = await newCart(anonHeaders);
        expect(cart.items[0].unit_price).toBe(GENERAL_SALE);

        expect((await save({ membershipPriceOnly: true, saleId: opened.data.saleId })).status).toBe(200);
        await api.post(`/store/carts/${cart.id}`, {}, anonHeaders);
        const refreshed = (
          await api.get(`/store/carts/${cart.id}?fields=*items,+items.subtotal,+subtotal`, anonHeaders)
        ).data.cart;

        expect(refreshed.items[0].unit_price).toBe(REGULAR);
        expect(refreshed.items[0].subtotal).toBe(REGULAR);
        expect(refreshed.subtotal).toBe(REGULAR);
        expect([null, undefined, REGULAR]).toContain(refreshed.items[0].compare_at_unit_price);
        expect(JSON.stringify(refreshed)).not.toMatch(SALE_NUMBERS);
      });

      it('공개 세일가로 담아 두고 갱신 없이 결제하면 거절된다', async () => {
        const opened = await save({ membershipPriceOnly: false });
        const { headers } = await newCustomer(false);
        const cart = await newCart(headers);
        expect((await save({ membershipPriceOnly: true, saleId: opened.data.saleId })).status).toBe(200);
        await prepareCheckout(cart.id, headers);

        const res = await complete(cart.id, headers);
        expect(res.status).toBe(400);
        expect(res.data.message).toContain('새로고침');
      });

      it('멤버십가로 담은 뒤 멤버십이 끊긴 고객의 결제는 거절된다', async () => {
        expect((await save({ membershipPriceOnly: true })).status).toBe(200);
        const { customerId, headers } = await newCustomer(true);
        const cart = await newCart(headers);
        expect(cart.items[0].unit_price).toBe(MEMBERSHIP_SALE);

        await getContainer()
          .resolve(Modules.CUSTOMER)
          .removeCustomerFromGroup({ customer_id: customerId, customer_group_id: groupId });
        await prepareCheckout(cart.id, headers);

        const res = await complete(cart.id, headers);
        expect(res.status).toBe(400);
        expect(res.data.message).toContain('새로고침');
      });

      it('멤버십 회원은 멤버십가로 결제된다', async () => {
        expect((await save({ membershipPriceOnly: true })).status).toBe(200);
        const { headers } = await newCustomer(true);
        const cart = await newCart(headers);
        await prepareCheckout(cart.id, headers);

        const res = await complete(cart.id, headers);
        expect(res.status).toBe(200);
        expect(res.data.type).toBe('order');
        expect(res.data.order.items[0].unit_price).toBe(MEMBERSHIP_SALE);
      });

      it('비회원은 정상가로 결제된다', async () => {
        expect((await save({ membershipPriceOnly: true })).status).toBe(200);
        const { headers } = await newCustomer(false);
        const cart = await newCart(headers);
        expect(cart.items[0].unit_price).toBe(REGULAR);
        await prepareCheckout(cart.id, headers);

        const res = await complete(cart.id, headers);
        expect(res.status).toBe(200);
        expect(res.data.type).toBe('order');
        expect(res.data.order.items[0].unit_price).toBe(REGULAR);
      });
    });

    describe('결제 정상가 비교 — 수량 구간가', () => {
      it('비회원이 수량 구간가로 담은 카트는 결제된다', async () => {
        expect((await save({ membershipPriceOnly: true, variant: tierVariantId })).status).toBe(200);
        const { headers } = await newCustomer(false);
        const cart = await newCart(headers, tierVariantId, 2);
        expect(cart.items[0].unit_price).toBe(TIER_PRICE);
        await prepareCheckout(cart.id, headers);

        const res = await complete(cart.id, headers);
        expect(res.status).toBe(200);
        expect(res.data.type).toBe('order');
      });

      it('1개 라인의 정상가는 구간가가 아니라 1개 가격으로 비교한다', async () => {
        const opened = await save({
          membershipPriceOnly: false,
          variant: tierVariantId,
          generalAmount: STALE_GENERAL_SALE,
        });
        const { headers } = await newCustomer(false);
        const cart = await newCart(headers, tierVariantId, 1);
        expect(cart.items[0].unit_price).toBe(STALE_GENERAL_SALE);
        expect(
          (await save({ membershipPriceOnly: true, saleId: opened.data.saleId, variant: tierVariantId })).status,
        ).toBe(200);
        await prepareCheckout(cart.id, headers);

        const res = await complete(cart.id, headers);
        expect(res.status).toBe(400);
        expect(res.data.message).toContain('새로고침');
      });
    });

    describe('타임세일 설정이 깨졌을 때', () => {
      const breakSettings = async () => {
        const stores = getContainer().resolve(Modules.STORE);
        const [store] = await stores.listStores();
        await stores.updateStores(store.id, {
          metadata: { ...store.metadata, timeSaleSettings: { broken: true } },
        });
      };

      it('타임세일 상품이 없는 카트는 결제된다', async () => {
        const { headers } = await newCustomer(false);
        const cart = await newCart(headers, plainVariantId);
        await prepareCheckout(cart.id, headers);
        await breakSettings();

        const res = await complete(cart.id, headers);
        expect(res.status).toBe(200);
        expect(res.data.type).toBe('order');
      });

      it('비공개 세일 상품이 든 카트의 결제는 거절된다', async () => {
        expect((await save({ membershipPriceOnly: true })).status).toBe(200);
        const { headers } = await newCustomer(false);
        const cart = await newCart(headers);
        await prepareCheckout(cart.id, headers);
        await breakSettings();

        const res = await complete(cart.id, headers);
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.data?.type).not.toBe('order');
      });

      it('비회원 상품 목록은 200 이다', async () => {
        expect((await save({ membershipPriceOnly: true })).status).toBe(200);
        await breakSettings();

        for (const headers of [anonHeaders, nonMemberHeaders]) {
          const res = await call(() => api.get(`/store/products?id=${productId}&region_id=${regionId}`, headers));
          expect(res.status).toBe(200);
          expect(res.data.products[0].variants[0].calculated_price.calculated_amount).toBe(REGULAR);
        }
      });
    });

    describe('설정 저장으로 가격 공개 제한을 바꾸는 경우', () => {
      it('일반 가격표가 있는 세일을 설정만으로 비공개로 바꾸면 400, 설정 유지', async () => {
        const saved = await save({ membershipPriceOnly: false });
        expect(saved.status).toBe(200);

        const current = await settingsNow();
        const settings = structuredClone(current.settings);
        settings.environment.membershipPriceOnly = true;
        const res = await call(() =>
          api.post('/admin/time-sale-settings', { settings, revision: current.revision }, adminHeaders),
        );

        expect(res.status).toBe(400);
        expect(res.data.message).toContain('가격 공개 제한');
        expect((await settingsNow()).revision).toBe(current.revision);
        expect(await cartUnitPrice(anonHeaders)).toBe(GENERAL_SALE);
      });

      it('일반 가격표가 없는 세일도 설정만으로 비공개로 바꾸면 400', async () => {
        const saved = await save({ membershipPriceOnly: false, general: false });
        expect(saved.status).toBe(200);

        const current = await settingsNow();
        const settings = structuredClone(current.settings);
        settings.sales[saved.data.saleId].membershipPriceOnly = true;
        const res = await call(() =>
          api.post('/admin/time-sale-settings', { settings, revision: current.revision }, adminHeaders),
        );

        expect(res.status).toBe(400);
      });

      it('비공개 세일을 설정만으로 공개로 바꾸면 400', async () => {
        const saved = await save({ membershipPriceOnly: true });
        expect(saved.status).toBe(200);

        const current = await settingsNow();
        const settings = structuredClone(current.settings);
        settings.sales[saved.data.saleId].membershipPriceOnly = false;
        const res = await call(() =>
          api.post('/admin/time-sale-settings', { settings, revision: current.revision }, adminHeaders),
        );

        expect(res.status).toBe(400);
        expect(res.data.message).toContain('비공개 세일');
      });
    });
  },
});
