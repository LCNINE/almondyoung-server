import {
  createProductImageDirective,
  parseProductImageDirective,
  PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID,
  PRODUCT_IMAGE_DIRECTIVE_NAME,
} from './directive';

describe('product description image directive', () => {
  const fileId = '018f70fb-8a0f-7d44-9f1b-4d6f563a1111';

  it('defines the file-service context and directive name', () => {
    expect(PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID).toBe('product-description-image');
    expect(PRODUCT_IMAGE_DIRECTIVE_NAME).toBe('product-image');
  });

  it('parses a valid product-image directive node', () => {
    const result = parseProductImageDirective({
      type: 'leafDirective',
      name: 'product-image',
      attributes: { fileId, alt: '상세 이미지' },
    });

    expect(result).toEqual({
      ok: true,
      fileId,
      alt: '상세 이미지',
    });
  });

  it('rejects nodes with a different directive name', () => {
    const result = parseProductImageDirective({
      type: 'leafDirective',
      name: 'image',
      attributes: { fileId },
    });

    expect(result).toEqual({
      ok: false,
      reason: 'not_product_image_directive',
    });
  });

  it('rejects a missing or invalid fileId', () => {
    expect(
      parseProductImageDirective({
        type: 'leafDirective',
        name: 'product-image',
        attributes: {},
      }),
    ).toEqual({ ok: false, reason: 'missing_file_id' });

    expect(
      parseProductImageDirective({
        type: 'leafDirective',
        name: 'product-image',
        attributes: { fileId: 'https://example.com/image.png' },
      }),
    ).toEqual({ ok: false, reason: 'invalid_file_id' });
  });

  it('creates a markdown directive string with escaped alt text', () => {
    expect(createProductImageDirective({ fileId, alt: '12" nail \\ sample' })).toBe(
      '::product-image{fileId="018f70fb-8a0f-7d44-9f1b-4d6f563a1111" alt="12\\" nail \\\\ sample"}',
    );
  });
});
