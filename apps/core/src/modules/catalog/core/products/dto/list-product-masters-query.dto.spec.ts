import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListProductMastersQueryDto } from './list-product-masters-query.dto';

function toDto(raw: Record<string, unknown>) {
  return plainToInstance(ListProductMastersQueryDto, raw, { enableImplicitConversion: false });
}

describe('ListProductMastersQueryDto', () => {
  it('coerces numeric strings for page/limit', () => {
    const dto = toDto({ page: '2', limit: '30' });
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(30);
  });

  it("transforms deleted='true' to boolean true and anything else to false", () => {
    expect(toDto({ deleted: 'true' }).deleted).toBe(true);
    expect(toDto({ deleted: 'false' }).deleted).toBe(false);
    expect(toDto({}).deleted).toBeUndefined();
  });

  it('splits comma-separated ids into a trimmed array', () => {
    expect(toDto({ ids: 'a, b ,c' }).ids).toEqual(['a', 'b', 'c']);
  });

  it('accepts a fully valid query with the new filters', async () => {
    const dto = toDto({
      q: '립스틱',
      categoryId: '018f9c2e-0000-7000-8000-000000000000',
      brand: 'Almond',
      mode: 'all',
      productType: 'limited_edition',
      approvalStatus: 'pending',
      createdFrom: '2026-01-01',
      createdTo: '2026-01-31',
      sort: 'name',
      order: 'asc',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects invalid enum values', async () => {
    const dto = toDto({ productType: 'nonsense', approvalStatus: 'bogus', sort: 'price', order: 'up' });
    const errors = await validate(dto);
    const props = errors.map((e) => e.property).sort();
    expect(props).toEqual(['approvalStatus', 'order', 'productType', 'sort']);
  });
});
