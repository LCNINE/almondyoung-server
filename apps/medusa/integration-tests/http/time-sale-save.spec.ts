import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { createProductsWorkflow, createRegionsWorkflow } from '@medusajs/core-flows';
import jwt from 'jsonwebtoken';
import { defaultSaleDisplay } from '../../../../packages/domain-types/time-sale';

jest.setTimeout(180 * 1000);

medusaIntegrationTestRunner({
  inApp: true,
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: { headers: Record<string, string> };
    let seq = 0;
    let originalMetadata: Record<string, unknown> | null = null;
    let regionId = '';
    let groupId = '';
    let productId = '';
    let variantId = '';
    let productBId = '';
    let variantBId = '';

    beforeAll(async () => {
      const container = getContainer();

      const { result: regions } = await createRegionsWorkflow(container).run({
        input: { regions: [{ name: 'KR-time-sale', currency_code: 'krw', countries: ['kr'] }] },
      });
      regionId = regions[0].id;

      const [group] = await container.resolve(Modules.CUSTOMER).createCustomerGroups([{ name: 'time-sale-members' }]);
      groupId = group.id;

      const fulfillment = container.resolve(Modules.FULFILLMENT);
      const profiles = await fulfillment.listShippingProfiles({});
      const shippingProfileId =
        profiles[0]?.id ?? (await fulfillment.createShippingProfiles([{ name: 'default', type: 'default' }]))[0].id;

      const { result: products } = await createProductsWorkflow(container).run({
        input: {
          products: [
            {
              title: 'Time Sale Product',
              status: 'published',
              shipping_profile_id: shippingProfileId,
              options: [{ title: 'Size', values: ['M'] }],
              variants: [
                {
                  title: 'M',
                  sku: 'TIME-SALE-M',
                  manage_inventory: false,
                  options: { Size: 'M' },
                  prices: [{ amount: 10000, currency_code: 'krw' }],
                },
              ],
            },
            {
              title: 'Time Sale Product B',
              status: 'published',
              shipping_profile_id: shippingProfileId,
              options: [{ title: 'Size', values: ['M'] }],
              variants: [
                {
                  title: 'M',
                  sku: 'TIME-SALE-B-M',
                  manage_inventory: false,
                  options: { Size: 'M' },
                  prices: [{ amount: 10000, currency_code: 'krw' }],
                },
              ],
            },
          ],
        },
      });
      productId = products[0].id;
      variantId = products[0].variants[0].id;
      productBId = products[1].id;
      variantBId = products[1].variants[0].id;
    });

    beforeEach(async () => {
      seq++;
      const container = getContainer();
      const [user] = await container.resolve(Modules.USER).createUsers([{ email: `save${seq}@time-sale.test` }]);
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const token = jwt.sign(
        {
          actor_id: user.id,
          actor_type: 'user',
          auth_identity_id: 'test-admin-auth',
          app_metadata: { user_id: user.id },
        },
        config.projectConfig.http.jwtSecret,
      );
      adminHeaders = { headers: { authorization: `Bearer ${token}` } };

      const stores = container.resolve(Modules.STORE);
      const [store] = await stores.listStores();
      if (!store)
        await stores.createStores([
          { name: 'time-sale-spec', supported_currencies: [{ currency_code: 'krw', is_default: true }] },
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

    const revision = async () => (await api.get('/admin/time-sale-settings', adminHeaders)).data.revision as string;

    const body = (input: {
      title: string;
      startsAt: string;
      endsAt: string;
      revision: string;
      saleId?: string | null;
      generalId?: string | null;
      membershipId?: string | null;
      amount?: number;
    }) => ({
      saleId: input.saleId ?? null,
      generalId: input.generalId ?? null,
      membershipId: input.membershipId ?? null,
      title: input.title,
      period: { startsAt: input.startsAt, endsAt: input.endsAt },
      general: {
        description: '타임세일 (전체)',
        rules: { region_id: [regionId] },
        prices: [{ amount: input.amount ?? 8000, currency_code: 'krw', variant_id: variantId }],
      },
      membership: {
        description: '타임세일 (멤버십 구독자)',
        rules: { 'customer.groups.id': [groupId] },
        prices: [{ amount: (input.amount ?? 8000) - 1000, currency_code: 'krw', variant_id: variantId }],
      },
      display: defaultSaleDisplay(),
      revision: input.revision,
    });

    const save = async (input: Parameters<typeof body>[0]) =>
      call(() => api.post('/admin/time-sales/save', body(input), adminHeaders));

    const listsWithTitle = async (title: string) =>
      (await getContainer().resolve(Modules.PRICING).listPriceLists({})).filter((list) => list.title.startsWith(title));

    const day = (n: number, hour = 0) => new Date(Date.UTC(2030, 0, n, hour)).toISOString();

    describe('POST /admin/time-sales/save', () => {
      it('신규 저장은 두 가격표를 만들고 활성화하며 설정을 저장한다', async () => {
        const res = await save({ title: '신규', startsAt: day(1), endsAt: day(2), revision: await revision() });

        expect(res.status).toBe(200);
        expect(res.data.generalId).toBeTruthy();
        expect(res.data.membershipId).toBeTruthy();

        const lists = await listsWithTitle('신규');
        const settings = (await api.get('/admin/time-sale-settings', adminHeaders)).data;

        expect(lists.map((list) => list.status).sort()).toEqual(['active', 'active']);
        expect(settings.revision).toBe(res.data.revision);
        expect(res.data.saleId).toMatch(/^[0-9a-f-]{36}$/);
        expect(settings.settings.sales[res.data.saleId]).toEqual({
          ...defaultSaleDisplay(),
          periodMode: 'sale',
          groups: [{ generalId: res.data.generalId, membershipId: res.data.membershipId, productId: null }],
        });
      });

      it('(a) 같은 상품을 겹치는 기간에 두 번째로 저장하면 409 + 세일 제목과 상품 id', async () => {
        const first = await save({ title: '먼저', startsAt: day(1), endsAt: day(3), revision: await revision() });
        const second = await save({ title: '나중', startsAt: day(2), endsAt: day(4), revision: await revision() });

        expect(first.status).toBe(200);
        expect(second.status).toBe(409);
        expect(second.data.message).toContain('먼저');
        expect(second.data.message).toContain(productId);
        expect(await listsWithTitle('나중')).toHaveLength(0);
      });

      it('(a) 반복 세일의 다음 회차와 겹쳐도 409', async () => {
        const display = { ...defaultSaleDisplay(), repeatHours: 24 };
        const firstBody = body({ title: '반복', startsAt: day(1, 0), endsAt: day(1, 1), revision: await revision() });
        const first = await call(() => api.post('/admin/time-sales/save', { ...firstBody, display }, adminHeaders));
        const second = await save({
          title: '회차',
          startsAt: day(3, 0),
          endsAt: day(3, 2),
          revision: await revision(),
        });

        expect(first.status).toBe(200);
        expect(second.status).toBe(409);
      });

      it('(b) 겹치는 두 세일을 동시에 저장하면 하나만 성공한다', async () => {
        const current = await revision();
        const results = await Promise.all([
          save({ title: '동시A', startsAt: day(1), endsAt: day(3), revision: current }),
          save({ title: '동시B', startsAt: day(2), endsAt: day(4), revision: current }),
        ]);

        const loser = results.find((res) => res.status === 409);
        const winnerTitle = (await listsWithTitle('동시A')).length > 0 ? '동시A' : '동시B';

        expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
        expect(loser?.data.message).toContain(winnerTitle);
        expect(loser?.data.message).toContain(productId);
        expect((await listsWithTitle('동시A')).length + (await listsWithTitle('동시B')).length).toBe(2);
      });

      it('(c) 신규 저장 중 설정 단계가 실패하면 가격표가 하나도 남지 않는다', async () => {
        const res = await save({ title: '실패신규', startsAt: day(1), endsAt: day(2), revision: 'stale' });

        expect(res.status).toBe(409);
        expect(await listsWithTitle('실패신규')).toHaveLength(0);
      });

      it('(c) 수정 중 설정 단계가 실패하면 가격표가 원래 값으로 돌아간다', async () => {
        const created = await save({ title: '원본', startsAt: day(1), endsAt: day(2), revision: await revision() });
        const pricing = getContainer().resolve(Modules.PRICING);
        const before = await pricing.listPriceLists(
          { id: [created.data.generalId, created.data.membershipId] },
          { relations: ['prices'] },
        );

        const res = await save({
          title: '바뀐제목',
          startsAt: day(5),
          endsAt: day(6),
          revision: 'stale',
          saleId: created.data.saleId,
          generalId: created.data.generalId,
          membershipId: created.data.membershipId,
          amount: 5000,
        });
        const after = await pricing.listPriceLists(
          { id: [created.data.generalId, created.data.membershipId] },
          { relations: ['prices'] },
        );
        const shape = (lists: typeof before) =>
          lists
            .map((list) => ({
              id: list.id,
              title: list.title,
              status: list.status,
              starts_at: new Date(list.starts_at ?? 0).toISOString(),
              ends_at: new Date(list.ends_at ?? 0).toISOString(),
              amounts: (list.prices ?? []).map((price) => Number(price.amount)).sort(),
            }))
            .sort((a, b) => a.id.localeCompare(b.id));

        expect(res.status).toBe(409);
        expect(shape(after)).toEqual(shape(before));
        expect(await listsWithTitle('바뀐제목')).toHaveLength(0);
      });

      it('(d) 수정할 때 자기 자신과는 겹침으로 보지 않는다', async () => {
        const created = await save({ title: '자기', startsAt: day(1), endsAt: day(3), revision: await revision() });
        const updated = await save({
          title: '자기수정',
          startsAt: day(2),
          endsAt: day(4),
          revision: await revision(),
          saleId: created.data.saleId,
          generalId: created.data.generalId,
          membershipId: created.data.membershipId,
          amount: 7000,
        });

        expect(updated.status).toBe(200);
        expect(updated.data.generalId).toBe(created.data.generalId);

        const lists = await listsWithTitle('자기수정');

        expect(lists).toHaveLength(2);
        expect(lists.every((list) => list.status === 'active')).toBe(true);
      });
    });

    describe('상품별 기간', () => {
      const minutes = (n: number) => new Date(Date.now() + n * 60000).toISOString();

      const storeHeaders = async () => {
        const channel = await api.post('/admin/sales-channels', { name: `time-sale-${seq}` }, adminHeaders);
        const channelId = channel.data.sales_channel.id;
        await api.post(`/admin/sales-channels/${channelId}/products`, { add: [productId, productBId] }, adminHeaders);

        const key = await api.post('/admin/api-keys', { title: `pk-${seq}`, type: 'publishable' }, adminHeaders);
        await api.post(`/admin/api-keys/${key.data.api_key.id}/sales-channels`, { add: [channelId] }, adminHeaders);

        return { headers: { 'x-publishable-api-key': key.data.api_key.token } };
      };

      const productBody = async (products: { productId: string; startsAt: string; endsAt: string }[]) => ({
        ...body({ title: '상품별', startsAt: minutes(-30), endsAt: minutes(150), revision: await revision() }),
        general: {
          description: '타임세일 (전체)',
          rules: { region_id: [regionId] },
          prices: products.map((product) => ({
            amount: 8000,
            currency_code: 'krw',
            variant_id: product.productId === productId ? variantId : variantBId,
          })),
        },
        membership: null,
        periodMode: 'product',
        products,
        display: { ...defaultSaleDisplay(), showScheduled: true },
      });

      it('세일 하나로 저장되고, 지금 기간인 상품만 세일가를 받는다', async () => {
        const a = { productId, startsAt: minutes(-30), endsAt: minutes(30) };
        const b = { productId: productBId, startsAt: minutes(90), endsAt: minutes(150) };

        const saved = await call(async () =>
          api.post('/admin/time-sales/save', await productBody([a, b]), adminHeaders),
        );

        expect(saved.status).toBe(200);
        expect(await listsWithTitle('상품별')).toHaveLength(2);

        const headers = await storeHeaders();
        const presentation = (await api.get('/store/time-sale', headers)).data;
        const sales = presentation.timeSales.filter((sale: { saleId: string }) => sale.saleId === saved.data.saleId);
        const iso = (value: string) => new Date(value).toISOString();

        expect(sales).toHaveLength(1);
        expect(presentation.timeSales).toHaveLength(1);
        expect(
          [...sales[0].products].sort((x: { startsAt: string }, y: { startsAt: string }) =>
            x.startsAt.localeCompare(y.startsAt),
          ),
        ).toEqual([
          { productId, startsAt: iso(a.startsAt), endsAt: iso(a.endsAt) },
          { productId: productBId, startsAt: iso(b.startsAt), endsAt: iso(b.endsAt) },
        ]);

        const products = (
          await api.get(
            `/store/products?id[]=${productId}&id[]=${productBId}&region_id=${regionId}&fields=*variants.calculated_price`,
            headers,
          )
        ).data.products as { id: string; variants: { calculated_price: { calculated_amount: number } }[] }[];
        const amount = (id: string) =>
          products.find((p) => p.id === id)?.variants[0].calculated_price.calculated_amount;

        expect(amount(productId)).toBe(8000);
        expect(amount(productBId)).toBe(10000);
      });

      it('상품을 빼고 다시 저장하면 그 상품 가격표만 지우고 남은 상품은 그대로 쓴다', async () => {
        const a = { productId, startsAt: minutes(-30), endsAt: minutes(30) };
        const b = { productId: productBId, startsAt: minutes(90), endsAt: minutes(150) };

        const first = await call(async () =>
          api.post('/admin/time-sales/save', await productBody([a, b]), adminHeaders),
        );
        const second = await call(async () =>
          api.post('/admin/time-sales/save', { ...(await productBody([a])), saleId: first.data.saleId }, adminHeaders),
        );

        expect(second.status).toBe(200);
        expect(second.data.saleId).toBe(first.data.saleId);
        expect(second.data.generalId).toBe(first.data.generalId);
        expect(await listsWithTitle('상품별')).toHaveLength(1);
      });

      it('여러 그룹을 고치고 빼다 설정 저장이 실패하면 전부 돌아간다', async () => {
        const a = { productId, startsAt: minutes(-30), endsAt: minutes(30) };
        const b = { productId: productBId, startsAt: minutes(90), endsAt: minutes(150) };
        const first = await call(async () =>
          api.post('/admin/time-sales/save', await productBody([a, b]), adminHeaders),
        );
        const pricing = getContainer().resolve(Modules.PRICING);
        const snapshot = async () =>
          (await pricing.listPriceLists({ title: ['상품별'] }, { relations: ['prices'] }))
            .map((list) => ({
              id: list.id,
              status: list.status,
              starts_at: new Date(list.starts_at ?? 0).toISOString(),
              ends_at: new Date(list.ends_at ?? 0).toISOString(),
              amounts: (list.prices ?? []).map((price) => Number(price.amount)).sort(),
            }))
            .sort((x, y) => x.id.localeCompare(y.id));
        const settingsBefore = (await api.get('/admin/time-sale-settings', adminHeaders)).data;
        const before = await snapshot();

        const changed = await productBody([{ productId, startsAt: minutes(-10), endsAt: minutes(50) }]);
        changed.general.prices = changed.general.prices.map((price) => ({ ...price, amount: 5000 }));
        const res = await call(() =>
          api.post(
            '/admin/time-sales/save',
            { ...changed, saleId: first.data.saleId, revision: 'stale' },
            adminHeaders,
          ),
        );

        expect(first.status).toBe(200);
        expect(before).toHaveLength(2);
        expect(res.status).toBe(409);
        expect(await snapshot()).toEqual(before);
        expect((await api.get('/admin/time-sale-settings', adminHeaders)).data).toEqual(settingsBefore);
      });

      it('상품 기간보다 짧은 반복 간격은 400', async () => {
        const products = [
          { productId, startsAt: minutes(0), endsAt: minutes(60) },
          { productId: productBId, startsAt: minutes(60), endsAt: minutes(240) },
        ];
        const res = await call(async () =>
          api.post(
            '/admin/time-sales/save',
            { ...(await productBody(products)), display: { ...defaultSaleDisplay(), repeatHours: 2 } },
            adminHeaders,
          ),
        );

        expect(res.status).toBe(400);
        expect(res.data.message).toContain(productBId);
      });

      it('상품별 기간이 시작보다 종료가 빠르면 400', async () => {
        const res = await call(async () =>
          api.post(
            '/admin/time-sales/save',
            await productBody([{ productId, startsAt: minutes(30), endsAt: minutes(-30) }]),
            adminHeaders,
          ),
        );

        expect(res.status).toBe(400);
      });
    });

    describe('time-sale-write 락', () => {
      it('저장 중인 락은 기본 owner 로 풀리지 않고, 끝나면 풀려 있다', async () => {
        const locking = getContainer().resolve(Modules.LOCKING);
        await locking.acquire('time-sale-write', { ownerId: 'foreign', expire: 1 });

        let done = false;
        const pending = save({ title: '락', startsAt: day(1), endsAt: day(2), revision: await revision() }).finally(
          () => {
            done = true;
          },
        );
        const freedByDefaultOwner: boolean[] = [];
        while (!done) {
          freedByDefaultOwner.push(await locking.release('time-sale-write'));
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        const res = await pending;

        expect(res.status).toBe(200);
        expect(freedByDefaultOwner.some(Boolean)).toBe(false);
        await expect(locking.acquire('time-sale-write', { ownerId: 'after', expire: 1 })).resolves.toBeUndefined();
        await locking.release('time-sale-write', { ownerId: 'after' });
      });
    });

    describe('POST /admin/time-sales/status', () => {
      it('두 가격표를 함께 중지·활성화하고, 겹치는 세일이 활성이면 활성화는 409', async () => {
        const first = await save({ title: '상태', startsAt: day(1), endsAt: day(3), revision: await revision() });
        const ids = [first.data.generalId, first.data.membershipId];

        const stopped = await call(() =>
          api.post('/admin/time-sales/status', { priceListIds: ids, active: false }, adminHeaders),
        );

        expect(stopped.status).toBe(200);
        expect((await listsWithTitle('상태')).every((list) => list.status === 'draft')).toBe(true);

        const other = await save({ title: '대체', startsAt: day(2), endsAt: day(4), revision: await revision() });
        const blocked = await call(() =>
          api.post('/admin/time-sales/status', { priceListIds: ids, active: true }, adminHeaders),
        );

        expect(other.status).toBe(200);
        expect(blocked.status).toBe(409);
        expect(blocked.data.message).toContain('대체');
        expect((await listsWithTitle('상태')).every((list) => list.status === 'draft')).toBe(true);
      });
    });
  },
});
