import { materialChanges, materialInputsOf } from './material-changes';

const sku = {
  packageWidthMm: 62,
  packageLengthMm: 36,
  packageHeightMm: 160,
  packageWeightG: 180,
  dimensionBasis: 'package',
};

describe('materialChanges', () => {
  it('is null when nothing changed or there is no previous version', () => {
    const inputs = { photos: [{ fileId: 'a' }], sku };

    expect(materialChanges(inputs, inputs)).toBeNull();
    expect(materialChanges(null, inputs)).toBeNull();
  });

  it('lists added and removed photos', () => {
    const changes = materialChanges(
      { photos: [{ fileId: 'a' }, { fileId: 'b' }], sku },
      { photos: [{ fileId: 'b' }, { fileId: 'c' }], sku },
    );

    expect(changes).toEqual({ addedPhotos: ['c'], removedPhotos: ['a'], dimensions: null });
  });

  it('reports dimension and basis changes', () => {
    const changes = materialChanges(
      { photos: [], sku },
      { photos: [], sku: { ...sku, packageHeightMm: 150, dimensionBasis: 'body' } },
    );

    expect(changes?.dimensions?.after).toMatchObject({ packageHeightMm: 150, dimensionBasis: 'body' });
  });

  it('reads inputs from a revision provenance and ignores old shapes', () => {
    expect(materialInputsOf({ inputs: { photos: [{ fileId: 'a', sortOrder: 1 }], sku } })).toEqual({
      photos: [{ fileId: 'a' }],
      sku,
    });
    expect(materialInputsOf({ smoke: true })).toBeNull();
    expect(materialInputsOf(null)).toBeNull();
  });
});
