import { Test, TestingModule } from '@nestjs/testing';
import { DormantService } from './dormant.service';

describe('DormantService', () => {
  let service: DormantService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DormantService],
    }).compile();

    service = module.get<DormantService>(DormantService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
