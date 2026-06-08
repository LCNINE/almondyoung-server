import {
  PRODUCT_ADDITIONAL_IMAGE_LIMIT,
  canAddAdditionalProductImage,
  canEditProductImages,
  toProductImageFormValues,
  toProductImageUpdateDto,
} from './product-images-model';

describe('product images editing model', () => {
  const detail = {
    source: 'version' as const,
    versionId: 'ver-draft',
    status: 'draft' as const,
    images: [
      {
        id: 'img-extra-late',
        fileId: 'file-extra-late',
        isPrimary: false,
        sortOrder: 2,
      },
      {
        id: 'img-primary',
        fileId: 'file-primary',
        isPrimary: true,
        sortOrder: 0,
      },
      {
        id: 'img-extra-early',
        fileId: 'file-extra-early',
        isPrimary: false,
        sortOrder: 1,
      },
    ],
  };

  it('allows editing only for draft version detail views', () => {
    expect(canEditProductImages(detail)).toBe(true);

    expect(
      canEditProductImages({
        ...detail,
        source: 'master',
        versionId: null,
        status: 'active',
      })
    ).toBe(false);

    expect(
      canEditProductImages({
        ...detail,
        source: 'version',
        versionId: 'ver-active',
        status: 'active',
      })
    ).toBe(false);

    expect(
      canEditProductImages({
        ...detail,
        source: 'version',
        versionId: 'ver-inactive',
        status: 'inactive',
      })
    ).toBe(false);
  });

  it('normalizes current images into representative and ordered additional image file ids', () => {
    expect(toProductImageFormValues(detail)).toEqual({
      representativeFileId: 'file-primary',
      additionalImageFileIds: ['file-extra-early', 'file-extra-late'],
    });
  });

  it('keeps representative empty when the server returns only additional images', () => {
    expect(
      toProductImageFormValues({
        ...detail,
        images: [
          {
            id: 'img-extra-late',
            fileId: 'file-extra-late',
            isPrimary: false,
            sortOrder: 2,
          },
          {
            id: 'img-extra-early',
            fileId: 'file-extra-early',
            isPrimary: false,
            sortOrder: 1,
          },
        ],
      })
    ).toEqual({
      representativeFileId: null,
      additionalImageFileIds: ['file-extra-early', 'file-extra-late'],
    });
  });

  it('builds a version update payload that can clear representative and replace additional images', () => {
    expect(
      toProductImageUpdateDto({
        representativeFileId: null,
        additionalImageFileIds: ['file-new-1', 'file-new-2'],
      })
    ).toEqual({
      thumbnailFileId: null,
      additionalImageFileIds: ['file-new-1', 'file-new-2'],
    });
  });

  it('enforces the Core limit for additional images before saving', () => {
    expect(PRODUCT_ADDITIONAL_IMAGE_LIMIT).toBe(5);
    expect(
      canAddAdditionalProductImage(['file-1', 'file-2', 'file-3', 'file-4'])
    ).toBe(true);
    expect(
      canAddAdditionalProductImage([
        'file-1',
        'file-2',
        'file-3',
        'file-4',
        'file-5',
      ])
    ).toBe(false);

    expect(() =>
      toProductImageUpdateDto({
        representativeFileId: 'file-primary',
        additionalImageFileIds: [
          'file-1',
          'file-2',
          'file-3',
          'file-4',
          'file-5',
          'file-6',
        ],
      })
    ).toThrow('부가 이미지는 최대 5개까지 가능합니다.');
  });
});
