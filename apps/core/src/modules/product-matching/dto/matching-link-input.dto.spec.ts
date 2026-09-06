import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MatchingLinkInputDto } from './matching-link-input.dto';

const SKU_ID = '44444444-4444-4444-4444-444444444444';

async function errorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(MatchingLinkInputDto, payload);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('MatchingLinkInputDto', () => {
  it('accepts a reference to an existing SKU', async () => {
    expect(await errorsFor({ skuId: SKU_ID, quantity: 2 })).toEqual([]);
  });

  it('accepts a new SKU definition', async () => {
    expect(await errorsFor({ newSku: { name: 'S / 검정' } })).toEqual([]);
  });

  it('rejects a link that carries both skuId and newSku', async () => {
    expect(await errorsFor({ skuId: SKU_ID, newSku: { name: 'S / 검정' } })).toContain('skuId');
  });

  it('rejects a link that carries neither', async () => {
    expect(await errorsFor({ quantity: 3 })).toContain('skuId');
  });

  it('rejects a malformed skuId', async () => {
    expect(await errorsFor({ skuId: 'not-a-uuid' })).toContain('skuId');
  });

  it('rejects a newSku without a name', async () => {
    expect(await errorsFor({ newSku: { optionKey: 'S' } })).toContain('newSku');
  });

  it('rejects quantity below 1', async () => {
    expect(await errorsFor({ skuId: SKU_ID, quantity: 0 })).toContain('quantity');
  });
});
