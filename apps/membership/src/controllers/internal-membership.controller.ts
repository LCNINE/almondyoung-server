import { Controller, Post, Body, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { Public } from '@app/authorization';
import { AdminOperationsService } from '../services/admin-operations.service';

@Controller('internal')
export class InternalMembershipController {
  private readonly logger = new Logger(InternalMembershipController.name);

  constructor(private readonly adminOperationsService: AdminOperationsService) {}

  /**
   * 시스템 내부 전용 구독 지급 엔드포인트 (channel-adapter → membership 서비스 간 호출)
   * 이미 활성 구독이 있으면 no-op으로 처리한다.
   */
  @Public()
  @Post('grant')
  @HttpCode(HttpStatus.OK)
  async internalGrant(@Body() body: { userId: string; days: number; memo?: string }) {
    const { userId, days, memo } = body;
    try {
      await this.adminOperationsService.adminGrantSubscriptionByDays(userId, days, memo ?? null, 'system');
      this.logger.log(`[internal/grant] 구독 지급 완료: userId=${userId}, days=${days}`);
      return { granted: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('이미 활성 구독')) {
        this.logger.log(`[internal/grant] 이미 활성 구독 존재, skip: userId=${userId}`);
        return { granted: false, reason: 'already_active' };
      }
      this.logger.error(`[internal/grant] 실패: userId=${userId}, ${message}`);
      throw error;
    }
  }
}
