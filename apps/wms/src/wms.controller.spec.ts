import { Test, TestingModule } from '@nestjs/testing';
import { WmsController } from './wms.controller';
import { WmsService } from './wms.service';

describe('WmsController', () => {
  let wmsController: WmsController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [WmsController],
      providers: [WmsService],
    }).compile();

    wmsController = app.get<WmsController>(WmsController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(wmsController.getHello()).toBe('Hello World!');
    });
  });
});
