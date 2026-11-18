import {
  createProductImageDirective,
  parseImageCrop,
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

  it('creates a markdown directive string with directive-safe alt text entities', () => {
    expect(createProductImageDirective({ fileId, alt: 'AT&T "nail" <sample> \\ path' })).toBe(
      '::product-image{fileId="018f70fb-8a0f-7d44-9f1b-4d6f563a1111" alt="AT&amp;T &quot;nail&quot; &lt;sample&gt; \\ path"}',
    );
  });
});

describe('product image crop', () => {
  const fileId = '018f70fb-8a0f-7d44-9f1b-4d6f563a1111';

  it('keeps a valid crop on the parsed image', () => {
    const result = parseProductImageDirective({
      name: 'product-image',
      attributes: { fileId, crop: '0.32, 0.45, 0.085, 0.085' },
    });

    expect(result).toEqual({ ok: true, fileId, alt: '', crop: { x: 0.32, y: 0.45, w: 0.085, h: 0.085 } });
  });

  it.each(['1,2,3', 'a,b,c,d', '0.9,0,0.2,0.5', '0,0,0,0.5', '-0.1,0,0.5,0.5'])(
    'drops an invalid crop "%s" but keeps the image',
    (crop) => {
      const result = parseProductImageDirective({ name: 'product-image', attributes: { fileId, crop } });

      expect(result).toEqual({ ok: true, fileId, alt: '' });
    },
  );

  it('round-trips a crop through the directive string', () => {
    const directive = createProductImageDirective({ fileId, alt: '', crop: { x: 0.3245, y: 0.45, w: 0.085, h: 0.085 } });

    expect(directive).toBe(`::product-image{fileId="${fileId}" alt="" crop="0.3245,0.45,0.085,0.085"}`);
    expect(parseImageCrop('0.3245,0.45,0.085,0.085')).toEqual({ x: 0.3245, y: 0.45, w: 0.085, h: 0.085 });
  });
});
