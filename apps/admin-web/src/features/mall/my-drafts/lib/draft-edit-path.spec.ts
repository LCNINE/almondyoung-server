import { buildDraftEditPath } from './draft-edit-path';

describe('buildDraftEditPath', () => {
  it('builds the version-scoped edit path', () => {
    expect(buildDraftEditPath('m1', 'v1')).toBe('/mall/products-list/m1?versionId=v1');
  });
});
