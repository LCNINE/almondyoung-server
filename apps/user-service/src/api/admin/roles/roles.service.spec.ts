import { Test, TestingModule } from '@nestjs/testing';
import { RolesManager } from './roles.manager';
import { RolesReader } from './roles.reader';
import { RolesService } from './roles.service';

describe('RolesService', () => {
  let service: RolesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: RolesReader, useValue: {} },
        { provide: RolesManager, useValue: {} },
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
