import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UnifiedReservationService } from '../../shared/services/unified-reservation.service';

@Injectable()
export class ReservationCronService {
  private readonly logger = new Logger(ReservationCronService.name);

  constructor(private readonly unifiedReservation: UnifiedReservationService) {}

  /**
   * 예약 만료 처리 - 15분마다 실행
   *
   * timeoutAt이 지난 예약을 자동으로 해제하여
   * 재고를 다시 할당 가능하게 만듭니다.
   *
   * [비활성화됨] 에러 발생으로 인해 임시로 비활성화
   */
  // @Cron(CronExpression.EVERY_10_MINUTES, {
  //   name: 'release-expired-reservations',
  //   timeZone: 'Asia/Seoul',
  // })
  async releaseExpiredReservations() {
    this.logger.log('Starting expired reservation release job...');

    try {
      const releasedCount =
        await this.unifiedReservation.releaseExpiredReservations();

      if (releasedCount > 0) {
        this.logger.log(
          `✅ Successfully released ${releasedCount} expired reservations`,
        );
      } else {
        this.logger.debug('No expired reservations found');
      }
    } catch (error) {
      this.logger.error(
        `❌ Failed to release expired reservations: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * 예약 상태 모니터링 - 매시간 실행
   *
   * 예약 통계를 로그로 출력하여 시스템 상태를 모니터링합니다.
   */
  @Cron(CronExpression.EVERY_HOUR, {
    name: 'reservation-stats-monitoring',
    timeZone: 'Asia/Seoul',
  })
  async monitorReservationStats() {
    this.logger.log('Checking reservation statistics...');

    try {
      // 향후 통계 조회 로직 추가 가능
      // 예: 총 예약 수, 만료 예정 예약 수 등

      this.logger.debug('Reservation monitoring complete');
    } catch (error) {
      this.logger.warn(`Failed to monitor reservation stats: ${error.message}`);
    }
  }
}
