import { Body, Controller, HttpCode, HttpStatus, Post, UseFilters, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, User } from '@app/authorization';
import { BadRequestError } from '@app/shared';
import { BENEFIT_USAGE_KINDS } from '../services/benefit/benefit-usage';
import { BenefitUsageService } from '../services/benefit/benefit-usage.service';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';

/**
 * 쇼핑 주문 밖 멤버십 혜택(뷰티탑 프리미엄 등)을 열 때의 이용 기록.
 *
 * 스코프는 JWT 의 userId 하나다. 결과는 오류가 아니라 `status` 로 돌려준다 — 부르는 쪽(혜택을 여는 서버)이
 * 「멤버십 아님」「철회권 안내 필요」를 각자 화면으로 바꾼다.
 */
@ApiTags('membership-benefit-usage')
@Controller('me/benefit-usages')
@UseFilters(SubscriptionExceptionFilter)
export class MeBenefitUsageController {
  constructor(private readonly benefitUsageService: BenefitUsageService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '멤버십 혜택 이용 기록(열기 직전)' })
  @UseGuards(JwtAuthGuard)
  async record(@User('userId') userId: string, @Body() dto: { kind?: string; acknowledged?: boolean }) {
    const kind = BENEFIT_USAGE_KINDS.find((k) => k === dto?.kind);
    if (!kind) throw new BadRequestError(`kind 는 ${BENEFIT_USAGE_KINDS.join(', ')} 중 하나여야 합니다.`);
    return this.benefitUsageService.recordUsage(userId, kind, dto?.acknowledged === true);
  }
}
