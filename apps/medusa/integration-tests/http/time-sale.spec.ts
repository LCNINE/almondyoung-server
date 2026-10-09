import jwt from 'jsonwebtoken';
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { TIME_SALE_MODULE } from '../../src/modules/time-sale';
import type TimeSaleModuleService from '../../src/modules/time-sale/service';
import { createProductsWorkflow, createRegionsWorkflow } from '@medusajs/medusa/core-flows';
import {
  createTimeSaleWorkflow,
  deleteTimeSaleWorkflow,
  updateTimeSaleWorkflow,
} from '../../src/workflows/time-sale/workflows';

jest.setTimeout(180 * 1000);

medusaIntegrationTestRunner({
  inApp: true,
  env: { MEDUSA_MEMBERSHIP_GROUP_ID: 'cusgroup_test' },
  testSuite: ({ api, getContainer }) => {
    describe('time_sale 모듈·링크', () => {
      it('세일 행을 만들고 price list 와 링크한다', async () => {
        const container = getContainer();
        const timeSales = container.resolve<TimeSaleModuleService>(TIME_SALE_MODULE);
        const pricing = container.resolve(Modules.PRICING);
        const link = container.resolve(ContainerRegistrationKeys.LINK);
        const query = container.resolve(ContainerRegistrationKeys.QUERY);

        const sale = await timeSales.createTimeSales({
          title: '스모크',
          starts_at: new Date('2030-01-01T00:00:00Z'),
          ends_at: new Date('2030-01-02T00:00:00Z'),
        });
        const [list] = await pricing.createPriceLists([
          { title: '스모크', description: '타임세일 (전체)', type: 'sale', status: 'draft' },
        ]);
        await link.create({
          [TIME_SALE_MODULE]: { time_sale_id: sale.id },
          [Modules.PRICING]: { price_list_id: list.id },
        });

        const { data } = await query.graph({
          entity: 'time_sale',
          fields: ['id', 'status', 'price_lists.id'],
          filters: { id: sale.id },
        });
        expect(data[0].status).toBe('draft');
        expect(data[0].price_lists.map((p: { id: string }) => p.id)).toEqual([list.id]);
      });
    });

    describe('타임세일 워크플로', () => {
      let variantIds: string[] = [];

      // 러너가 테스트마다 DB 를 비운다 — 매번 리전·상품을 만든다.
      beforeEach(async () => {
        const container = getContainer();
        await createRegionsWorkflow(container).run({
          input: { regions: [{ name: 'KR', currency_code: 'krw', countries: ['kr'] }] },
        });
        const { result } = await createProductsWorkflow(container).run({
          input: {
            products: [
              {
                title: '세일 상품',
                // 한글 제목은 slug 가 '-' 가 돼 handle 검증에 걸린다.
                handle: 'sale-product',
                status: 'published',
                options: [{ title: '색', values: Array.from({ length: 741 }, (_, i) => `c${i}`) }],
                variants: Array.from({ length: 741 }, (_, i) => ({
                  title: `c${i}`,
                  options: { 색: `c${i}` },
                  prices: [{ amount: 1000, currency_code: 'krw' }],
                })),
              },
            ],
          },
        });
        variantIds = result[0].variants.map((v: { id: string }) => v.id);
      });

      const input = (overrides: Record<string, unknown> = {}) => ({
        title: '가을 세일',
        starts_at: '2030-01-01T00:00:00.000Z',
        ends_at: '2030-01-08T00:00:00.000Z',
        status: 'active' as const,
        general_prices: variantIds.map((id) => ({ variant_id: id, amount: 900 })),
        membership_prices: variantIds.slice(0, 10).map((id) => ({ variant_id: id, amount: 800 })),
        ...overrides,
      });

      // 워크플로 엔진을 거친 에러는 Error 인스턴스가 아닌 평범한 객체로 온다 — `.rejects.toThrow()` 는
      // 「did not throw」로 오판한다(coupon-admin.spec.ts 참고). 메시지를 꺼내 비교한다.
      const rejectionOf = async (promise: Promise<unknown>): Promise<{ message?: unknown; type?: unknown }> => {
        try {
          await promise;
        } catch (e) {
          return (e ?? {}) as { message?: unknown; type?: unknown };
        }
        throw new Error('워크플로가 실패하지 않았습니다.');
      };
      const rejectionMessage = async (promise: Promise<unknown>): Promise<string> => {
        const error = await rejectionOf(promise);
        return String(error.message ?? error);
      };

      const livePriceCount = async (priceListId: string) => {
        const pricing = getContainer().resolve(Modules.PRICING);
        const prices = await pricing.listPrices({ price_list_id: [priceListId] });
        return prices.length;
      };

      const linkedLists = async (id: string) => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
        const { data } = await query.graph({
          entity: 'time_sale',
          fields: ['id', 'status', 'title', 'price_lists.id', 'price_lists.status', 'price_lists.title'],
          filters: { id },
        });
        return data[0];
      };

      it('creates a sale with general and membership lists', async () => {
        const { result } = await createTimeSaleWorkflow(getContainer()).run({ input: input() });
        const sale = await linkedLists(result.id);
        expect(sale.price_lists).toHaveLength(2);
        const counts = await Promise.all(sale.price_lists.map((p: { id: string }) => livePriceCount(p.id)));
        expect(counts.sort((a, b) => a - b)).toEqual([10, 741]);
      });

      it('replaces prices without accumulating', async () => {
        const container = getContainer();
        const { result } = await createTimeSaleWorkflow(container).run({ input: input() });
        for (let i = 0; i < 3; i++) {
          await updateTimeSaleWorkflow(container).run({ input: { id: result.id, ...input({ title: `수정 ${i}` }) } });
        }
        const sale = await linkedLists(result.id);
        expect(sale.title).toBe('수정 2');
        for (const list of sale.price_lists) expect(list.title).toBe('수정 2');
        const counts = await Promise.all(sale.price_lists.map((p: { id: string }) => livePriceCount(p.id)));
        expect(counts.sort((a, b) => a - b)).toEqual([10, 741]);
      });

      it('removes and recreates membership list', async () => {
        const container = getContainer();
        const { result } = await createTimeSaleWorkflow(container).run({ input: input() });
        await updateTimeSaleWorkflow(container).run({ input: { id: result.id, ...input({ membership_prices: [] }) } });
        expect((await linkedLists(result.id)).price_lists).toHaveLength(1);
        await updateTimeSaleWorkflow(container).run({ input: { id: result.id, ...input() } });
        expect((await linkedLists(result.id)).price_lists).toHaveLength(2);
      });

      it('rejects a second active sale sharing a variant in an overlapping period', async () => {
        const container = getContainer();
        await createTimeSaleWorkflow(container).run({ input: input() });
        expect(
          await rejectionMessage(
            createTimeSaleWorkflow(container).run({ input: input({ title: '겹침', membership_prices: [] }) }),
          ),
        ).toMatch(/가을 세일/);
      });

      it('publishing a draft re-checks conflicts', async () => {
        const container = getContainer();
        await createTimeSaleWorkflow(container).run({ input: input() });
        const { result } = await createTimeSaleWorkflow(container).run({
          input: input({ title: '복구', status: 'draft', membership_prices: [] }),
        });
        expect(
          await rejectionMessage(
            updateTimeSaleWorkflow(container).run({
              input: { id: result.id, ...input({ title: '복구', status: 'active', membership_prices: [] }) },
            }),
          ),
        ).toMatch(/가을 세일/);
      });

      it('draft sale mirrors draft status onto its price lists', async () => {
        const { result } = await createTimeSaleWorkflow(getContainer()).run({ input: input({ status: 'draft' }) });
        const sale = await linkedLists(result.id);
        expect(sale.price_lists.map((p: { status: string }) => p.status)).toEqual(['draft', 'draft']);
      });

      it('rolls back the sale row and lists when a later step fails', async () => {
        const container = getContainer();
        const timeSales = container.resolve<TimeSaleModuleService>(TIME_SALE_MODULE);
        const before = await timeSales.listTimeSales({});
        // 존재하지 않는 variant 는 core-flows 의 validateVariantPriceLinksStep 에서 던진다 — 세일 행 생성 «뒤».
        expect(
          await rejectionMessage(
            createTimeSaleWorkflow(container).run({
              input: input({ general_prices: [{ variant_id: 'variant_missing', amount: 900 }], membership_prices: [] }),
            }),
          ),
        ).toMatch(/variant_missing/);
        expect(await timeSales.listTimeSales({})).toHaveLength(before.length);
      });

      it('deletes lists, links and the sale row', async () => {
        const container = getContainer();
        const { result } = await createTimeSaleWorkflow(container).run({ input: input() });
        const listIds = (await linkedLists(result.id)).price_lists.map((p: { id: string }) => p.id);
        await deleteTimeSaleWorkflow(container).run({ input: { id: result.id } });
        const pricing = container.resolve(Modules.PRICING);
        expect(await pricing.listPriceLists({ id: listIds })).toHaveLength(0);
        const timeSales = container.resolve<TimeSaleModuleService>(TIME_SALE_MODULE);
        expect(await timeSales.listTimeSales({ id: result.id })).toHaveLength(0);
        // 링크가 남으면 세일을 되살렸을 때 지운 리스트를 다시 끌고 온다.
        const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
        const { rows } = await knex.raw(
          `select 1 from timesale_time_sale_pricing_price_list where time_sale_id = ? and deleted_at is null`,
          [result.id],
        );
        expect(rows).toHaveLength(0);
      });

      it('serializes concurrent updates of the same sale', async () => {
        // 둘 다 같은 옛 가격 id 를 읽으면, 뒤의 것은 지울 게 없어(이미 지워짐) 새 가격만 덧붙인다 → 1,482.
        const container = getContainer();
        const { result } = await createTimeSaleWorkflow(container).run({ input: input() });
        const outcomes = await Promise.allSettled([
          updateTimeSaleWorkflow(container).run({ input: { id: result.id, ...input({ title: '동시 A' }) } }),
          updateTimeSaleWorkflow(container).run({ input: { id: result.id, ...input({ title: '동시 B' }) } }),
        ]);
        expect(outcomes.map((o) => o.status)).toEqual(['fulfilled', 'fulfilled']);
        const sale = await linkedLists(result.id);
        const counts = await Promise.all(sale.price_lists.map((p: { id: string }) => livePriceCount(p.id)));
        expect(counts.sort((a, b) => a - b)).toEqual([10, 741]);
      });

      it('rolls back row, list metadata and removed prices when an update fails late', async () => {
        const container = getContainer();
        const { result } = await createTimeSaleWorkflow(container).run({ input: input() });
        // 실패 지점: createPriceListPricesWorkflow 의 validateVariantPriceLinksStep — 세일 행 갱신·리스트 메타
        // 갱신·옛 가격 삭제가 모두 끝난 «뒤». (membership_prices 를 비워야 prepare 의 고아 검증을 통과한다.)
        expect(
          await rejectionMessage(
            updateTimeSaleWorkflow(container).run({
              input: {
                id: result.id,
                ...input({
                  title: 'X',
                  general_prices: [{ variant_id: 'variant_missing', amount: 900 }],
                  membership_prices: [],
                }),
              },
            }),
          ),
        ).toMatch(/No price set exist for variants: variant_missing/);
        const sale = await linkedLists(result.id);
        expect(sale.title).toBe('가을 세일');
        expect(sale.price_lists).toHaveLength(2);
        for (const list of sale.price_lists) expect(list.title).toBe('가을 세일');
        const counts = await Promise.all(sale.price_lists.map((p: { id: string }) => livePriceCount(p.id)));
        expect(counts.sort((a, b) => a - b)).toEqual([10, 741]);
      });

      it('rejects updating a sale without a general list as invalid data', async () => {
        const container = getContainer();
        const timeSales = container.resolve<TimeSaleModuleService>(TIME_SALE_MODULE);
        const orphan = await timeSales.createTimeSales({
          title: '리스트 없음',
          starts_at: new Date('2030-01-01T00:00:00Z'),
          ends_at: new Date('2030-01-08T00:00:00Z'),
        });
        const error = await rejectionOf(
          updateTimeSaleWorkflow(container).run({ input: { id: orphan.id, ...input({ status: 'draft' }) } }),
        );
        expect(error.message).toMatch(/일반용 price list/);
        // INVALID_DATA 라야 HTTP 400 이다 — 평범한 Error 면 500.
        expect(error.type).toBe('invalid_data');
      });

      describe('HTTP', () => {
        let adminHeaders: { headers: Record<string, string> };

        beforeEach(async () => {
          const container = getContainer();
          const [user] = await container.resolve(Modules.USER).createUsers([{ email: `ts${Date.now()}@test.dev` }]);
          const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as {
            projectConfig: { http: { jwtSecret: string } };
          };
          const token = jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'test-admin', app_metadata: { user_id: user.id } },
            config.projectConfig.http.jwtSecret,
          );
          adminHeaders = { headers: { authorization: `Bearer ${token}` } };
        });

        it('creates, lists, publishes and deletes through the admin routes', async () => {
          const created = await api.post('/admin/time-sales', input({ status: 'draft' }), adminHeaders);
          expect(created.status).toBe(201);
          const id = created.data.timeSale.id;
          expect(Object.keys(created.data.timeSale.generalPrices)).toHaveLength(741);
          expect(Object.keys(created.data.timeSale.membershipPrices)).toHaveLength(10);

          const listed = await api.get('/admin/time-sales', adminHeaders);
          expect(listed.data.timeSales.map((s: { id: string }) => s.id)).toContain(id);

          const published = await api.post(`/admin/time-sales/${id}`, input({ status: 'active' }), adminHeaders);
          expect(published.data.timeSale.status).toBe('active');

          const deleted = await api.delete(`/admin/time-sales/${id}`, adminHeaders);
          expect(deleted.data).toEqual({ id, object: 'time_sale', deleted: true });
        });

        it('returns 400 for an invalid body', async () => {
          await expect(
            api.post('/admin/time-sales', { ...input(), general_prices: [] }, adminHeaders),
          ).rejects.toMatchObject({ response: { status: 400 } });
        });

        it('store route lists only active, in-window sales without titles', async () => {
          const now = Date.now();
          const window = {
            starts_at: new Date(now - 60_000).toISOString(),
            ends_at: new Date(now + 3_600_000).toISOString(),
          };
          await api.post('/admin/time-sales', input({ ...window, status: 'active' }), adminHeaders);
          await api.post(
            '/admin/time-sales',
            input({ ...window, title: '비공개', status: 'draft', membership_prices: [] }),
            adminHeaders,
          );

          const res = await api.get('/store/time-sale', {
            headers: { 'x-publishable-api-key': await publishableKey(getContainer()) },
          });
          expect(res.data.timeSales).toHaveLength(1);
          expect(res.data.timeSales[0]).not.toHaveProperty('title');
          expect(res.data.timeSales[0].priceListIds).toHaveLength(2);
          expect(res.data.products).toHaveLength(1);
          expect(res.data.products[0]).toHaveProperty('categoryIds');
        });
      });
    });
  },
});

async function publishableKey(container: any): Promise<string> {
  const apiKeyModule = container.resolve(Modules.API_KEY);
  const [key] = await apiKeyModule.createApiKeys([{ title: 'store', type: 'publishable', created_by: 'test' }]);
  return key.token;
}
