import { Test, TestingModule } from '@nestjs/testing';
import { OrderCollectController } from './order-collect.controller';
import { OrderCollectService } from './order-collect.service';

describe('OrderCollectController', () => {
  let controller: OrderCollectController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrderCollectController],
      providers: [OrderCollectService],
    }).compile();

    controller = module.get<OrderCollectController>(OrderCollectController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
