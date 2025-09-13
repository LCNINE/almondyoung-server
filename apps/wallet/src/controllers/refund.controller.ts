// v2/refund.controller.ts - v4 아키텍처 환불 컨트롤러
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  HttpCode,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiHeader,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';

import {
  RefundCreateDto,
  RefundResponseDto,
} from '../shared/dtos/v2-payment.dto';

import { RefundService } from '../services/refund.service';

/**
 * v2 Refund 컨트롤러 (v4 아키텍처)
 *
 * 핵심 원칙:
 * - 환불 도메인에서는 성공 상태를 'COMPLETED' 사용 (용어 충돌 방지)
 * - Intent 기반 환불 처리 (attemptId 선택적 지정 가능)
 * - 전액/부분 환불 지원, 초과 환불 방지
 */
@ApiTags('Refunds API')
@Controller('refunds')
export class RefundController {
  private readonly logger = new Logger(RefundController.name);

  constructor(private readonly refundService: RefundService) {}

  /**
   * 서비스에서 던진 Error를 HTTP 상태코드로 매핑 (CTO 스타일)
   */
  private mapErrorToHttpException(error: Error): HttpException {
    const message = error.message.toLowerCase();

    if (message.includes('not found')) {
      return new HttpException(error.message, HttpStatus.NOT_FOUND);
    }

    if (
      message.includes('exceeds') ||
      message.includes('already refunded') ||
      message.includes('invalid amount') ||
      message.includes('policy.') ||
      message.includes('required')
    ) {
      return new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }

    if (message.includes('already.processed')) {
      return new HttpException(error.message, HttpStatus.CONFLICT);
    }

    return new HttpException(
      'Internal server error',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  // -------------------------------
  // 환불 생성
  // -------------------------------
  @Post()
  @HttpCode(200) // v4 아키텍처 규칙: 모든 POST는 200
  @ApiOperation({
    summary: '환불 생성',
    description: `
결제된 Intent에 대한 환불을 생성합니다:
- 전액 환불: amount 생략
- 부분 환불: amount 지정 (원본 금액 초과 불가)
- 특정 Attempt 환불: attemptId 지정 (선택적)

**검증 규칙**:
- 환불 금액은 (원본 금액 - 기존 환불 금액)을 초과할 수 없음
- 이미 전액 환불된 Intent는 환불 불가
- 환불 사유는 정책에서 허용된 값만 가능

**환불 상태**: REQUESTED → APPROVED → COMPLETED (환불 도메인 전용)
    `,
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: '멱등성 키 (선택사항)',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: '환불 생성 성공',
    type: RefundResponseDto,
  })
  @ApiBadRequestResponse({ description: '환불 금액 초과 또는 잘못된 요청' })
  @ApiNotFoundResponse({ description: 'Intent를 찾을 수 없음' })
  @ApiInternalServerErrorResponse({ description: '서버 내부 오류' })
  async createRefund(
    @Body() dto: RefundCreateDto,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ): Promise<RefundResponseDto> {
    try {
      this.logger.log(
        `환불 생성 요청: intentId=${dto.intentId}, amount=${dto.amount || '전액'}`,
      );

      const result = await this.refundService.createRefund(dto, idempotencyKey);

      this.logger.log(`환불 생성 완료: ${result.refundId}`);
      return result;
    } catch (error) {
      this.logger.error(`환불 생성 실패: ${error.message}`, error.stack);
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // 환불 조회
  // -------------------------------
  @Get(':id')
  @ApiOperation({
    summary: '환불 조회',
    description: 'Refund ID로 환불 정보를 조회합니다.',
  })
  @ApiParam({
    name: 'id',
    description: 'Refund ID',
    example: 'rf_01HQZX8QJKMNPQRST9VWXY012',
  })
  @ApiResponse({
    status: 200,
    description: '환불 조회 성공',
    type: RefundResponseDto,
  })
  @ApiNotFoundResponse({ description: '환불을 찾을 수 없음' })
  async getRefund(@Param('id') refundId: string): Promise<RefundResponseDto> {
    try {
      this.logger.log(`환불 조회 요청: ${refundId}`);

      // TODO: 서비스 호출
      // const result = await this.refundService.getRefund(refundId);

      // 임시 응답 (실제 구현 시 제거)
      const mockResponse: RefundResponseDto = {
        refundId,
        intentId: 'pi_01HQZX8QJKMNPQRST9VWXY012',
        amount: 25000,
        status: 'COMPLETED', // 환불 완료 상태
        createdAt: new Date(Date.now() - 60000).toISOString(), // 1분 전 생성
        completedAt: new Date().toISOString(), // 방금 완료
        reason: 'customer_request',
        attemptId: 'pa_01HQZX8QJKMNPQRST9VWXY012',
      };

      return mockResponse;
    } catch (error) {
      this.logger.error(`환불 조회 실패: ${error.message}`, error.stack);
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // Intent별 환불 목록 조회
  // -------------------------------
  @Get('intent/:intentId')
  @ApiOperation({
    summary: 'Intent별 환불 목록 조회',
    description: '특정 Intent에 대한 모든 환불 내역을 조회합니다.',
  })
  @ApiParam({
    name: 'intentId',
    description: 'Intent ID',
    example: 'pi_01HQZX8QJKMNPQRST9VWXY012',
  })
  @ApiResponse({
    status: 200,
    description: '환불 목록 조회 성공',
    type: [RefundResponseDto],
  })
  @ApiNotFoundResponse({ description: 'Intent를 찾을 수 없음' })
  async getRefundsByIntent(
    @Param('intentId') intentId: string,
  ): Promise<RefundResponseDto[]> {
    try {
      this.logger.log(`Intent별 환불 목록 조회: ${intentId}`);

      // TODO: 서비스 호출
      // const result = await this.refundService.getRefundsByIntent(intentId);

      // 임시 응답 (실제 구현 시 제거)
      const mockResponse: RefundResponseDto[] = [
        {
          refundId: `rf_${Date.now()}_1`,
          intentId,
          amount: 25000,
          status: 'COMPLETED',
          createdAt: new Date(Date.now() - 120000).toISOString(), // 2분 전
          completedAt: new Date(Date.now() - 60000).toISOString(), // 1분 전
          reason: 'customer_request',
          attemptId: 'pa_01HQZX8QJKMNPQRST9VWXY012',
        },
        {
          refundId: `rf_${Date.now()}_2`,
          intentId,
          amount: 15000,
          status: 'REQUESTED',
          createdAt: new Date().toISOString(),
          reason: 'product_defect',
          attemptId: 'pa_01HQZX8QJKMNPQRST9VWXY012',
        },
      ];

      return mockResponse;
    } catch (error) {
      this.logger.error(
        `Intent별 환불 목록 조회 실패: ${error.message}`,
        error.stack,
      );
      throw this.mapErrorToHttpException(error);
    }
  }
}
