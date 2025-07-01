import { Test, TestingModule } from '@nestjs/testing';
import { PaymsController } from './payms.controller';

describe('PaymsController', () => {
  let controller: PaymsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymsController],
    }).compile();

    controller = module.get<PaymsController>(PaymsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
