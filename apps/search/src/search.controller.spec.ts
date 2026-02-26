import { Test, TestingModule } from '@nestjs/testing';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

describe('SearchController', () => {
  let searchController: SearchController;
  let searchService: jest.Mocked<SearchService>;

  const mockResponse = {
    items: [],
    pagination: {
      page: 1,
      size: 20,
      total: 0,
      totalPages: 0,
    },
  };

  const mockTrendingResponse = {
    windowHours: 24,
    items: [{ keyword: '선크림', count24h: 12, lastSearchedAt: '2026-02-26T12:00:00Z' }],
  };

  const mockSuggestionsResponse = {
    query: '선',
    items: [
      {
        keyword: '선크림',
        count: 30,
        lastSearchedAt: '2026-02-26T12:00:00Z',
        source: 'query_log' as const,
      },
    ],
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [
        {
          provide: SearchService,
          useValue: {
            searchProducts: jest.fn().mockResolvedValue(mockResponse),
            getTrendingKeywords: jest.fn().mockResolvedValue(mockTrendingResponse),
            suggestKeywords: jest.fn().mockResolvedValue(mockSuggestionsResponse),
          },
        },
      ],
    }).compile();

    searchController = app.get<SearchController>(SearchController);
    searchService = app.get(SearchService);
  });

  describe('search', () => {
    it('delegates to SearchService', async () => {
      const query = { q: '글루', page: 1, size: 20 };
      await expect(searchController.search(query as any)).resolves.toEqual(
        mockResponse,
      );
      expect(searchService.searchProducts).toHaveBeenCalledWith(query);
    });
  });

  describe('getTrendingKeywords', () => {
    it('delegates to SearchService', async () => {
      const query = { size: 5 };
      await expect(
        searchController.getTrendingKeywords(query as any),
      ).resolves.toEqual(mockTrendingResponse);
      expect(searchService.getTrendingKeywords).toHaveBeenCalledWith(query);
    });
  });

  describe('suggestKeywords', () => {
    it('delegates to SearchService', async () => {
      const query = { q: '선', size: 5 };
      await expect(searchController.suggestKeywords(query as any)).resolves.toEqual(
        mockSuggestionsResponse,
      );
      expect(searchService.suggestKeywords).toHaveBeenCalledWith(query);
    });
  });
});
