import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseFilters,
  UsePipes,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PauseService } from './pause.service';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';
import { ZodValidationPipe } from '../shared/pipes/zod-validation.pipe';
import {
  PauseSubscriptionRequestSchema,
  PauseSubscriptionRequest,
  ResumeSubscriptionRequestSchema,
  ResumeSubscriptionRequest,
} from '../shared/schemas';

/**
 * 일시정지 관리 컨트롤러
 * 구독 일시정지/재개 및 이력 조회 API
 */
@Controller('subscriptions/pause')
@UseFilters(SubscriptionExceptionFilter)
export class PauseController {
  constructor(private readonly pauseService: PauseService) {}

  /**
   * 구독 일시정지
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(PauseSubscriptionRequestSchema))
  async pauseSubscription(
    @Body() pauseRequest: PauseSubscriptionRequest,
    @Query('userId') userId: string,
  ) {
    return this.pauseService.pauseSubscription(userId, {
      startDate: pauseRequest.startDate,
      endDate: pauseRequest.endDate,
      reason: pauseRequest.reason,
    });
  }

  /**
   * 구독 재개
   */
  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(ResumeSubscriptionRequestSchema))
  async resumeSubscription(
    @Body() resumeRequest: ResumeSubscriptionRequest,
    @Query('userId') userId: string,
  ) {
    return this.pauseService.resumeSubscription(userId, {
      reason: resumeRequest.reason,
    });
  }

  /**
   * 일시정지 이력 조회
   */
  @Get('history')
  async getPauseHistory(@Query('userId') userId: string) {
    return this.pauseService.getPauseHistory(userId);
  }

  /**
   * 일시정지 자격 확인
   */
  @Get('eligibility')
  async checkPauseEligibility(
    @Query('userId') userId: string,
    @Query('year') year?: string,
  ) {
    const currentYear = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.pauseService.checkPauseEligibility(null, userId, currentYear);
  }
}
