import { productCatalogSkill } from '../product-catalog/skill';
import type { SkillContext } from '../types';

const search = productCatalogSkill.tools.find((tool) => tool.definition.name === 'search_products')!;

function captureUrl() {
  const urls: string[] = [];
  global.fetch = ((url: string | URL) => {
    urls.push(String(url));
    return Promise.resolve(Response.json({ data: [], total: 0 }));
  }) as typeof fetch;

  const ctx: SkillContext = {
    coreHeaders: () => Promise.resolve({}),
    coreApiUrl: 'http://core',
    fileServiceUrl: 'http://files',
    attachments: [],
  };
  return { ctx, urls };
}

describe('목록 개수 상한', () => {
  // Core 는 limit 에 상한이 없다. 그대로 넘기면 결과가 SSE 한 프레임에 실려
  // 클라이언트 파서 상한을 넘기고, 성공한 턴이 연결 끊김으로 보인다.
  it('모델이 큰 limit 를 줘도 100 으로 묶는다', async () => {
    const { ctx, urls } = captureUrl();

    await search.execute({ limit: 2000 }, ctx);

    expect(urls[0]).toContain('limit=100');
  });

  it('삭제 목록도 같이 묶는다', async () => {
    const { ctx, urls } = captureUrl();

    await search.execute({ deleted: true, limit: 5000 }, ctx);

    expect(urls[0]).toContain('limit=100');
  });

  it('안 주면 기본 20', async () => {
    const { ctx, urls } = captureUrl();

    await search.execute({}, ctx);

    expect(urls[0]).toContain('limit=20');
  });
});
