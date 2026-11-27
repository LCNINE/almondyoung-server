import { useSkusTableQuery } from './use-skus-table-query';
import { useQueryParams } from '../../use-query-params';

jest.mock('../../use-query-params', () => ({ useQueryParams: jest.fn() }));

const params = (overrides: Record<string, string | undefined>) => ({
  page: undefined,
  q: undefined,
  code: undefined,
  name: undefined,
  barcode: undefined,
  groupId: undefined,
  supplierName: undefined,
  ...overrides,
});

describe('useSkusTableQuery', () => {
  it('검색창 값은 이름 필터가 아니라 통합 검색어로 보낸다', () => {
    (useQueryParams as jest.Mock).mockReturnValue(
      params({ q: '880900000027' })
    );

    const { searchParams } = useSkusTableQuery();

    expect(searchParams.q).toBe('880900000027');
    expect(searchParams.name).toBeUndefined();
  });

  it('스캐너가 붙인 앞뒤 공백은 지운다', () => {
    (useQueryParams as jest.Mock).mockReturnValue(
      params({ q: '  SKU-001 \t' })
    );

    expect(useSkusTableQuery().searchParams.q).toBe('SKU-001');
  });

  it('공백뿐인 검색어는 보내지 않는다', () => {
    (useQueryParams as jest.Mock).mockReturnValue(params({ q: '   ' }));

    expect(useSkusTableQuery().searchParams.q).toBeUndefined();
  });

  it('필터 칸 값은 검색어와 따로 그대로 보낸다', () => {
    (useQueryParams as jest.Mock).mockReturnValue(
      params({
        q: '880900000027',
        name: '립',
        code: 'SKU-9',
        barcode: '1234',
        groupId: 'g-1',
        supplierName: '공급',
      })
    );

    expect(useSkusTableQuery().searchParams).toEqual({
      limit: 20,
      offset: 0,
      q: '880900000027',
      name: '립',
      code: 'SKU-9',
      barcode: '1234',
      groupId: 'g-1',
      supplierName: '공급',
    });
  });

  it('쪽 번호로 몇 번째 묶음을 읽을지 정한다', () => {
    (useQueryParams as jest.Mock).mockReturnValue(params({ page: '3' }));

    expect(useSkusTableQuery({ pageSize: 20 }).searchParams.offset).toBe(40);
  });
});
