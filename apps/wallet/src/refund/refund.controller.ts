import { Controller, Post, Body, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { RefundService, RefundRequest } from './refund.service';

export interface CreateRefundRequestDto {
  paymentEventId: string;
  amount: number;
  reason: string;
}

/**
 * 사용자용 환불 요청 컨트롤러
 * - POST /refunds: 환불 요청 생성
 */
@Controller('refunds')
export class RefundController {
  private readonly logger = new Logger(RefundController.name);

  constructor(private readonly refundService: RefundService) {}

  /**
   * 사용자 환불 요청 API
   * 효성 CMS는 API 환불을 지원하지 않으므로 CS팀 수동 처리를 위한 요청 접수
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async requestRefund(
    @Body() createRefundDto: CreateRefundRequestDto,
    // TODO: 인증 연동 후 @Req() req: any 추가하여 userId 추출
  ) {
    this.logger.log(`환불 요청 API 호출: ${JSON.stringify(createRefundDto)}`);

    try {
      // TODO: 실제 인증 연동 후 req.user.id로 변경
      const userId = 'temp-user-id'; // 임시 사용자 ID

      const refundRequest: RefundRequest = {
        userId,
        paymentEventId: createRefundDto.paymentEventId,
        amount: createRefundDto.amount,
        reason: createRefundDto.reason,
      };

      const result = await this.refundService.requestRefund(refundRequest);

      if (result.success) {
        return {
          success: true,
          message: '환불 요청이 접수되었습니다. CS팀에서 검토 후 처리해드리겠습니다.',
          refundId: result.refundId,
        };
      } else {
        return {
          success: false,
          message: result.error || '환불 요청 처리에 실패했습니다.',
        };
      }
    } catch (error) {
      this.logger.error('환불 요청 API 오류:', error);
      return {
        success: false,
        message: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      };
    }
  }
}