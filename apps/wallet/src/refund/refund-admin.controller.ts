import {
  Controller,
  Get,
  Put,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  Body,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { RefundService } from './refund.service';
import { RefundAdminService } from './services/refund-admin.service';

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

  constructor(
    private readonly refundService: RefundService,
    private readonly refundAdminService: RefundAdminService,
  ) {}

  /**
   * CS팀용 환불 요청 목록 조회 API (CQRS 최적화)
   * 여러 테이블을 JOIN하여 관리자가 필요한 모든 정보를 한 번에 제공
   */
  @Get()
  async getRefundRequests(
    @Query('status')
    status?: 'REQUESTED' | 'PROCESSING' | 'COMPLETED' | 'REJECTED',
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ) {
    this.logger.log(
      `환불 요청 목록 조회 API 호출: status=${status || 'ALL'}, limit=${limit}, offset=${offset}`,
    );

    try {
      // 🏦 CQRS 패턴: 관리자 페이지에 최적화된 조회 모델 사용
      return await this.refundAdminService.getRefundListForAdmin({
        status,
        limit: limit || 20,
        offset: offset || 0,
      });
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
    this.logger.log(
      `환불 처리 시작 API 호출: refundId=${refundId}, processedBy=${processRefundDto.processedBy}`,
    );

    try {
      await this.refundService.processRefund(
        refundId,
        processRefundDto.processedBy,
        processRefundDto.notes,
      );

      return {
        success: true,
        message: '환불 처리가 시작되었습니다.',
      };
    } catch (error) {
      this.logger.error('환불 처리 시작 API 오류:', error);

      if (
        error instanceof Error &&
        error.message.includes('찾을 수 없습니다')
      ) {
        return {
          success: false,
          message: '해당 환불 요청을 찾을 수 없습니다.',
        };
      }

      if (error instanceof Error && error.message.includes('이미 처리')) {
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
    this.logger.log(
      `환불 완료 처리 API 호출: refundId=${refundId}, completedBy=${completeRefundDto.completedBy}`,
    );

    try {
      await this.refundService.completeRefund(
        refundId,
        completeRefundDto.completedBy,
      );

      return {
        success: true,
        message: '환불 처리가 완료되었습니다.',
      };
    } catch (error) {
      this.logger.error('환불 완료 처리 API 오류:', error);

      if (
        error instanceof Error &&
        error.message.includes('찾을 수 없습니다')
      ) {
        return {
          success: false,
          message: '해당 환불 요청을 찾을 수 없습니다.',
        };
      }

      if (error instanceof Error && error.message.includes('이미 완료된')) {
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
    @Body()
    rejectRefundDto: { rejectedBy: string; reason: string; notes?: string },
  ) {
    this.logger.log(
      `환불 거절 처리 API 호출: refundId=${refundId}, rejectedBy=${rejectRefundDto.rejectedBy}`,
    );

    try {
      await this.refundService.rejectRefund(
        refundId,
        rejectRefundDto.rejectedBy,
        rejectRefundDto.reason,
        rejectRefundDto.notes,
      );

      return {
        success: true,
        message: '환불 요청이 거절되었습니다.',
      };
    } catch (error) {
      this.logger.error('환불 거절 처리 API 오류:', error);

      if (
        error instanceof Error &&
        error.message.includes('찾을 수 없습니다')
      ) {
        return {
          success: false,
          message: '해당 환불 요청을 찾을 수 없습니다.',
        };
      }

      if (error instanceof Error && error.message.includes('이미 처리')) {
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
   * CS팀용 특정 환불 요청 상세 조회 API (CQRS 최적화)
   * 모든 관련 정보를 JOIN하여 상세한 조회 모델 제공
   */
  @Get(':id')
  async getRefundRequest(@Param('id') refundId: string) {
    this.logger.log(`환불 요청 상세 조회 API 호출: refundId=${refundId}`);

    try {
      // 🏦 CQRS 패턴: 상세 조회에 최적화된 조회 모델 사용
      return await this.refundAdminService.getRefundDetailForAdmin(refundId);
    } catch (error) {
      this.logger.error('환불 요청 상세 조회 API 오류:', error);
      return {
        success: false,
        message: '환불 요청 조회에 실패했습니다.',
      };
    }
  }

  /**
   * CS팀용 환불 통계 조회 API (CQRS 최적화)
   * 환불 현황을 한눈에 볼 수 있는 통계 정보 제공
   */
  @Get('stats/overview')
  async getRefundStats() {
    this.logger.log('환불 통계 조회 API 호출');

    try {
      // 🏦 CQRS 패턴: 통계에 최적화된 집계 쿼리 사용
      return await this.refundAdminService.getRefundStatsForAdmin();
    } catch (error) {
      this.logger.error('환불 통계 조회 API 오류:', error);
      return {
        success: false,
        message: '환불 통계 조회에 실패했습니다.',
      };
    }
  }
}
