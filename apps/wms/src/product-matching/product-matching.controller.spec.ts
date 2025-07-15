import { Test, TestingModule } from '@nestjs/testing';
import { ProductMatchingController } from './product-matching.controller';
import { ProductMatchingService } from './product-matching.service';

describe('ProductMatchingController', () => {
  let controller: ProductMatchingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductMatchingController],
      providers: [ProductMatchingService],
    }).compile();

    controller = module.get<ProductMatchingController>(ProductMatchingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
