import { Test, TestingModule } from '@nestjs/testing';
import { OrderCollectService } from './order-collect.service';

describe('OrderCollectService', () => {
  let service: OrderCollectService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OrderCollectService],
    }).compile();

    service = module.get<OrderCollectService>(OrderCollectService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
