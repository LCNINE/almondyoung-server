import { productQueryKeys } from './query-keys';

describe('product query keys', () => {
  it('keeps raw version detail DTO cache separate from normalized version detail view cache', () => {
    const keys = productQueryKeys as typeof productQueryKeys & {
      versionDetailRaw?: typeof productQueryKeys.versionDetail;
    };
    const normalizedKey = productQueryKeys.versionDetail('master-1', 'version-1');

    expect(keys.versionDetailRaw).toEqual(expect.any(Function));
    expect(keys.versionDetailRaw?.('master-1', 'version-1')).not.toEqual(
      normalizedKey
    );
    expect(keys.versionDetailRaw?.('master-1', 'version-1')).toEqual([
      ...normalizedKey,
      'raw',
    ]);
  });
});
