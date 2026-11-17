import { BadRequestError } from '@app/shared';
import { SvgRasterizer } from '../../../platform/label/svg-rasterizer';
import { InventoryLabelsReader } from './inventory-labels.reader';
import { InventoryLabelsService } from './inventory-labels.service';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';

describe('InventoryLabelsService', () => {
  const rasterizer = new SvgRasterizer();
  const locationsForLabels = jest.fn();
  const skusForLabels = jest.fn();
  const service = new InventoryLabelsService(
    { locationsForLabels, skusForLabels } as unknown as InventoryLabelsReader,
    rasterizer,
  );

  beforeEach(() => jest.resetAllMocks());

  const count = (zpl: string, token: string) => zpl.split(token).length - 1;

  describe('locationLabels', () => {
    it('reader 가 준 순서가 그대로 쪽 순서다', async () => {
      locationsForLabels.mockResolvedValue([
        { id: ID_A, code: 'A-01-01' },
        { id: ID_B, code: 'A-01-02' },
      ]);
      const res = await service.locationLabels({ rackId: ID_C });
      expect(res.format).toBe('zpl');
      expect(res.labels).toBe(2);
      expect(res.skipped).toEqual([]);
      expect(count(res.data, '^XA')).toBe(2);
      expect(res.data.indexOf('A-01-01')).toBeLessThan(res.data.indexOf('A-01-02'));
    });

    it('한글 코드는 UNSUPPORTED_CODE 로 빠진다', async () => {
      locationsForLabels.mockResolvedValue([
        { id: ID_A, code: 'M-07-꼭대기' },
        { id: ID_B, code: 'M-07-01' },
      ]);
      const res = await service.locationLabels({ rackId: ID_C });
      expect(res.skipped).toEqual([{ ref: ID_A, code: 'M-07-꼭대기', reason: 'UNSUPPORTED_CODE' }]);
      expect(res.labels).toBe(1);
      expect(count(res.data, '^XA')).toBe(1);
    });

    it('요청했는데 reader 가 안 돌려준 id 는 NOT_FOUND 다', async () => {
      locationsForLabels.mockResolvedValue([{ id: ID_A, code: 'A-01-01' }]);
      const res = await service.locationLabels({ locationIds: [ID_A, ID_B] });
      expect(res.skipped).toEqual([{ ref: ID_B, code: null, reason: 'NOT_FOUND' }]);
      expect(res.labels).toBe(1);
    });

    it('rackId 와 locationIds 를 둘 다 주거나 둘 다 안 주면 BadRequestError', async () => {
      await expect(service.locationLabels({})).rejects.toBeInstanceOf(BadRequestError);
      await expect(service.locationLabels({ rackId: ID_A, locationIds: [ID_B] })).rejects.toBeInstanceOf(
        BadRequestError,
      );
      expect(locationsForLabels).not.toHaveBeenCalled();
    });

    it('로케이션이 500개를 넘으면 BadRequestError', async () => {
      locationsForLabels.mockResolvedValue(Array.from({ length: 501 }, (_, i) => ({ id: `id-${i}`, code: `A-${i}` })));
      await expect(service.locationLabels({ rackId: ID_A })).rejects.toBeInstanceOf(BadRequestError);
    });

    it('그릴 것이 없으면 data 가 빈 문자열이다', async () => {
      locationsForLabels.mockResolvedValue([{ id: ID_A, code: '꼭대기' }]);
      const res = await service.locationLabels({ rackId: ID_C });
      expect(res).toMatchObject({ data: '', labels: 0 });
      expect(res.skipped).toHaveLength(1);
    });
  });

  describe('skuLabels', () => {
    const sku = (id: string, barcode: string | null) => ({
      id,
      code: `C-${id.slice(0, 2)}`,
      name: '테스트 상품',
      barcode,
    });

    it('barcode null 은 NO_BARCODE 다', async () => {
      skusForLabels.mockResolvedValue([sku(ID_A, null)]);
      const res = await service.skuLabels({ size: '50x30', items: [{ skuId: ID_A, copies: 1 }] });
      expect(res.skipped).toEqual([{ ref: ID_A, code: 'C-11', reason: 'NO_BARCODE' }]);
      expect(res).toMatchObject({ data: '', labels: 0 });
    });

    it('못 찾은 SKU 는 NOT_FOUND 다', async () => {
      skusForLabels.mockResolvedValue([]);
      const res = await service.skuLabels({ size: '30x10', items: [{ skuId: ID_A, copies: 1 }] });
      expect(res.skipped).toEqual([{ ref: ID_A, code: null, reason: 'NOT_FOUND' }]);
    });

    it('copies: 3 은 그 쪽에 ^PQ3 를 내고 labels 는 장수의 합이다', async () => {
      skusForLabels.mockResolvedValue([sku(ID_A, '8801234567894'), sku(ID_B, '8801234567900')]);
      const res = await service.skuLabels({
        size: '50x30',
        items: [
          { skuId: ID_A, copies: 3 },
          { skuId: ID_B, copies: 1 },
        ],
      });
      expect(res.labels).toBe(4);
      expect(count(res.data, '^XA')).toBe(2);
      expect(count(res.data, '^PQ3')).toBe(1);
      expect(count(res.data, '^PQ1')).toBe(1);
    });

    it('copies 합이 501 이면 렌더 전에 BadRequestError 다', async () => {
      skusForLabels.mockResolvedValue([sku(ID_A, '8801234567894')]);
      const spy = jest.spyOn(rasterizer, 'rasterize');
      await expect(
        service.skuLabels({
          size: '50x30',
          items: [
            { skuId: ID_A, copies: 200 },
            { skuId: ID_B, copies: 200 },
            { skuId: ID_C, copies: 101 },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('copies 합이 정확히 500 이면 통과한다', async () => {
      skusForLabels.mockResolvedValue([sku(ID_A, '8801234567894')]);
      const res = await service.skuLabels({
        size: '50x30',
        items: [
          { skuId: ID_A, copies: 200 },
          { skuId: ID_A, copies: 200 },
          { skuId: ID_A, copies: 100 },
        ],
      });
      expect(res.labels).toBe(500);
    });
  });
});
