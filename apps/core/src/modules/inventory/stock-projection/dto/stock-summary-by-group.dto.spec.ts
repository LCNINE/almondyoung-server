import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetStockSummaryByGroupQueryDto } from './stock-summary-by-group.dto';

async function invalidFields(input: Record<string, unknown>) {
  return (await validate(plainToInstance(GetStockSummaryByGroupQueryDto, input))).map((error) => error.property);
}

describe('GetStockSummaryByGroupQueryDto', () => {
  it('accepts optional filters, numeric query strings and the default warehouse UUID', async () => {
    expect(await invalidFields({})).toEqual([]);
    expect(
      await invalidFields({
        warehouseId: '00000000-0000-0000-0000-000000000001',
        supplierId: '11111111-1111-4111-8111-111111111111',
        search: 'hat',
        queue: 'unshipped',
        page: '2',
        limit: '10',
      }),
    ).toEqual([]);
  });

  it.each(['unshipped', 'shortage', 'below_safety_stock', 'out_of_stock'])('accepts queue %s', async (queue) => {
    expect(await invalidFields({ queue })).toEqual([]);
  });

  it('accepts several queues joined by commas and rejects an unknown one among them', async () => {
    expect(await invalidFields({ queue: 'unshipped,below_safety_stock' })).toEqual([]);
    expect(await invalidFields({ queue: 'unshipped,reserved' })).toEqual(['queue']);
  });

  it('rejects malformed identifiers, unknown queues and invalid pagination', async () => {
    expect(
      await invalidFields({
        warehouseId: 'bad',
        supplierId: 'bad',
        queue: 'reserved',
        page: '0',
        limit: '1.5',
        search: [],
      }),
    ).toEqual(expect.arrayContaining(['warehouseId', 'supplierId', 'queue', 'page', 'limit', 'search']));
  });
});
