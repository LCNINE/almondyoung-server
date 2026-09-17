import { copyIndex } from './migrate-opensearch';

const plan = { name: 'products', settings: {}, mappings: {} };
const options = { indices: ['products'], batchSize: 2, dryRun: false, scrollTtl: '5m' };
const hit = (id: string) => ({ _id: id, _source: { name: id } });

function clients(batches: any[][]) {
  const response = (hits: any[]) => ({ body: { _scroll_id: 'scroll', hits: { hits } } });
  const source = {
    count: jest.fn().mockResolvedValue({ body: { count: batches.flat().length } }),
    search: jest.fn().mockResolvedValue(response(batches[0])),
    scroll: jest.fn(),
    clearScroll: jest.fn().mockResolvedValue({}),
  };
  for (const batch of [...batches.slice(1), []]) source.scroll.mockResolvedValueOnce(response(batch));
  const target = {
    count: jest.fn().mockResolvedValue({ body: { count: 100 } }),
    indices: { exists: jest.fn().mockResolvedValue({ body: true }), refresh: jest.fn().mockResolvedValue({}) },
    bulk: jest.fn().mockImplementation(async ({ body }) => ({
      body: {
        errors: false,
        items: body.filter((_: unknown, i: number) => i % 2 === 0).map(() => ({ index: { status: 200 } })),
      },
    })),
  };
  return { source, target };
}

describe('OpenSearch migration completion', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => jest.restoreAllMocks());

  it('fails on an earlier bulk error even when later batches succeed and the target count is sufficient', async () => {
    const { source, target } = clients([
      [hit('a'), hit('b')],
      [hit('c'), hit('d')],
    ]);
    target.bulk.mockResolvedValueOnce({
      body: {
        errors: true,
        items: [{ index: { status: 200 } }, { index: { status: 429, error: { type: 'rejected' } } }],
      },
    });
    await expect(copyIndex(source as any, target as any, plan, options)).rejects.toThrow('색인 실패 1건');
    expect(process.stdout.write).toHaveBeenCalledWith('\r  복사 3 / 4');
    expect(target.count).not.toHaveBeenCalled();
    expect(source.clearScroll).toHaveBeenCalled();
  });

  it('rejects documents without _source rather than declaring a dry run successful', async () => {
    const { source, target } = clients([[{ _id: 'missing' }]]);
    await expect(copyIndex(source as any, target as any, plan, { ...options, dryRun: true })).rejects.toThrow(
      '_source 누락 1건',
    );
    expect(target.bulk).not.toHaveBeenCalled();
    expect(source.clearScroll).toHaveBeenCalled();
  });

  it('refreshes and verifies successful copies, allowing post-cutover documents on the target', async () => {
    const { source, target } = clients([[hit('a')], [hit('b')]]);
    await expect(copyIndex(source as any, target as any, plan, options)).resolves.toBeUndefined();
    expect(target.indices.refresh).toHaveBeenCalledWith({ index: 'products' });
    expect(target.count).toHaveBeenCalledWith({ index: 'products' });
    expect(process.stdout.write).toHaveBeenCalledWith('\r  복사 2 / 2');
  });
});
