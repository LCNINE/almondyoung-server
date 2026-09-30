import { DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import type { UgcServiceSchema } from '../../db/schema';
import { AlmondTemplateManager, parseAlmondTemplate } from './almond-template.manager';

const PRODUCT = 'A1B2C3D4-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const SVG =
  '<?xml version=\'1.0\' encoding=\'utf-8\'?>\n<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#fff"/></svg>';

const design = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  kind: 'pet',
  productId: PRODUCT,
  widthMm: 600,
  heightMm: 1800,
  title: '  시안 A  ',
  background: '#FFFFFF',
  front: [
    { type: 'rect', x: 20, y: 20, width: 100, height: 100, fill: '#00aa00' },
    { type: 'clipart', x: 130, y: 20, width: 100, height: 100, fill: '#111111' },
    { type: 'text', x: 0, y: 0, width: 50, height: 10, fill: '#00AA00' },
    { type: 'line', x: 0, y: 0, width: 50, height: 10, fill: 'red' },
  ],
  back: [],
  ...overrides,
});

describe('parseAlmondTemplate', () => {
  it('제목을 다듬고 색을 소문자로 중복 없이 도출하고 업종·용도 기본값을 채운다', () => {
    const record = parseAlmondTemplate(design(), SVG);

    expect(record).toMatchObject({
      productId: PRODUCT.toLowerCase(),
      widthMm: 600,
      heightMm: 1800,
      title: '시안 A',
      industry: '미용·뷰티',
      purpose: '이벤트·홍보',
      colors: ['#ffffff', '#00aa00', '#111111'],
    });
    expect(record.design).toMatchObject({ title: '시안 A', productId: PRODUCT.toLowerCase(), kind: 'pet' });
  });

  it('보낸 업종·용도는 그대로 쓴다', () => {
    const record = parseAlmondTemplate(design({ industry: '네일', purpose: '' }), SVG);
    expect(record).toMatchObject({ industry: '네일', purpose: '' });
  });

  it.each<[string, Record<string, unknown>]>([
    ['버전이 1 이 아니다', { version: 2 }],
    ['front 가 배열이 아니다', { front: {} }],
    ['back 이 없다', { back: undefined }],
    ['레이어가 객체가 아니다', { front: ['rect'] }],
    ['양면이 비었다', { front: [], back: [] }],
    ['한 면 레이어가 150 개를 넘는다', { front: Array.from({ length: 151 }, () => ({ type: 'rect' })) }],
    ['너비가 정수가 아니다', { widthMm: 90.5 }],
    ['높이가 35 미만이다', { heightMm: 34 }],
    ['너비가 문자열이다', { widthMm: '90' }],
    ['제목이 공백뿐이다', { title: '   ' }],
    ['제목이 없다', { title: undefined }],
    ['제목이 80자를 넘는다', { title: '가'.repeat(81) }],
    ['업종이 문자열이 아니다', { industry: null }],
    ['용도가 40자를 넘는다', { purpose: '가'.repeat(41) }],
    ['상품 ID 가 UUID 형식이 아니다', { productId: 'pet-banner' }],
  ])('%s 면 거부한다', (_, overrides) => {
    expect(() => parseAlmondTemplate(design(overrides), SVG)).toThrow(BadRequestError);
  });

  it('150 개 레이어는 받는다', () => {
    const front = Array.from({ length: 150 }, () => ({ type: 'rect', fill: '#000000' }));
    expect(parseAlmondTemplate(design({ front }), SVG).colors).toEqual(['#ffffff', '#000000']);
  });

  it.each([
    ['svg 로 시작하지 않는다', '<html><svg></svg></html>'],
    ['script 를 품었다', '<svg><script>alert(1)</script></svg>'],
    ['이벤트 핸들러 속성을 품었다', '<svg onload="alert(1)"></svg>'],
    ['대문자 이벤트 핸들러를 품었다', '<svg><rect ONCLICK="x"/></svg>'],
    ['상한을 넘는다', `<svg>${'a'.repeat(10 * 1024 * 1024)}</svg>`],
  ])('썸네일이 %s 면 거부한다', (_, svg) => {
    expect(() => parseAlmondTemplate(design(), svg)).toThrow(BadRequestError);
  });
});

describe('AlmondTemplateManager.upsert', () => {
  const explodingDb = {
    run: () => {
      throw new Error('검증 전에 DB 에 닿았다');
    },
  } as unknown as DbService<UgcServiceSchema>;

  it('검증에 실패하면 DB 에 닿지 않고 400 으로 거부한다', async () => {
    const manager = new AlmondTemplateManager(explodingDb);
    await expect(manager.upsert(design({ version: 0 }), SVG, 'published', ADMIN)).rejects.toThrow(BadRequestError);
  });
});
