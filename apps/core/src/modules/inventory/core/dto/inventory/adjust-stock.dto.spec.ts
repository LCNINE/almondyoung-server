import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AdjustStockDto } from './adjust-stock.dto';

const valid = {
  contractVersion: 2,
  skuId: '00000000-0000-4000-8000-000000000001',
  warehouseId: '00000000-0000-4000-8000-000000000002',
  delta: 1,
  reason: 'found',
  idempotencyKey: 'operation',
};
describe('adjust v2 DTO', () => {
  it.each([0, 0.5, Number.MAX_SAFE_INTEGER + 1, -(Number.MAX_SAFE_INTEGER + 1)])(
    'rejects invalid delta %s',
    async (delta) => {
      expect(await validate(plainToInstance(AdjustStockDto, { ...valid, delta }))).not.toHaveLength(0);
    },
  );
  it.each([undefined, '', '   '])('requires a usable v2 operation key (%s)', async (idempotencyKey) => {
    expect(await validate(plainToInstance(AdjustStockDto, { ...valid, idempotencyKey }))).not.toHaveLength(0);
  });
  it('accepts existing v1 without key', async () => {
    expect(
      await validate(
        plainToInstance(AdjustStockDto, { ...valid, contractVersion: undefined, idempotencyKey: undefined }),
      ),
    ).toHaveLength(0);
  });
});
