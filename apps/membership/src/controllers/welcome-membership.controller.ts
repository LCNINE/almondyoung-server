import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '@app/authorization';
import { WelcomeMembershipService } from '../services/welcome-membership.service';

/**
 * 웰컴 멤버십 구매 자격 API
 *
 * GET  /welcome-membership/eligibility/:userId  → 구매 가능 여부 조회
 * POST /welcome-membership/eligibility/:userId/purchased → 구매 완료 기록 (Medusa internal)
 */
@ApiTags('welcome-membership')
@Controller('welcome-membership')
export class WelcomeMembershipController {
  constructor(private readonly service: WelcomeMembershipService) {}

  /**
   * 웰컴 멤버십 구매 가능 여부 조회
   * eligible=true → 구매 가능 (미구매)
   * eligible=false → 구매 불가 (이미 구매함)
   */
  @Get('eligibility/:userId')
  @Public()
  @ApiOperation({ summary: '웰컴 멤버십 구매 자격 조회' })
  async getEligibility(@Param('userId') userId: string) {
    try {
      return await this.service.getEligibility(userId);
    } catch (e: any) {
      throw new InternalServerErrorException(e.message);
    }
  }

  /**
   * 새 시스템에서 웰컴 멤버십 상품 구매 완료 시 기록
   * Medusa confirm-purchase 워크플로에서 호출
   */
  @Post('eligibility/:userId/purchased')
  @Public()
  @ApiOperation({ summary: '웰컴 멤버십 구매 완료 기록' })
  async markPurchased(
    @Param('userId') userId: string,
    @Body() body: { orderId: string },
  ) {
    try {
      if (!body.orderId) throw new Error('orderId is required');
      await this.service.markPurchased(userId, body.orderId);
      return { success: true };
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('required')) throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }
}
