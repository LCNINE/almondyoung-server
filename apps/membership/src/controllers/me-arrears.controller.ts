import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseFilters, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, User } from '@app/authorization';
import { BadRequestError } from '@app/shared';
import { ArrearsRepaymentService } from '../services/arrears/arrears-repayment.service';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';

/**
 * 고객 본인의 미수 조회·청산.
 *
 * 스코프는 JWT 의 userId 하나다 — 경로·본문 어디에도 조회 대상 userId 를 받지 않는다.
 * 관리자 경로는 `/admin/arrears/*` 로 따로 있다.
 */
@ApiTags('membership-arrears')
@Controller('me/arrears')
@UseFilters(SubscriptionExceptionFilter)
export class MeArrearsController {
  constructor(private readonly arrearsRepaymentService: ArrearsRepaymentService) {}

  @Get()
  @ApiOperation({ summary: '내 미수(미납 멤버십 요금) 조회' })
  @UseGuards(JwtAuthGuard)
  async getMine(@User('userId') userId: string) {
    return this.arrearsRepaymentService.getMine(userId);
  }

  /**
   * 「지금 갚기」. 금액은 서버가 원장에서 더하고, 부분 청산은 받지 않는다(전액 한 번).
   */
  @Post('checkout')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '미수 청산 결제 시작' })
  @UseGuards(JwtAuthGuard)
  async startRepayment(@User() user: { userId: string; email?: string }, @Body() dto: { returnUrl?: string }) {
    const returnUrl = dto?.returnUrl?.trim();
    if (!returnUrl) throw new BadRequestError('returnUrl 은 필수입니다.');
    return this.arrearsRepaymentService.startRepayment(user.userId, returnUrl, user.email);
  }
}
