import { MASTER_LIST_MAX_LIMIT, resolveMasterListPaging } from './product-masters-paging.util';

/**
 * 예전엔 page 가 없으면 limit 을 무시하고 전량(99999)을 줬다. 그 요청 하나가 상품 만 단위를
 * 메모리에 올려 core 를 OOM 으로 내렸다(2026-11-02 라이브 두 번). 이제 page 가 없으면 1 쪽이다.
 */
describe('resolveMasterListPaging', () => {
  it('page 가 없으면 1 쪽, 기본 15 건이다', () => {
    expect(resolveMasterListPaging({})).toEqual({ page: 1, limit: 15, offset: 0 });
  });

  it('page 없이 limit 만 주면 limit 이 먹는다', () => {
    expect(resolveMasterListPaging({ limit: 100 })).toEqual({ page: 1, limit: 100, offset: 0 });
  });

  it(`limit 은 ${MASTER_LIST_MAX_LIMIT} 을 넘지 않는다`, () => {
    expect(resolveMasterListPaging({ page: 2, limit: 99999 })).toEqual({
      page: 2,
      limit: MASTER_LIST_MAX_LIMIT,
      offset: MASTER_LIST_MAX_LIMIT,
    });
  });

  it('ids 로 부르면 limit 을 안 줘도 id 수만큼 준다', () => {
    expect(resolveMasterListPaging({ ids: ['a', 'b', 'c'] })).toEqual({ page: 1, limit: 3, offset: 0 });
  });

  it('ids 도 상한을 넘지 않는다', () => {
    const ids = Array.from({ length: MASTER_LIST_MAX_LIMIT + 1 }, (_, i) => `id-${i}`);
    expect(resolveMasterListPaging({ ids }).limit).toBe(MASTER_LIST_MAX_LIMIT);
  });

  it('내부 호출은 더 큰 상한을 넘길 수 있다(엑셀 내보내기 묶음)', () => {
    expect(resolveMasterListPaging({ page: 3, limit: 1000 }, 1000)).toEqual({ page: 3, limit: 1000, offset: 2000 });
  });
});
