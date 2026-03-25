import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { SearchController } from '../src/search.controller';
import { SearchService } from '../src/search.service';

describe('SearchController (e2e)', () => {
  let app: INestApplication;
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
    const moduleFixture: TestingModule = await Test.createTestingModule({
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

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/search/products (GET)', () => {
    return request(app.getHttpServer()).get('/search/products?q=글루').expect(200).expect(mockResponse);
  });
});
