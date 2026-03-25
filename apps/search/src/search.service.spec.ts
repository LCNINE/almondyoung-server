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
});
