import { Module } from '@nestjs/common';
import { PinService } from '../services/pin/pin.service';
import { PinReader } from '../services/pin/pin.reader';
import { PinCreator } from '../services/pin/pin.creator';
import { PinManager } from '../services/pin/pin.manager';
import { PinController } from '../controllers/pin.controller';

/**
 * PinModule
 *
 * 결제 비밀번호(PIN) 관리 모듈
 */
@Module({
  controllers: [PinController],
  providers: [PinService, PinReader, PinCreator, PinManager],
  exports: [PinService],
})
export class PinModule {}
