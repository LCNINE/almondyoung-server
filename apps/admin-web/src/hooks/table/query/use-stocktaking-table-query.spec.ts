import { useStocktakingTableQuery } from './use-stocktaking-table-query';
import { useQueryParams } from '../../use-query-params';

jest.mock('../../use-query-params', () => ({ useQueryParams: jest.fn() }));

describe('useStocktakingTableQuery', () => {
  it('표가 바꾸는 page 로 몇 번째 묶음을 읽을지 정한다', () => {
    (useQueryParams as jest.Mock).mockReturnValue({ page: '3', warehouseId: 'w-1', status: null });
    expect(useStocktakingTableQuery({ pageSize: 20 }).searchParams).toEqual({
      limit: 20,
      offset: 40,
      warehouseId: 'w-1',
      status: undefined,
    });
  });

  it.each([null, '0', 'abc', '-2'])('page 가 %s 이면 첫 묶음이다', (page) => {
    (useQueryParams as jest.Mock).mockReturnValue({ page, warehouseId: null, status: null });
    expect(useStocktakingTableQuery().searchParams.offset).toBe(0);
  });
});
