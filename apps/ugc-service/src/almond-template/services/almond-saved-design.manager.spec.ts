import { BadRequestError } from '@app/shared';
import { parseAlmondSavedDesign } from './almond-saved-design.manager';

const PRODUCT = 'A1B2C3D4-1111-4111-8111-111111111111';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 50"><rect/></svg>';

const design = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  productId: PRODUCT,
  widthMm: 90,
  heightMm: 50,
  title: ' 우리 샵 명함 ',
  background: '#ffffff',
  backBackground: { background: '#fff799' },
  front: [{ type: 'text', text: '앞면' }],
  back: [],
  ...overrides,
});

describe('parseAlmondSavedDesign', () => {
  it('상품 ID 를 소문자로, 이름을 다듬어 저장할 값만 뽑는다', () => {
    const record = parseAlmondSavedDesign(design(), SVG);
    expect(record).toMatchObject({
      productId: PRODUCT.toLowerCase(),
      widthMm: 90,
      heightMm: 50,
      title: '우리 샵 명함',
    });
    expect(record.design.backBackground).toEqual({ background: '#fff799' });
  });

  it.each<[string, Record<string, unknown>]>([
    ['이름이 없다', design({ title: '  ' })],
    ['빈 시안이다', design({ front: [] })],
    ['이미지를 data URI 로 넣었다', design({ front: [{ type: 'image', image: 'data:image/png;base64,AAAA' }] })],
    [
      '뒷면 배경 이미지를 data URI 로 넣었다',
      design({ backBackground: { background: '#fff', backgroundImage: 'data:image/png;base64,AA' } }),
    ],
  ])('%s 면 거부한다', (_, value) => {
    expect(() => parseAlmondSavedDesign(value, SVG)).toThrow(BadRequestError);
  });

  it('스크립트가 든 썸네일은 거부한다', () => {
    expect(() => parseAlmondSavedDesign(design(), '<svg><script>alert(1)</script></svg>')).toThrow(BadRequestError);
  });
});
