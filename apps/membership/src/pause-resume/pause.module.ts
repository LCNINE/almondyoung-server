import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { PauseService } from './pause.service';
import { PauseController } from './pause.controller';

/**
 * 일시정지 관리 모듈
 */
@Module({
  imports: [EventsModule],
  controllers: [PauseController],
  providers: [PauseService],
  exports: [PauseService],
})
export class PauseModule {}
