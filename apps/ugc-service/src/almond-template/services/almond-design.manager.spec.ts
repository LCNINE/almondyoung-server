import { DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import type { UgcServiceSchema } from '../../db/schema';
import { AlmondDesignManager, parseAlmondDesign, type AlmondDesignInput } from './almond-design.manager';

const PRODUCT = 'A1B2C3D4-1111-4111-8111-111111111111';
const TEMPLATE = '33333333-3333-4333-8333-333333333333';
const USER = '22222222-2222-4222-8222-222222222222';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="94mm" height="54mm" viewBox="0 0 94 54"><rect/></svg>';

const design = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  productId: PRODUCT,
  widthMm: 90,
  heightMm: 50,
  background: '#ffffff',
  front: [{ type: 'image', src: `file:${TEMPLATE}` }],
  back: [{ type: 'text', text: '뒷면' }],
  ...overrides,
});

const input = (overrides: Partial<AlmondDesignInput> = {}): AlmondDesignInput => ({
  design: design(),
  frontSvg: SVG,
  backSvg: SVG,
  ...overrides,
});

describe('parseAlmondDesign', () => {
  it('상품 ID·템플릿 ID 를 소문자로 맞추고 크기를 뽑는다', () => {
    const record = parseAlmondDesign(input({ templateId: TEMPLATE.toUpperCase() }));
    expect(record).toMatchObject({
      productId: PRODUCT.toLowerCase(),
      widthMm: 90,
      heightMm: 50,
      templateId: TEMPLATE,
      frontSvg: SVG,
      backSvg: SVG,
    });
    expect(record.design.productId).toBe(PRODUCT.toLowerCase());
  });

  it('단면이면 뒷면 SVG 없이 받고 null 로 저장한다', () => {
    const record = parseAlmondDesign(input({ design: design({ back: [] }), backSvg: undefined }));
    expect(record).toMatchObject({ backSvg: null, templateId: null });
  });

  it.each<[string, Partial<AlmondDesignInput>]>([
    ['버전이 1 이 아니다', { design: design({ version: 2 }) }],
    ['front 가 배열이 아니다', { design: design({ front: {} }) }],
    ['back 이 없다', { design: design({ back: undefined }) }],
    ['한 면 레이어가 150 개를 넘는다', { design: design({ front: Array.from({ length: 151 }, () => ({})) }) }],
    ['너비가 정수가 아니다', { design: design({ widthMm: 90.5 }) }],
    ['높이가 35 미만이다', { design: design({ heightMm: 34 }) }],
    ['상품 ID 가 UUID 가 아니다', { design: design({ productId: 'card' }) }],
    ['템플릿 ID 가 UUID 가 아니다', { templateId: 'tpl-1' }],
    [
      '레이어에 data 이미지가 있다',
      { design: design({ front: [{ type: 'image', src: 'data:image/png;base64,AAAA' }] }) },
    ],
    ['깊은 곳에 data URI 가 있다', { design: design({ meta: { list: [{ bg: ' DATA:image/webp;base64,AA' }] } }) }],
    ['뒷면 레이어가 있는데 뒷면 SVG 가 없다', { backSvg: undefined }],
    ['앞면 SVG 가 안전하지 않다', { frontSvg: SVG.replace('<rect/>', '<script/>') }],
    [
      '뒷면 SVG 가 외부 이미지를 부른다',
      { backSvg: SVG.replace('<rect/>', '<image href="https://evil.example/a.png"/>') },
    ],
  ])('%s 면 거부한다', (_, overrides) => {
    expect(() => parseAlmondDesign(input(overrides))).toThrow(BadRequestError);
  });

  it('150 개 레이어와 150 개 뒷면 레이어는 받는다', () => {
    const layers = Array.from({ length: 150 }, () => ({ type: 'rect' }));
    expect(() => parseAlmondDesign(input({ design: design({ front: layers, back: layers }) }))).not.toThrow();
  });

  it('data 로 시작하는 평범한 문구는 이미지로 보지 않는다', () => {
    expect(() => parseAlmondDesign(input({ design: design({ back: [{ text: 'data: 2026' }] }) }))).not.toThrow();
  });
});

describe('AlmondDesignManager.create', () => {
  const explodingDb = {
    run: () => {
      throw new Error('검증 전에 DB 에 닿았다');
    },
  } as unknown as DbService<UgcServiceSchema>;

  it('검증에 실패하면 DB 에 닿지 않고 400 으로 거부한다', async () => {
    const manager = new AlmondDesignManager(explodingDb);
    await expect(manager.create(input({ design: design({ version: 0 }) }), USER)).rejects.toThrow(BadRequestError);
  });
});
