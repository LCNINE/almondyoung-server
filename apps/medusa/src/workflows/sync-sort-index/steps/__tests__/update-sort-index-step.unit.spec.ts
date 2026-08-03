import { updateSortIndexInvoke } from '../update-sort-index-step';

/**
 * 이 스텝은 product.created / product.updated 마다 돈다. calculated_price 조회가
 * price list·멤버십 규칙을 전부 평가해서 비싸므로, 노출되지 않는 상품에선 아예 안 타야 한다.
 * (2026-07-29: 198건 일괄 unpublish 가 이 경로로 Medusa CPU 를 30분간 100% 로 태웠다.)
 */
const PRICED = { id: 'prod_1', variants: [{ id: 'v1', calculated_price: { calculated_amount: 5000 } }] };

const makeContainer = (status: string | undefined) => {
  const graph = jest.fn(async ({ fields }: { fields: string[] }) =>
    fields.includes('status') ? { data: status ? [{ id: 'prod_1', status }] : [] } : { data: [PRICED] },
  );
  const upsertSortIndex = jest.fn(async () => ({ product_id: 'prod_1' }));
  const container = {
    resolve: (key: string) => {
      if (key === 'query') return { graph };
      if (key === 'logger') return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      return { upsertSortIndex };
    },
  };
  return { container, graph, upsertSortIndex };
};

const run = (status: string | undefined) => {
  const h = makeContainer(status);
  // mock 컨테이너는 resolve 의 제네릭 시그니처를 흉내내지 않는다(키별로 다른 모양을 돌려주므로).
  const container = h.container as unknown as { resolve: <T = unknown>(key: string) => T };
  return updateSortIndexInvoke({ product_id: 'prod_1' }, { container }).then(() => h);
};

describe('updateSortIndexInvoke — 노출 안 되는 상품은 가격 계산을 건너뛴다', () => {
  it('draft 상품은 calculated_price 를 조회하지 않고 upsert 도 안 한다', async () => {
    const { graph, upsertSortIndex } = await run('draft');
    expect(graph).toHaveBeenCalledTimes(1); // status 확인 1회로 끝
    expect(graph.mock.calls[0][0].fields).toEqual(['id', 'status']);
    expect(upsertSortIndex).not.toHaveBeenCalled();
  });

  it('published 상품은 기존대로 가격을 계산해 인덱스를 갱신한다', async () => {
    const { graph, upsertSortIndex } = await run('published');
    expect(graph).toHaveBeenCalledTimes(2);
    expect(upsertSortIndex).toHaveBeenCalledWith(
      expect.objectContaining({ product_id: 'prod_1', min_price: 5000, max_price: 5000 }),
    );
  });

  it('상품이 없으면 조용히 끝낸다(삭제 직후 이벤트)', async () => {
    const { upsertSortIndex } = await run(undefined);
    expect(upsertSortIndex).not.toHaveBeenCalled();
  });
});
