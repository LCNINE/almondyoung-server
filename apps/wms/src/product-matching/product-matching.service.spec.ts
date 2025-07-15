import { Test, TestingModule } from '@nestjs/testing';
import { ProductMatchingService } from './product-matching.service';

describe('ProductMatchingService', () => {
  let service: ProductMatchingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductMatchingService],
    }).compile();

    service = module.get<ProductMatchingService>(ProductMatchingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
