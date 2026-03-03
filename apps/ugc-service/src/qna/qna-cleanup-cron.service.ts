import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { QnaService } from './qna.service';

@Injectable()
export class QnaCleanupCronService {
  private readonly logger = new Logger(QnaCleanupCronService.name);

  constructor(private readonly qnaService: QnaService) {}

  @Cron('0 3 * * *', {
    name: 'cleanup-deleted-questions',
    timeZone: 'Asia/Seoul',
  })
  async cleanupDeletedQuestions() {
    this.logger.log('Starting deleted questions cleanup job...');

    try {
      const deletedCount = await this.qnaService.purgeDeletedQuestions(30);

      if (deletedCount > 0) {
        this.logger.log(`Successfully purged ${deletedCount} deleted questions`);
      } else {
        this.logger.debug('No deleted questions to purge');
      }
    } catch (error) {
      this.logger.error(`Failed to purge deleted questions: ${error.message}`, error.stack);
    }
  }
}
