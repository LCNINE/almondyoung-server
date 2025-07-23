import {
  Controller,
  Get,
  Query,
  Param,
  Post,
  Body,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger
} from '@nestjs/common';
import {
  PaymentHistoryService,
  PaymentHistoryResponse,
  PaymentEventDetail,
  PaymentStatistics,
  AdminPaymentHistoryItem
} from '../services/payment-history.service';

// 요청 DTO
export class PaymentHistoryQueryDto {
  userId: string;
  limit?: number;
  offset?: number;
}

export class PaymentEventDetailQueryDto {
  userId: string;
  paymentEventId: string;
}

export class PaymentStatisticsQueryDto {
  userId: string;
}

// 관리자용 전체 조회 DTO
export class AdminPaymentHistoryQueryDto {
  limit?: number;
  offset?: number;
  userId?: string; // 특정 사용자 필터링 (선택사항)
}

/**
 * 결제 내역 조회 전담 컨트롤러
 * CQRS 패턴에 따라 조회(Query) API만을 담당합니다.
 */
@Controller('payments/history')
export class PaymentHistoryController {
  private readonly logger = new Logger(PaymentHistoryController.name);

  constructor(
    private readonly historyService: PaymentHistoryService,
  ) { }

  /**
   * 사용자의 결제 내역을 조회합니다.
   * POST /payments/history
   */
  @Post()
  async getPaymentHistory(
    @Body() queryDto: PaymentHistoryQueryDto,
  ): Promise<PaymentHistoryResponse> {
    const { userId, limit = 20, offset = 0 } = queryDto;

    if (!userId) {
      throw new BadRequestException('userId가 필요합니다.');
    }

    this.logger.log(`결제 내역 조회 요청: 사용자 ${userId}`);

    // 파라미터 검증
    const validatedLimit = this.validateLimit(limit);
    const validatedOffset = this.validateOffset(offset);

    const options = {
      limit: validatedLimit,
      offset: validatedOffset,
    };

    try {
      const result = await this.historyService.getPaymentHistoryForUser(userId, options);

      this.logger.log(`결제 내역 조회 성공: 사용자 ${userId}, ${result.items.length}건 반환`);

      return result;
    } catch (error) {
      this.logger.error(`결제 내역 조회 실패: 사용자 ${userId}`, error);
      throw error;
    }
  }

  /**
   * 특정 결제 이벤트의 상세 정보를 조회합니다.
   * POST /payments/history/detail
   */
  @Post('detail')
  async getPaymentEventDetail(
    @Body() queryDto: PaymentEventDetailQueryDto,
  ): Promise<PaymentEventDetail> {
    const { userId, paymentEventId } = queryDto;

    if (!userId) {
      throw new BadRequestException('userId가 필요합니다.');
    }

    if (!paymentEventId || paymentEventId.trim() === '') {
      throw new BadRequestException('결제 이벤트 ID가 필요합니다.');
    }

    this.logger.log(`결제 상세 조회 요청: 사용자 ${userId}, 이벤트 ${paymentEventId}`);

    try {
      const detail = await this.historyService.getPaymentEventDetail(userId, paymentEventId);

      if (!detail) {
        throw new NotFoundException('결제 내역을 찾을 수 없습니다.');
      }

      this.logger.log(`결제 상세 조회 성공: 사용자 ${userId}, 이벤트 ${paymentEventId}`);

      return detail;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`결제 상세 조회 실패: 사용자 ${userId}, 이벤트 ${paymentEventId}`, error);
      throw error;
    }
  }

  /**
   * 사용자의 결제 통계를 조회합니다.
   * POST /payments/history/statistics
   */
  @Post('statistics')
  async getPaymentStatistics(
    @Body() queryDto: PaymentStatisticsQueryDto,
  ): Promise<PaymentStatistics> {
    const { userId } = queryDto;

    if (!userId) {
      throw new BadRequestException('userId가 필요합니다.');
    }

    this.logger.log(`결제 통계 조회 요청: 사용자 ${userId}`);

    try {
      const statistics = await this.historyService.getPaymentStatistics(userId);

      this.logger.log(`결제 통계 조회 성공: 사용자 ${userId}`);

      return statistics;
    } catch (error) {
      this.logger.error(`결제 통계 조회 실패: 사용자 ${userId}`, error);
      throw error;
    }
  }

  /**
   * 관리자용: 전체 결제 내역을 조회합니다.
   * POST /payments/history/admin
   */
  @Post('admin')
  async getAdminPaymentHistory(
    @Body() queryDto: AdminPaymentHistoryQueryDto,
  ): Promise<PaymentHistoryResponse> {
    const { limit = 20, offset = 0, userId } = queryDto;

    this.logger.log(`관리자 결제 내역 조회 요청: ${userId ? `사용자 ${userId}` : '전체'}`);

    // 파라미터 검증
    const validatedLimit = this.validateLimit(limit);
    const validatedOffset = this.validateOffset(offset);

    const options = {
      limit: validatedLimit,
      offset: validatedOffset,
    };

    try {
      let result: PaymentHistoryResponse;

      if (userId) {
        // 특정 사용자 조회
        result = await this.historyService.getPaymentHistoryForUser(userId, options);
      } else {
        // 전체 사용자 조회
        result = await this.historyService.getAllPaymentHistory(options);
      }

      this.logger.log(`관리자 결제 내역 조회 성공: ${result.items.length}건 반환`);

      return result;
    } catch (error) {
      this.logger.error(`관리자 결제 내역 조회 실패`, error);
      throw error;
    }
  }

  /**
   * 디버그용: 실제 데이터 확인
   * GET /payments/history/debug
   */
  @Get('debug')
  async debugData(): Promise<any> {
    try {
      // 실제 paymentMethod 데이터 확인
      const paymentMethods = await this.historyService['dbService'].db.query.paymentMethod.findMany({
        limit: 5,
        columns: { id: true, userId: true, methodType: true, methodName: true },
      });

      // 실제 paymentEvents 데이터 확인
      const paymentEvents = await this.historyService['dbService'].db.query.paymentEvents.findMany({
        limit: 5,
        columns: { id: true, paymentMethodId: true, amount: true, status: true, createdAt: true },
      });

      return {
        paymentMethods,
        paymentEvents,
        message: '실제 데이터 확인용 디버그 엔드포인트'
      };
    } catch (error) {
      this.logger.error('디버그 데이터 조회 실패', error);
      return { error: error.message };
    }
  }

  // Private helper methods
  private validateLimit(limit: number): number {
    if (isNaN(limit)) {
      throw new BadRequestException('limit은 숫자여야 합니다.');
    }

    if (limit < 1) {
      throw new BadRequestException('limit은 1 이상이어야 합니다.');
    }

    if (limit > 100) {
      throw new BadRequestException('한 번에 조회할 수 있는 최대 개수는 100개입니다.');
    }

    return limit;
  }

  private validateOffset(offset: number): number {
    if (isNaN(offset)) {
      throw new BadRequestException('offset은 숫자여야 합니다.');
    }

    if (offset < 0) {
      throw new BadRequestException('offset은 0 이상이어야 합니다.');
    }

    return offset;
  }
}