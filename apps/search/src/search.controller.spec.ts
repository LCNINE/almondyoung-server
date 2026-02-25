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

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [
        {
          provide: SearchService,
          useValue: {
            searchProducts: jest.fn().mockResolvedValue(mockResponse),
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
});
