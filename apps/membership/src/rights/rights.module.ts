import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { RightsService } from './rights.service';
import { RightsController } from './rights.controller';

/**
 * 권한 관리 모듈
 */
@Module({
  imports: [EventsModule],
  controllers: [RightsController],
  providers: [RightsService],
  exports: [RightsService],
})
export class RightsModule {}
