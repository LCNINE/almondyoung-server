import { Test, TestingModule } from '@nestjs/testing';
import { DormantController } from './dormant.controller';
import { DormantService } from './dormant.service';

describe('DormantController', () => {
  let controller: DormantController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DormantController],
      providers: [DormantService],
    }).compile();

    controller = module.get<DormantController>(DormantController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
