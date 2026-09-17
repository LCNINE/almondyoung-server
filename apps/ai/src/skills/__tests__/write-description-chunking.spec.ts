import type { ExtractResult } from '@packages/product-description';
import { productCatalogSkill } from '../product-catalog/skill';
import type { SkillContext } from '../types';

const extractCalls: string[][] = [];
let inFlight = 0;
let peakInFlight = 0;

jest.mock('../../product-description/services/anthropic', () => ({
  getAnthropicClient: () => ({}),
}));

jest.mock('../../product-description/services/extract', () => ({
  extractProductFacts: async (_client: unknown, fileIds: string[]) => {
    extractCalls.push(fileIds);
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    // 다음 마이크로태스크까지 붙잡아 둬야 동시 실행 수가 측정된다.
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    const result: ExtractResult = {
      images: fileIds.map((fileId) => ({ fileId, kind: '제품컷' as const, content: fileId })),
      facts: { brand: '', capacity: '', origin: '', composition: '', expiry: '' },
      features: [],
      usageSteps: [],
      cautions: [],
    };
    return Response.json({ result });
  },
}));

let composedImages = 0;

jest.mock('../../product-description/services/compose', () => ({
  composeProductDescription: (_client: unknown, request: { result: ExtractResult }) => {
    composedImages = request.result.images.length;
    return Promise.resolve(Response.json({ markdown: '# 본문' }));
  },
}));

const writeDescription = productCatalogSkill.tools.find(
  (tool) => tool.definition.name === 'write_product_description',
)!;

const ctx: SkillContext = {
  coreHeaders: () => Promise.resolve({}),
  coreApiUrl: 'http://core',
  fileServiceUrl: 'http://files',
  attachments: [],
};

describe('write_product_description 이미지 청킹', () => {
  beforeEach(() => {
    extractCalls.length = 0;
    composedImages = 0;
    inFlight = 0;
    peakInFlight = 0;
  });

  // 청킹 전에는 9장부터 추출이 400 을 내서 이 도구가 항상 실패했다.
  it('8장을 넘으면 나눠 추출하고 결과를 합쳐 한 번 작성한다', async () => {
    const fileIds = Array.from({ length: 10 }, (_, i) => `f${i}`);

    const result = await writeDescription.execute({ fileIds }, ctx);

    expect(extractCalls.map((chunk) => chunk.length)).toEqual([8, 2]);
    expect(composedImages).toBe(10);
    expect(result).toMatchObject({ ok: true, markdown: '# 본문' });
  });

  it('8장 이하면 추출은 한 번', async () => {
    await writeDescription.execute({ fileIds: ['a', 'b'] }, ctx);

    expect(extractCalls).toEqual([['a', 'b']]);
  });

  // fileIds 는 모델이 주는 배열이라 개수 상한이 없다. 통째로 병렬로 돌리면 청크마다
  // 원본 + base64 사본을 동시에 물어 메모리가 장수에 비례해 튄다.
  it('장수가 아무리 많아도 동시 추출은 3개를 넘지 않는다', async () => {
    const fileIds = Array.from({ length: 100 }, (_, i) => `f${i}`);

    await writeDescription.execute({ fileIds }, ctx);

    expect(extractCalls).toHaveLength(13);
    expect(peakInFlight).toBeLessThanOrEqual(3);
    expect(composedImages).toBe(100);
  });
});
