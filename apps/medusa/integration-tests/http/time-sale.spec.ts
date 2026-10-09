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
  testSuite: ({ getContainer }) => {
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
      const rejectionMessage = async (promise: Promise<unknown>): Promise<string> => {
        try {
          await promise;
        } catch (e) {
          return String((e as { message?: unknown } | null)?.message ?? e);
        }
        throw new Error('워크플로가 실패하지 않았습니다.');
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
      });
    });
  },
});
