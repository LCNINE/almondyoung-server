import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
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
  imports: [
    ConfigModule,
    JwtModule.register({
      // JwtService는 AUTH_SECRET을 사용하므로 여기서는 빈 설정
      // 실제 secret은 ConfigService에서 주입받음
    }),
  ],
  controllers: [PinController],
  providers: [PinService, PinReader, PinCreator, PinManager],
  exports: [PinService],
})
export class PinModule {}
