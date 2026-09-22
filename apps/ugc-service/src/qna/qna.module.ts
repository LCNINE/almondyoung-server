import { Module } from '@nestjs/common';
import { UgcEventsModule } from '../ugc-events.module';
import { QnaController } from './qna.controller';
import { QnaService } from './qna.service';
import { QnaCleanupCronService } from './qna-cleanup-cron.service';

@Module({
  imports: [UgcEventsModule],
  controllers: [QnaController],
  providers: [QnaService, QnaCleanupCronService],
})
export class QnaModule {}
