import { Injectable, Logger } from '@nestjs/common';
import { CronOnce } from '@app/cron-once';
import { ReviewBestSelectionService } from './review-best-selection.service';

/**
 * 주간 베스트 후보 집계. 매주 월요일 04:00 KST — 지난 주가 막 닫힌 직후이고
 * 관리자가 출근해 확정하기 전이다. 활성 WEEKLY_BEST 규칙이 없으면 조회 한 번으로 끝난다.
 */
@Injectable()
export class ReviewBestSelectionCron {
  private readonly logger = new Logger(ReviewBestSelectionCron.name);

  constructor(private readonly bestSelectionService: ReviewBestSelectionService) {}

  @CronOnce('0 4 * * 1', { name: 'generate-weekly-best-review-candidates', timeZone: 'Asia/Seoul' })
  async generateWeeklyCandidates() {
    try {
      const result = await this.bestSelectionService.generateCandidates();
      if (result.created > 0) {
        this.logger.log(`주간 베스트 후보 ${result.created}건 생성`);
      }
    } catch (error) {
      this.logger.error(`주간 베스트 후보 생성 실패: ${error.message}`, error.stack);
    }
  }
}
