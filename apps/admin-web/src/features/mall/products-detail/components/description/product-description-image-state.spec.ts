import {
  isProductDescriptionImageBroken,
  shouldShowProductDescriptionImagePlaceholder,
} from './product-description-image-state';

describe('product description image state', () => {
  it('does not keep a previous image load failure after the fileId changes', () => {
    expect(
      isProductDescriptionImageBroken({
        fileId: 'failed-file-id',
        failedFileId: 'failed-file-id',
      }),
    ).toBe(true);

    expect(
      isProductDescriptionImageBroken({
        fileId: 'replacement-file-id',
        failedFileId: 'failed-file-id',
      }),
    ).toBe(false);
  });

  it('shows a placeholder only when the current image cannot be rendered', () => {
    expect(
      shouldShowProductDescriptionImagePlaceholder({
        fileId: 'replacement-file-id',
        error: null,
        failedFileId: 'failed-file-id',
      }),
    ).toBe(false);

    expect(
      shouldShowProductDescriptionImagePlaceholder({
        fileId: 'replacement-file-id',
        error: 'invalid_file_id',
        failedFileId: null,
      }),
    ).toBe(true);
  });
});
