import { Module } from '@nestjs/common';
import { QnaController } from './qna.controller';
import { QnaService } from './qna.service';
import { QnaCleanupCronService } from './qna-cleanup-cron.service';

@Module({
  controllers: [QnaController],
  providers: [QnaService, QnaCleanupCronService],
})
export class QnaModule {}
