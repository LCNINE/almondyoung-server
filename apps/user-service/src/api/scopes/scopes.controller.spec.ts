import { Test, TestingModule } from '@nestjs/testing';
import { ScopesController } from './scopes.controller';
import { ScopesService } from './scopes.service';

describe('ScopesController', () => {
  let controller: ScopesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScopesController],
      providers: [ScopesService],
    }).compile();

    controller = module.get<ScopesController>(ScopesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
