import {
  PRODUCT_FILE_URL_PREFIX,
  getProductDescriptionImagePlaceholderText,
  productDescriptionUrlTransform,
} from './product-description-rendering';

describe('product description markdown rendering helpers', () => {
  it('preserves product-file image URLs for ReactMarkdown image src values', () => {
    const fileId = '018f70fb-8a0f-7d44-9f1b-4d6f563a1111';
    const url = `${PRODUCT_FILE_URL_PREFIX}${fileId}`;

    expect(productDescriptionUrlTransform(url, 'src')).toBe(url);
    expect(productDescriptionUrlTransform(url, 'href')).toBe('');
  });

  it('keeps ReactMarkdown-style URL safety for non-product-file URLs', () => {
    expect(
      productDescriptionUrlTransform('https://example.com/image.png', 'src')
    ).toBe('https://example.com/image.png');
    expect(productDescriptionUrlTransform('/relative/image.png', 'src')).toBe(
      '/relative/image.png'
    );
    expect(productDescriptionUrlTransform('javascript:alert(1)', 'src')).toBe(
      ''
    );
  });

  it('includes invalid directive diagnostics and the original file id in placeholders', () => {
    const text = getProductDescriptionImagePlaceholderText({
      fileId: 'bad',
      alt: '상품 상세 이미지',
      error: 'invalid_file_id',
    });

    expect(text).toContain('bad');
    expect(text).toContain('invalid_file_id');
    expect(text).toContain('상품 상세 이미지');
  });
});
