import { DbService } from '@app/db';
import { Test, TestingModule } from '@nestjs/testing';
import { DormantService } from './dormant.service';

describe('DormantService', () => {
  let service: DormantService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DormantService,
        { provide: DbService, useValue: {} },
        { provide: 'STREAM_PUBLISHER_users.events.v1', useValue: { publishEvent: jest.fn() } },
      ],
    }).compile();

    service = module.get<DormantService>(DormantService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
