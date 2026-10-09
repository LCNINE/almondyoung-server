import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { TIME_SALE_MODULE } from '../../src/modules/time-sale';
import type TimeSaleModuleService from '../../src/modules/time-sale/service';

jest.setTimeout(180 * 1000);

medusaIntegrationTestRunner({
  inApp: true,
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
  },
});
