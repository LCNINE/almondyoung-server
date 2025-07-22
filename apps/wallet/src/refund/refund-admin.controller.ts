import { 
  Controller, 
  Get, 
  Put, 
  Param, 
  Query, 
  HttpCode, 
  HttpStatus, 
  Logger,
  Body 
} from '@nestjs/common';
import { RefundService } from './refund.service';

export interface CompleteRefundDto {
  completedBy: string;
  notes?: string;
}

/**
 * CS팀용 환불 관리 컨트롤러
 * - GET /admin/refunds: 환불 요청 목록 조회
 * - PUT /admin/refunds/:id/complete: 환불 완료 처리
 */
@Controller('admin/refunds')
export class RefundAdminController {
  private readonly logger = new Logger(RefundAdminController.name);

  constructor(private readonly refundService: RefundService) {}

  /**
   * CS팀용 환불 요청 목록 조회 API
   * 모든 환불 요청 또는 특정 상태의 환불 요청을 조회
   */
  @Get()
  async getRefundRequests(
    @Query('status') status?: 'REQUESTED' | 'PROCESSING' | 'COMPLETED' | 'REJECTED',
  ) {
    this.logger.log(`환불 요청 목록 조회 API 호출: status=${status || 'ALL'}`);

    try {
      const refundRequests = await this.refundService.getRefundRequests(status);

      return {
        success: true,
        data: refundRequests.map(refund => ({
          id: refund.id,
          paymentEventId: refund.paymentEventId,
          amount: refund.amount,
          status: refund.status,
          reason: refund.reason,
          createdAt: refund.createdAt,
          completedAt: refund.completedAt,
          // 결제 정보
          payment: {
            invoiceId: refund.paymentEvent?.invoice?.id,
            originalAmount: refund.paymentEvent?.amount,
            paymentMethod: refund.paymentEvent?.paymentMethod?.methodName,
          },
        })),
        total: refundRequests.length,
      };
    } catch (error) {
      this.logger.error('환불 요청 목록 조회 API 오류:', error);
      return {
        success: false,
        message: '환불 요청 목록 조회에 실패했습니다.',
      };
    }
  }

  /**
   * CS팀용 환불 처리 시작 API
   * 환불 요청을 검토하고 처리 시작 상태로 변경
   */
  @Put(':id/process')
  @HttpCode(HttpStatus.OK)
  async processRefund(
    @Param('id') refundId: string,
    @Body() processRefundDto: { processedBy: string; notes?: string },
  ) {
    this.logger.log(`환불 처리 시작 API 호출: refundId=${refundId}, processedBy=${processRefundDto.processedBy}`);

    try {
      await this.refundService.processRefund(refundId, processRefundDto.processedBy, processRefundDto.notes);

      return {
        success: true,
        message: '환불 처리가 시작되었습니다.',
      };
    } catch (error) {
      this.logger.error('환불 처리 시작 API 오류:', error);
      
      if (error.message.includes('찾을 수 없습니다')) {
        return {
          success: false,
          message: '해당 환불 요청을 찾을 수 없습니다.',
        };
      }
      
      if (error.message.includes('이미 처리')) {
        return {
          success: false,
          message: '이미 처리 중이거나 완료된 환불 요청입니다.',
        };
      }

      return {
        success: false,
        message: '환불 처리 시작에 실패했습니다.',
      };
    }
  }

  /**
   * CS팀용 환불 완료 처리 API
   * 수동 이체 완료 후 시스템에서 환불 상태를 완료로 업데이트
   */
  @Put(':id/complete')
  @HttpCode(HttpStatus.OK)
  async completeRefund(
    @Param('id') refundId: string,
    @Body() completeRefundDto: CompleteRefundDto,
  ) {
    this.logger.log(`환불 완료 처리 API 호출: refundId=${refundId}, completedBy=${completeRefundDto.completedBy}`);

    try {
      await this.refundService.completeRefund(refundId, completeRefundDto.completedBy, completeRefundDto.notes);

      return {
        success: true,
        message: '환불 처리가 완료되었습니다.',
      };
    } catch (error) {
      this.logger.error('환불 완료 처리 API 오류:', error);
      
      if (error.message.includes('찾을 수 없습니다')) {
        return {
          success: false,
          message: '해당 환불 요청을 찾을 수 없습니다.',
        };
      }
      
      if (error.message.includes('이미 완료된')) {
        return {
          success: false,
          message: '이미 완료된 환불 요청입니다.',
        };
      }

      return {
        success: false,
        message: '환불 완료 처리에 실패했습니다.',
      };
    }
  }

  /**
   * CS팀용 환불 요청 거절 API
   * 환불 요청을 검토 후 거절 처리
   */
  @Put(':id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectRefund(
    @Param('id') refundId: string,
    @Body() rejectRefundDto: { rejectedBy: string; reason: string; notes?: string },
  ) {
    this.logger.log(`환불 거절 처리 API 호출: refundId=${refundId}, rejectedBy=${rejectRefundDto.rejectedBy}`);

    try {
      await this.refundService.rejectRefund(refundId, rejectRefundDto.rejectedBy, rejectRefundDto.reason, rejectRefundDto.notes);

      return {
        success: true,
        message: '환불 요청이 거절되었습니다.',
      };
    } catch (error) {
      this.logger.error('환불 거절 처리 API 오류:', error);
      
      if (error.message.includes('찾을 수 없습니다')) {
        return {
          success: false,
          message: '해당 환불 요청을 찾을 수 없습니다.',
        };
      }
      
      if (error.message.includes('이미 처리')) {
        return {
          success: false,
          message: '이미 처리된 환불 요청입니다.',
        };
      }

      return {
        success: false,
        message: '환불 거절 처리에 실패했습니다.',
      };
    }
  }

  /**
   * CS팀용 특정 환불 요청 상세 조회 API
   */
  @Get(':id')
  async getRefundRequest(@Param('id') refundId: string) {
    this.logger.log(`환불 요청 상세 조회 API 호출: refundId=${refundId}`);

    try {
      const refundRequests = await this.refundService.getRefundRequests();
      const refund = refundRequests.find(r => r.id === refundId);

      if (!refund) {
        return {
          success: false,
          message: '해당 환불 요청을 찾을 수 없습니다.',
        };
      }

      return {
        success: true,
        data: {
          id: refund.id,
          paymentEventId: refund.paymentEventId,
          amount: refund.amount,
          status: refund.status,
          reason: refund.reason,
          createdAt: refund.createdAt,
          completedAt: refund.completedAt,
          // 상세 결제 정보
          payment: {
            invoiceId: refund.paymentEvent?.invoice?.id,
            originalAmount: refund.paymentEvent?.amount,
            paymentMethod: refund.paymentEvent?.paymentMethod?.methodName,
            paymentStatus: refund.paymentEvent?.status,
            paymentDate: refund.paymentEvent?.createdAt,
          },
        },
      };
    } catch (error) {
      this.logger.error('환불 요청 상세 조회 API 오류:', error);
      return {
        success: false,
        message: '환불 요청 조회에 실패했습니다.',
      };
    }
  }
}