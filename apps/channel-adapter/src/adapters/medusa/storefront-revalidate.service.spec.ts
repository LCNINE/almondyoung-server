import { StorefrontRevalidateService } from './storefront-revalidate.service';

/**
 * 태그 누락은 조용히 실패한다 — revalidate 는 200 을 돌려주고 캐시만 안 비워져
 * 상세설명 변경이 최대 1시간 늦게 노출된다. 그래서 body 를 직접 확인한다.
 */
describe('StorefrontRevalidateService', () => {
  const url = 'https://storefront.example/api/revalidate';
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.STOREFRONT_REVALIDATE_URL = url;
    process.env.STOREFRONT_REVALIDATE_SECRET = 'secret';
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('상품 무효화 시 pim-detail 태그를 함께 보낸다', async () => {
    await new StorefrontRevalidateService().revalidateProduct('master-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(url);
    expect(JSON.parse(init.body)).toEqual({
      handle: 'master-1',
      tags: ['pim-detail-master-1'],
    });
  });

  it('URL/시크릿이 없으면 호출하지 않는다', async () => {
    delete process.env.STOREFRONT_REVALIDATE_URL;

    await new StorefrontRevalidateService().revalidateProduct('master-1');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('첫 handle 만 handle 로 보내고 나머지는 태그로 보낸다', async () => {
    await new StorefrontRevalidateService().revalidateProducts(['m1', 'm2', 'm3']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      handle: 'm1',
      tags: ['pim-detail-m1', 'product-m2', 'pim-detail-m2', 'product-m3', 'pim-detail-m3'],
    });
  });

  it('카테고리 무효화 시 트리 태그를 항상 보낸다', async () => {
    await new StorefrontRevalidateService().revalidateCategory('pcat_1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      tags: ['product-categories', 'category-thumbnail-pcat_1'],
    });
  });

  it('카테고리 id 를 몰라도 트리 태그는 보낸다', async () => {
    await new StorefrontRevalidateService().revalidateCategory();

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      tags: ['product-categories'],
    });
  });

  it('handle 이 없으면 호출하지 않는다', async () => {
    await new StorefrontRevalidateService().revalidateProducts([]);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
