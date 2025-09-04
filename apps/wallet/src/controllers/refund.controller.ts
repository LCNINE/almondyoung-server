// controllers/refunds-v2.controller.ts
import {
  Controller,
  Post,
  Patch,
  Get,
  Body,
  Param,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiHeader,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import {
  RefundRequestDto,
  RefundApprovalDto,
  RefundCancellationDto,
  RefundResponseDto,
} from '../shared/dtos/refunds/refund.dto';
import { RefundService } from '../services/refund.service';
import {
  RefundNotFoundError,
  RefundAlreadyProcessedError,
  RefundAmountExceedsLimitError,
  RefundExecutionFailedError,
} from '../shared/errors/payment.errors';

/**
 * 환불 V2 컨트롤러
 *
 * MSA 설계 원칙:
 * - 결제 서버는 "승인된 환불 명세"를 받아 실제 환급만 실행
 * - 환불 가능성 판단은 주문/반품 서버의 책임
 * - 환불 승인 권한도 주문/반품 서버의 책임
 *
 * Controller 책임:
 * - HTTP 요청/응답 처리
 * - DTO 유효성 검증 (class-validator)
 * - 비즈니스 에러 → HTTP 상태 코드 매핑
 * - API 문서화 (Swagger)
 */
@ApiTags('환불 V2')
@Controller('v2/refunds')
export class RefundController {
  private readonly logger = new Logger(RefundController.name);

  constructor(private readonly refundService: RefundService) {}

  /**
   * 환불 요청 접수 (외부 MSA에서 호출)
   */
  @Post()
  @ApiOperation({
    summary: '환불 요청 접수',
    description:
      '외부(주문/반품) 서버에서 환불 요청을 접수합니다. 실제 환급은 승인 후 실행됩니다.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: '멱등성 키 (선택적)',
    required: false,
  })
  @ApiCreatedResponse({
    description: '환불 요청 접수 완료',
    type: RefundResponseDto,
  })
  @ApiBadRequestResponse({ description: '잘못된 요청 데이터' })
  @ApiNotFoundResponse({ description: '결제 세션을 찾을 수 없음' })
  @ApiConflictResponse({ description: '환불 불가능한 상태' })
  async requestRefund(
    @Body() request: RefundRequestDto,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ): Promise<RefundResponseDto> {
    try {
      this.logger.log(`💰 환불 요청 접수: ${request.paymentSessionId}`);

      return await this.refundService.requestRefund(request, idempotencyKey);
    } catch (error) {
      this.logger.error('환불 요청 접수 실패:', error);

      // 비즈니스 에러를 HTTP 상태 코드로 매핑
      if (
        error instanceof RefundNotFoundError ||
        error instanceof RefundAmountExceedsLimitError ||
        error instanceof RefundAlreadyProcessedError
      ) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }

      // 예상치 못한 에러
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(
        `환불 요청 처리 중 오류가 발생했습니다: ${errorMessage}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 환불 승인 및 실행 (외부 MSA에서 호출)
   */
  @Patch(':refundId/approve')
  @ApiOperation({
    summary: '환불 승인 및 실행',
    description: '외부(주문/반품) 서버에서 승인된 환불을 실제로 실행합니다.',
  })
  @ApiParam({ name: 'refundId', description: '환불 ID' })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: '멱등성 키 (선택적)',
    required: false,
  })
  @ApiOkResponse({
    description: '환불 승인 및 실행 완료',
    type: RefundResponseDto,
  })
  @ApiBadRequestResponse({ description: '잘못된 요청 데이터' })
  @ApiNotFoundResponse({ description: '환불을 찾을 수 없음' })
  @ApiConflictResponse({ description: '환불 승인 불가능한 상태' })
  async approveRefund(
    @Param('refundId') refundId: string,
    @Body() request: RefundApprovalDto,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ): Promise<RefundResponseDto> {
    try {
      this.logger.log(`✅ 환불 승인 처리: ${refundId}`);

      return await this.refundService.approveRefund(
        { refundId, approvalInfo: request.approvalInfo },
        idempotencyKey,
      );
    } catch (error) {
      this.logger.error('환불 승인 처리 실패:', error);

      // 비즈니스 에러를 HTTP 상태 코드로 매핑
      if (
        error instanceof RefundNotFoundError ||
        error instanceof RefundAlreadyProcessedError
      ) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      if (error instanceof RefundExecutionFailedError) {
        throw new HttpException(
          error.message,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // 예상치 못한 에러
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(
        `환불 승인 처리 중 오류가 발생했습니다: ${errorMessage}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 환불 취소 (외부 MSA에서 호출)
   */
  @Patch(':refundId/cancel')
  @ApiOperation({
    summary: '환불 취소',
    description: '요청된 환불을 취소합니다.',
  })
  @ApiParam({ name: 'refundId', description: '환불 ID' })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: '멱등성 키 (선택적)',
    required: false,
  })
  @ApiOkResponse({
    description: '환불 취소 완료',
    type: RefundResponseDto,
  })
  @ApiBadRequestResponse({ description: '잘못된 요청 데이터' })
  @ApiNotFoundResponse({ description: '환불을 찾을 수 없음' })
  @ApiConflictResponse({ description: '환불 취소 불가능한 상태' })
  async cancelRefund(
    @Param('refundId') refundId: string,
    @Body() request: RefundCancellationDto,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ): Promise<RefundResponseDto> {
    try {
      this.logger.log(`❌ 환불 취소: ${refundId}`);

      return await this.refundService.cancelRefund(
        { refundId, reason: request.reason, cancelledBy: request.cancelledBy },
        idempotencyKey,
      );
    } catch (error) {
      this.logger.error('환불 취소 실패:', error);

      // 비즈니스 에러를 HTTP 상태 코드로 매핑
      if (
        error instanceof RefundNotFoundError ||
        error instanceof RefundAlreadyProcessedError
      ) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }

      // 예상치 못한 에러
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(
        `환불 취소 처리 중 오류가 발생했습니다: ${errorMessage}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 환불 조회
   */
  @Get(':refundId')
  @ApiOperation({
    summary: '환불 조회',
    description: '환불 ID로 환불 정보를 조회합니다.',
  })
  @ApiParam({ name: 'refundId', description: '환불 ID' })
  @ApiOkResponse({
    description: '환불 조회 완료',
    type: RefundResponseDto,
  })
  @ApiNotFoundResponse({ description: '환불을 찾을 수 없음' })
  async getRefund(
    @Param('refundId') refundId: string,
  ): Promise<RefundResponseDto> {
    try {
      this.logger.log(`🔍 환불 조회: ${refundId}`);

      return await this.refundService.getRefund(refundId);
    } catch (error) {
      this.logger.error('환불 조회 실패:', error);

      // 비즈니스 에러를 HTTP 상태 코드로 매핑
      if (error instanceof RefundNotFoundError) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }

      // 예상치 못한 에러
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(
        `환불 조회 중 오류가 발생했습니다: ${errorMessage}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
