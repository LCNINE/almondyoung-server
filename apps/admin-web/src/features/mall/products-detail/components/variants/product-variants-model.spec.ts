import {
  canEditProductVariants,
  toBulkProductVariantUpdateDto,
  toProductVariantFormValues,
  toProductVariantUpdateDto,
} from './product-variants-model';

describe('product variant editing model', () => {
  const draftDetail = {
    source: 'version' as const,
    versionId: 'ver-draft',
    status: 'draft' as const,
  };

  const variant = {
    id: 'variant-1',
    masterId: 'master-1',
    variantName: '  Current Name  ',
    imageId: null,
    displayOrder: 2,
    status: 'active',
    isDefault: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    optionValues: [],
    price: 1000,
  };

  it('allows editing only for draft version detail views', () => {
    expect(canEditProductVariants(draftDetail)).toBe(true);

    expect(
      canEditProductVariants({
        ...draftDetail,
        source: 'master',
        versionId: null,
        status: 'active',
      })
    ).toBe(false);

    expect(
      canEditProductVariants({
        ...draftDetail,
        source: 'version',
        versionId: 'ver-active',
        status: 'active',
      })
    ).toBe(false);

    expect(
      canEditProductVariants({
        ...draftDetail,
        source: 'version',
        versionId: 'ver-inactive',
        status: 'inactive',
      })
    ).toBe(false);
  });

  it('normalizes current variant values for the edit form', () => {
    expect(toProductVariantFormValues(variant)).toEqual({
      variantName: '  Current Name  ',
      status: 'active',
      displayOrder: '2',
    });

    expect(
      toProductVariantFormValues({
        ...variant,
        variantName: null,
        status: null,
        displayOrder: null,
      })
    ).toEqual({
      variantName: '',
      status: 'active',
      displayOrder: '',
    });
  });

  it('builds a trimmed single-variant update payload with only changed fields', () => {
    expect(
      toProductVariantUpdateDto(variant, {
        variantName: '  Edited Name  ',
        status: 'active',
        displayOrder: ' 7 ',
      })
    ).toEqual({
      variantName: 'Edited Name',
      displayOrder: 7,
    });
  });

  it('omits unchanged status from single-variant update payloads', () => {
    expect(
      toProductVariantUpdateDto(variant, {
        variantName: '  Current Name  ',
        status: 'active',
        displayOrder: '2',
      })
    ).toEqual({});
  });

  it('includes status only when it actually changes', () => {
    expect(
      toProductVariantUpdateDto(variant, {
        variantName: '  Current Name  ',
        status: 'inactive',
        displayOrder: '2',
      })
    ).toEqual({
      status: 'inactive',
    });
  });

  it('omits blank variant names so unnamed draft variants can still be edited', () => {
    expect(
      toProductVariantUpdateDto(
        {
          ...variant,
          variantName: null,
          status: 'active',
          displayOrder: 2,
        },
        {
          variantName: '   ',
          status: 'inactive',
          displayOrder: '4',
        }
      )
    ).toEqual({
      status: 'inactive',
      displayOrder: 4,
    });
  });

  it('rejects blank and invalid display order values', () => {
    expect(() =>
      toProductVariantUpdateDto(variant, {
        variantName: 'Edited Name',
        status: 'active',
        displayOrder: '   ',
      })
    ).toThrow('표시 순서를 입력하세요.');

    expect(() =>
      toProductVariantUpdateDto(variant, {
        variantName: 'Edited Name',
        status: 'active',
        displayOrder: '-1',
      })
    ).toThrow('표시 순서는 0 이상의 숫자여야 합니다.');

    expect(() =>
      toProductVariantUpdateDto(variant, {
        variantName: 'Edited Name',
        status: 'active',
        displayOrder: 'abc',
      })
    ).toThrow('표시 순서는 0 이상의 숫자여야 합니다.');
  });

  it('builds a bulk status update payload only for rows whose status changes', () => {
    expect(
      toBulkProductVariantUpdateDto(
        [
          { ...variant, id: 'variant-a' },
          { ...variant, id: 'variant-b', status: 'inactive' },
        ],
        { status: 'inactive' }
      )
    ).toEqual({
      updates: [{ id: 'variant-a', status: 'inactive' }],
    });
  });
});
