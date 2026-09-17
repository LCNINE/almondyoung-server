import { parseDemoCatalogQuery } from './demo-catalog.service';

describe('demo catalog query boundary', () => {
  it('uses bounded stable pagination and deduplicates explicit variants', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(parseDemoCatalogQuery({ variantIds: `${id},${id}`, search: '  바코드  ' })).toEqual({
      page: 1,
      limit: 100,
      search: '바코드',
      variantIds: [id],
    });
  });
  it.each([{ page: '0' }, { limit: '101' }, { variantIds: 'bad-id' }, { search: 'x'.repeat(201) }])(
    'rejects malformed or unbounded input %j',
    (query) => {
      expect(() => parseDemoCatalogQuery(query)).toThrow();
    },
  );
});
