import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { BenefitTrackingService } from '../services/benefit-tracking.service';
import { RecordDiscountDto, CycleBenefitDto } from '../shared/dto/benefit-tracking.dto';

@Controller('membership/benefits')
export class BenefitTrackingController {
  constructor(private readonly benefitTrackingService: BenefitTrackingService) {}

  /**
   * 내부 API: 혜택 기록
   * 외부 시스템에서 주문 완료 시 호출
   */
  @Post('internal/record')
  async recordDiscount(@Body() dto: RecordDiscountDto) {
    try {
      await this.benefitTrackingService.recordDiscount(dto);
      return { success: true, message: 'Discount recorded' };
    } catch (error: any) {
      // 멱등성: 중복 처리는 성공으로 간주
      if (error.message?.includes('Duplicate')) {
        return { success: true, message: 'Already recorded' };
      }
      throw error;
    }
  }

  /**
   * 내부 API: 혜택 취소
   * 외부 시스템에서 주문 취소 시 호출
   */
  @Post('internal/cancel')
  async cancelDiscount(@Body('orderId') orderId: string) {
    try {
      await this.benefitTrackingService.cancelDiscount(orderId);
      return { success: true, message: 'Discount cancelled' };
    } catch (error: any) {
      // CTO 스타일: 서비스에서 던진 Error를 HTTP 응답으로 변환
      if (error.message?.includes('not found')) {
        throw new Error('해당 주문의 할인 기록을 찾을 수 없습니다');
      }
      if (error.message?.includes('already')) {
        return { success: true, message: 'Already cancelled' };
      }
      throw error;
    }
  }

  /**
   * 외부 API: 현재 주기 조회
   * 사용자에게 "지금 이 주기 동안 얼마나 절약했는지" 보여주기
   */
  @Get('current')
  async getCurrentCycleBenefit(@Query('userId') userId: string): Promise<CycleBenefitDto> {
    // 활성 구독이 없으면 서비스가 NotFoundError(404)를 던지고 GlobalExceptionFilter 가 매핑한다.
    return this.benefitTrackingService.getCurrentCycleBenefit(userId);
  }

  /**
   * 외부 API: 혜택 이력 조회
   * 사용자의 전체 혜택 히스토리 (최근 N개 주기)
   */
  @Get('history')
  async getCycleBenefitHistory(@Query('userId') userId: string, @Query('limit') limit?: number) {
    return this.benefitTrackingService.getCycleBenefitHistory(userId, limit || 12);
  }
}
