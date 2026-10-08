import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules, PriceListStatus, PriceListType } from '@medusajs/framework/utils';
import {
  createApiKeysWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from '@medusajs/core-flows';
import jwt from 'jsonwebtoken';
import { defaultSaleDisplay } from '../../../../packages/domain-types/time-sale';

jest.setTimeout(180 * 1000);

type Headers = { headers: Record<string, string> };

const REGULAR = 10000;

const SALE_A = 8000;

const SALE_B = 7000;

const OFF_MESSAGE = '서비스가 꺼져 있습니다. 환경설정에서 켠 뒤 활성화하세요.';

medusaIntegrationTestRunner({
  inApp: true,
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: Headers;
    let storeHeaders: Headers;
    let regionId = '';
    let productAId = '';
    let variantAId = '';
    let variantBId = '';
    let originalMetadata: Record<string, unknown> | null = null;

    beforeAll(async () => {
      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;

      const [user] = await container.resolve(Modules.USER).createUsers([{ email: 'admin@service-toggle.test' }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'a', app_metadata: { user_id: user.id } },
            secret,
          )}`,
        },
      };

      const { result: channels } = await createSalesChannelsWorkflow(container).run({
        input: { salesChannelsData: [{ name: 'Toggle SC' }] },
      });
      const salesChannelId = channels[0].id;

      const { result: regions } = await createRegionsWorkflow(container).run({
        input: { regions: [{ name: 'KR-toggle', currency_code: 'krw', countries: ['kr'] }] },
      });
      regionId = regions[0].id;

      const fulfillment = container.resolve(Modules.FULFILLMENT);
      const profiles = await fulfillment.listShippingProfiles({});
      const shippingProfileId =
        profiles[0]?.id ?? (await fulfillment.createShippingProfiles([{ name: 'default', type: 'default' }]))[0].id;

      const product = (title: string, sku: string) => ({
        title,
        status: 'published' as const,
        shipping_profile_id: shippingProfileId,
        sales_channels: [{ id: salesChannelId }],
        options: [{ title: 'Size', values: ['M'] }],
        variants: [
          {
            title: 'M',
            sku,
            manage_inventory: false,
            options: { Size: 'M' },
            prices: [{ amount: REGULAR, currency_code: 'krw' }],
          },
        ],
      });
      const { result: products } = await createProductsWorkflow(container).run({
        input: { products: [product('Toggle A', 'TOGGLE-A'), product('Toggle B', 'TOGGLE-B')] },
      });
      productAId = products[0].id;
      variantAId = products[0].variants[0].id;
      variantBId = products[1].variants[0].id;

      const { result: keys } = await createApiKeysWorkflow(container).run({
        input: { api_keys: [{ title: 'pk-toggle', type: 'publishable', created_by: user.id }] },
      });
      await linkSalesChannelsToApiKeyWorkflow(container).run({ input: { id: keys[0].id, add: [salesChannelId] } });
      storeHeaders = { headers: { 'x-publishable-api-key': keys[0].token } };

      const stores = container.resolve(Modules.STORE);
      const [store] = await stores.listStores();
      if (!store)
        await stores.createStores([
          { name: 'toggle-spec', supported_currencies: [{ currency_code: 'krw', is_default: true }] },
        ]);

      const [current] = await stores.listStores();
      originalMetadata = current.metadata ?? {};
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

    // 환경설정 화면처럼 현재 설정을 읽어 enabled 만 바꿔 저장한다.
    const setEnabled = async (enabled: boolean, revision?: string) => {
      const current = await settingsNow();
      const settings = { ...current.settings, environment: { ...current.settings.environment, enabled } };

      return call(() =>
        api.post('/admin/time-sale-settings', { settings, revision: revision ?? current.revision }, adminHeaders),
      );
    };

    type SaleInput = {
      title: string;
      variant: string;
      amount: number;
      status: 'active' | 'draft';
      saleId?: string;
      generalId?: string;
      startsAt?: string;
      endsAt?: string;
      repeatHours?: number;
      repeatUntil?: string | null;
    };

    const saveSale = async (input: SaleInput) => {
      const now = Date.now();
      const { revision } = await settingsNow();
      const display = {
        ...defaultSaleDisplay(),
        repeatHours: input.repeatHours ?? 0,
        repeatUntil: input.repeatUntil ?? null,
      };

      return call(() =>
        api.post(
          '/admin/time-sales/save',
          {
            saleId: input.saleId ?? null,
            generalId: input.generalId ?? null,
            title: input.title,
            period: {
              startsAt: input.startsAt ?? new Date(now - 60 * 60 * 1000).toISOString(),
              endsAt: input.endsAt ?? new Date(now + 24 * 60 * 60 * 1000).toISOString(),
            },
            general: {
              description: '타임세일 (전체)',
              rules: { region_id: [regionId] },
              prices: [{ amount: input.amount, currency_code: 'krw', variant_id: input.variant }],
            },
            membership: null,
            display,
            revision,
            status: input.status,
          },
          adminHeaders,
        ),
      );
    };

    const statusOf = async (id: string) =>
      (
        await getContainer()
          .resolve(Modules.PRICING)
          .listPriceLists({ id: [id] })
      )[0]?.status;

    const priceOfA = async () => {
      const fields = encodeURIComponent('*variants.calculated_price');
      const res = await api.get(
        `/store/products?id=${productAId}&region_id=${regionId}&fields=${fields}`,
        storeHeaders,
      );

      return res.data.products[0].variants[0].calculated_price.calculated_amount as number;
    };

    const seedAB = async () => {
      const a = await saveSale({ title: '세일 A', variant: variantAId, amount: SALE_A, status: 'active' });
      const b = await saveSale({ title: '세일 B', variant: variantBId, amount: SALE_B, status: 'draft' });
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);

      return {
        a: a.data.generalId as string,
        b: b.data.generalId as string,
        saleA: a.data.saleId as string,
      };
    };

    const pricing = () => getContainer().resolve(Modules.PRICING);

    const minutes = (n: number) => new Date(Date.now() + n * 60000).toISOString();

    describe('서비스 ON/OFF 가 가격까지 멈추고 되살린다', () => {
      it('OFF 면 둘 다 초안·할인 사라짐, ON 이면 OFF 직전 활성이던 A 만 되살아난다', async () => {
        const { a, b } = await seedAB();
        expect(await priceOfA()).toBe(SALE_A);

        expect((await setEnabled(false)).status).toBe(200);
        expect(await statusOf(a)).toBe('draft');
        expect(await statusOf(b)).toBe('draft');
        expect(await priceOfA()).toBe(REGULAR);
        expect((await settingsNow()).settings.environment.suspendedPriceListIds).toEqual([a]);

        expect((await setEnabled(true)).status).toBe(200);
        expect(await statusOf(a)).toBe('active');
        expect(await statusOf(b)).toBe('draft');
        expect(await priceOfA()).toBe(SALE_A);
        expect((await settingsNow()).settings.environment.suspendedPriceListIds).toEqual([]);
      });

      it('OFF 중 세일 활성화는 400, 비활성화는 ON 때 되살릴 목록에서 뺀다', async () => {
        const { a, b } = await seedAB();
        expect((await setEnabled(false)).status).toBe(200);

        const activate = await call(() =>
          api.post('/admin/time-sales/status', { priceListIds: [b], active: true }, adminHeaders),
        );
        expect(activate.status).toBe(400);
        expect(activate.data.message).toBe(OFF_MESSAGE);
        expect(await statusOf(b)).toBe('draft');

        const deactivate = await call(() =>
          api.post('/admin/time-sales/status', { priceListIds: [a], active: false }, adminHeaders),
        );
        expect(deactivate.status).toBe(200);
        expect((await settingsNow()).settings.environment.suspendedPriceListIds).toEqual([]);

        expect((await setEnabled(true)).status).toBe(200);
        expect(await statusOf(a)).toBe('draft');
      });

      it('OFF 중 활성으로 만든 세일은 초안으로 두고 ON 때 활성화한다', async () => {
        expect((await setEnabled(false)).status).toBe(200);

        const created = await saveSale({ title: '세일 A', variant: variantAId, amount: SALE_A, status: 'active' });
        expect(created.status).toBe(200);
        const id = created.data.generalId as string;
        expect(await statusOf(id)).toBe('draft');
        expect(await priceOfA()).toBe(REGULAR);
        expect((await settingsNow()).settings.environment.suspendedPriceListIds).toEqual([id]);

        const draft = await saveSale({ title: '세일 B', variant: variantBId, amount: SALE_B, status: 'draft' });
        expect((await settingsNow()).settings.environment.suspendedPriceListIds).toEqual([id]);

        expect((await setEnabled(true)).status).toBe(200);
        expect(await statusOf(id)).toBe('active');
        expect(await statusOf(draft.data.generalId)).toBe('draft');
        expect(await priceOfA()).toBe(SALE_A);
      });

      it('OFF 중 같은 상품을 겹치는 기간에 걸면, 꺼져 있는 활성 세일과도 409', async () => {
        expect(
          (await saveSale({ title: '세일 A', variant: variantAId, amount: SALE_A, status: 'active' })).status,
        ).toBe(200);
        expect((await setEnabled(false)).status).toBe(200);

        const dup = await saveSale({ title: '세일 C', variant: variantAId, amount: SALE_B, status: 'active' });
        expect(dup.status).toBe(409);
      });

      it('OFF 중 삭제한 세일은 목록에서 빠지고 ON 이 실패하지 않는다', async () => {
        const { a } = await seedAB();
        expect((await setEnabled(false)).status).toBe(200);

        await api.delete(`/admin/price-lists/${a}`, adminHeaders);
        expect((await settingsNow()).settings.environment.suspendedPriceListIds).toEqual([]);

        expect((await setEnabled(true)).status).toBe(200);
        expect((await settingsNow()).settings.environment.enabled).toBe(true);
      });

      it('설정 저장이 실패하면(오래된 revision) 가격표 상태를 되돌린다', async () => {
        const { a, b } = await seedAB();

        const stale = await setEnabled(false, 'stale');
        expect(stale.status).toBe(409);
        expect(await statusOf(a)).toBe('active');
        expect(await statusOf(b)).toBe('draft');
        expect((await settingsNow()).settings.environment.enabled).toBe(true);
        expect(await priceOfA()).toBe(SALE_A);
      });

      it('클라이언트가 보낸 suspendedPriceListIds 는 무시하고 서버 값을 지킨다', async () => {
        const { a } = await seedAB();
        expect((await setEnabled(false)).status).toBe(200);

        const current = await settingsNow();
        const settings = {
          ...current.settings,
          environment: { ...current.settings.environment, suspendedPriceListIds: ['plist_injected'] },
        };
        const res = await call(() =>
          api.post('/admin/time-sale-settings', { settings, revision: current.revision }, adminHeaders),
        );
        expect(res.status).toBe(200);
        expect((await settingsNow()).settings.environment.suspendedPriceListIds).toEqual([a]);
      });
      it('세일에 속하지 않은 가격표 id 를 실어 보내면 400, 그 가격표는 그대로', async () => {
        const [foreign] = await pricing().createPriceLists([
          { title: '외부 가격표', description: '외부', type: PriceListType.SALE, status: PriceListStatus.DRAFT },
        ]);

        const injected = await saveSale({
          title: '주입',
          variant: variantAId,
          amount: SALE_A,
          status: 'active',
          generalId: foreign.id,
        });
        expect(injected.status).toBe(400);

        const [after] = await pricing().listPriceLists({ id: [foreign.id] });
        expect(after.title).toBe('외부 가격표');
        expect(after.status).toBe('draft');
        expect(after.starts_at).toBeNull();

        const { b, saleA } = await seedAB();
        const cross = await saveSale({
          title: '세일 A',
          variant: variantAId,
          amount: SALE_A,
          status: 'active',
          saleId: saleA,
          generalId: b,
        });
        expect(cross.status).toBe(400);
        expect(await statusOf(b)).toBe('draft');
      });

      it('OFF 중 회차가 지난 반복 세일: ON 때 다음 회차로 켜고, 반복 끝이면 초안', async () => {
        const base = { amount: SALE_A, status: 'active' as const, startsAt: minutes(-30), endsAt: minutes(30) };
        const repeat = await saveSale({ ...base, title: '반복', variant: variantAId, repeatHours: 2 });
        const done = await saveSale({
          ...base,
          title: '반복 끝',
          variant: variantBId,
          repeatHours: 2,
          repeatUntil: minutes(90),
        });
        expect(repeat.status).toBe(200);
        expect(done.status).toBe(200);
        expect((await setEnabled(false)).status).toBe(200);

        // OFF 가 길어져 두 세일 모두 회차가 끝난 상황을 만든다.
        const ids = [repeat.data.generalId, done.data.generalId];
        await pricing().updatePriceLists(ids.map((id) => ({ id, starts_at: minutes(-300), ends_at: minutes(-240) })));

        expect((await setEnabled(true)).status).toBe(200);

        const [moved] = await pricing().listPriceLists({ id: [repeat.data.generalId] });
        expect(moved.status).toBe('active');
        expect(Date.parse(moved.ends_at ?? '')).toBeGreaterThan(Date.now());
        expect(await statusOf(done.data.generalId)).toBe('draft');
        expect((await settingsNow()).settings.environment.suspendedPriceListIds).toEqual([]);
      });

      it('활성 가격표 여럿을 끄다 설정 저장이 실패하면 전부 active 로 남는다', async () => {
        const { a, b } = await seedAB();
        const c = await saveSale({ title: '세일 C', variant: variantBId, amount: SALE_B, status: 'active' });
        expect(c.status).toBe(200);

        expect((await setEnabled(false, 'stale')).status).toBe(409);
        expect(await statusOf(a)).toBe('active');
        expect(await statusOf(c.data.generalId)).toBe('active');
        expect(await statusOf(b)).toBe('draft');
        expect((await settingsNow()).settings.environment.suspendedPriceListIds).toEqual([]);
      });

      it('active 타임세일 가격표가 201개면 OFF 는 400 이고 아무것도 바뀌지 않는다', async () => {
        const lists = await pricing().createPriceLists(
          Array.from({ length: 201 }, (_, i) => ({
            title: `대량 ${i}`,
            description: '대량',
            type: PriceListType.SALE,
            status: PriceListStatus.ACTIVE,
            starts_at: minutes(-60),
            ends_at: minutes(60),
          })),
        );

        const res = await setEnabled(false);
        expect(res.status).toBe(400);
        expect(res.data.message).toContain('200개');

        const after = await pricing().listPriceLists({ id: lists.map((list) => list.id) }, { take: 300 });
        expect(after.every((list) => list.status === 'active')).toBe(true);
        expect((await settingsNow()).settings.environment.enabled).toBe(true);
      });
      it('세일 중지·상품 제외 저장 뒤 상품 응답에 옛 할인가가 남지 않는다(캐시)', async () => {
        const { a, saleA } = await seedAB();
        expect(await priceOfA()).toBe(SALE_A);

        const stop = await call(() =>
          api.post('/admin/time-sales/status', { priceListIds: [a], active: false }, adminHeaders),
        );
        expect(stop.status).toBe(200);
        expect(await priceOfA()).toBe(REGULAR);

        const start = await call(() =>
          api.post('/admin/time-sales/status', { priceListIds: [a], active: true }, adminHeaders),
        );
        expect(start.status).toBe(200);
        expect(await priceOfA()).toBe(SALE_A);

        const moved = await saveSale({
          title: '세일 A',
          variant: variantBId,
          amount: SALE_A,
          status: 'active',
          saleId: saleA,
          generalId: a,
        });
        expect(moved.status).toBe(200);
        expect(await priceOfA()).toBe(REGULAR);
      });
    });
  },
});
