import {
  createProductImageDirective,
  fitCropToAspect,
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

describe('fitCropToAspect', () => {
  it('칸과 비율이 비슷한 세로 대상 하나는 자르지 않고 가로를 넓힌다', () => {
    // 1000px 원본에서 100×300 (1:3) 을 3:5 칸에 — 칸보다 1.8배 길다 → 두 줄로 보고 위쪽만 남긴다
    const stacked = fitCropToAspect({ x: 0.4, y: 0.4, w: 0.1, h: 0.3 }, 1000, 1000, 0.6);
    expect(stacked).toMatchObject({ x: 0.4, y: 0.4, w: 0.1 });
    expect(stacked.h).toBeCloseTo(0.1667, 3);

    // 80×150 (1:1.9) 를 3:5 칸에 — 칸보다 1.13배 → 칩 하나. 세로 전부 보존
    const single = fitCropToAspect({ x: 0.4, y: 0.4, w: 0.08, h: 0.15 }, 1000, 1000, 0.6);
    expect(single.h).toBeCloseTo(0.15);
    expect(single.y).toBeCloseTo(0.4);
    expect((single.w * 1000) / (single.h * 1000)).toBeCloseTo(0.6);
  });

  it('가로로 긴 crop 은 중심을 지키며 세로를 넓힌다', () => {
    const fitted = fitCropToAspect({ x: 0.3, y: 0.4, w: 0.4, h: 0.1 }, 1000, 1000, 0.75);

    expect(fitted.y + fitted.h / 2).toBeCloseTo(0.45);
    expect((fitted.w * 1000) / (fitted.h * 1000)).toBeCloseTo(0.75);
  });

  it('넓힌 crop 이 원본 밖으로 나가면 안쪽으로 밀고, 원본보다 크면 원본 안으로 줄인다', () => {
    const edge = fitCropToAspect({ x: 0.3, y: 0.95, w: 0.4, h: 0.05 }, 1000, 1000, 0.75);
    expect(edge.y + edge.h).toBeLessThanOrEqual(1);

    const wide = fitCropToAspect({ x: 0, y: 0, w: 1, h: 0.5 }, 1000, 200, 0.75);
    expect(wide.h).toBeCloseTo(1);
    expect((wide.w * 1000) / (wide.h * 200)).toBeCloseTo(0.75);
  });
});
