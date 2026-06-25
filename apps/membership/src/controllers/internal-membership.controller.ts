import { Controller, Post, Body, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { Public } from '@app/authorization';
import { AdminOperationsService } from '../services/admin-operations.service';
import { EntitlementService } from '../services/entitlement.service';

@Controller('internal')
export class InternalMembershipController {
  private readonly logger = new Logger(InternalMembershipController.name);

  constructor(
    private readonly adminOperationsService: AdminOperationsService,
    private readonly entitlementService: EntitlementService,
  ) {}

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

  /**
   * 주어진 userId 중 멤버십 활성(현재 권한 + 미만료)인 userId만 반환.
   * channel-adapter 일일 정합성 크론이 메두사 고객 그룹 add/remove 판정에 사용한다.
   */
  @Public()
  @Post('memberships/active')
  @HttpCode(HttpStatus.OK)
  async getActiveMemberships(@Body() body: { userIds: string[] }): Promise<{ activeUserIds: string[] }> {
    const userIds = Array.isArray(body?.userIds) ? body.userIds : [];
    const activeUserIds = await this.entitlementService.getActiveUserIds(userIds);
    return { activeUserIds };
  }
}
