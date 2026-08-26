import { Test, TestingModule } from '@nestjs/testing';
import { ProductIndexService } from './product-index.service';
import { SearchKeywordService } from './search-keyword.service';
import { SearchService } from './search.service';

describe('SearchService', () => {
  let service: SearchService;
  let productIndexService: jest.Mocked<ProductIndexService>;
  let searchKeywordService: jest.Mocked<SearchKeywordService>;

  const mockSearchResponse = {
    items: [],
    pagination: {
      page: 1,
      size: 20,
      total: 3,
      totalPages: 1,
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: ProductIndexService,
          useValue: {
            searchProducts: jest.fn().mockResolvedValue(mockSearchResponse),
          },
        },
        {
          provide: SearchKeywordService,
          useValue: {
            recordSearchKeyword: jest.fn().mockResolvedValue(undefined),
            getTrendingKeywords: jest.fn(),
            suggestKeywords: jest.fn(),
            getRelatedKeywords: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get(SearchService);
    productIndexService = module.get(ProductIndexService);
    searchKeywordService = module.get(SearchKeywordService);
  });

  it('records keyword when q exists and page is first page', async () => {
    await expect(service.searchProducts({ q: '선크림', page: 1, size: 20 } as any)).resolves.toEqual(
      mockSearchResponse,
    );

    expect(productIndexService.searchProducts).toHaveBeenCalled();
    expect(searchKeywordService.recordSearchKeyword).toHaveBeenCalledWith('선크림', 3);
  });

  it('does not record keyword when q is empty', async () => {
    await service.searchProducts({ q: '   ', page: 1, size: 20 } as any);
    expect(searchKeywordService.recordSearchKeyword).not.toHaveBeenCalled();
  });

  it('does not record keyword on pages after first page', async () => {
    await service.searchProducts({ q: '선크림', page: 2, size: 20 } as any);
    expect(searchKeywordService.recordSearchKeyword).not.toHaveBeenCalled();
  });

  it('연관검색어를 조회해 응답에 붙인다', async () => {
    searchKeywordService.getRelatedKeywords.mockResolvedValue(['선크림추천', '수분선크림']);

    const response = await service.searchProducts({ q: '선크림', page: 1, size: 20 } as any);

    expect(searchKeywordService.getRelatedKeywords).toHaveBeenCalledWith('선크림', expect.any(Number));
    expect(response.relatedKeywords).toEqual(['선크림추천', '수분선크림']);
  });

  // 교정 전 "tpwp" 로는 아무것도 안 걸린다 — 교정어로 찾아야 한다.
  it('교정된 검색어가 있으면 그쪽으로 연관검색어를 찾는다', async () => {
    productIndexService.searchProducts.mockResolvedValue({
      ...mockSearchResponse,
      correctedQuery: '세제',
    } as any);
    searchKeywordService.getRelatedKeywords.mockResolvedValue(['세탁세제']);

    await service.searchProducts({ q: 'tpwp', page: 1, size: 20 } as any);

    expect(searchKeywordService.getRelatedKeywords).toHaveBeenCalledWith('세제', expect.any(Number));
  });

  it('연관검색어가 없으면 필드를 붙이지 않는다', async () => {
    searchKeywordService.getRelatedKeywords.mockResolvedValue([]);

    const response = await service.searchProducts({ q: '선크림', page: 1, size: 20 } as any);

    expect(response).not.toHaveProperty('relatedKeywords');
  });

  // 연관검색어는 부가 정보라 실패해도 검색 결과는 나가야 한다.
  it('연관검색어 조회가 실패해도 검색 결과를 반환한다', async () => {
    searchKeywordService.getRelatedKeywords.mockRejectedValue(new Error('opensearch down'));

    const response = await service.searchProducts({ q: '선크림', page: 1, size: 20 } as any);

    expect(response).toEqual(mockSearchResponse);
  });

  it('키워드가 없으면 연관검색어를 조회하지 않는다', async () => {
    await service.searchProducts({ q: '   ', page: 1, size: 20 } as any);
    expect(searchKeywordService.getRelatedKeywords).not.toHaveBeenCalled();
  });
});
