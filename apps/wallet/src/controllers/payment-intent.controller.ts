// v2/payment-intent.controller.ts - v4 아키텍처 Intent/Attempt 컨트롤러
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
  IntentCreateDto,
  IntentResponseDto,
  AttemptCreateDto,
  AttemptFinalizeDto,
  AttemptResponseDto,
} from '../shared/dtos/v2-payment.dto';
import {
  UniversalFinalizeDto,
  UniversalFinalizeResponseDto,
} from '../shared/dtos/universal-checkout.dto';

import { PaymentIntentService } from '../services/v2/payment-intent.service';

/**
 * v2 Payment Intent 컨트롤러 (v4 아키텍처)
 *
 * 핵심 원칙:
 * - 모든 POST는 @HttpCode(200)
 * - 서비스에서 던진 Error를 HTTP 상태코드로 매핑
 * - Intent → Attempt → Finalize 플로우 지원
 */
@ApiTags('v2 Payment Intent/Attempt API')
@Controller('payments')
export class PaymentIntentController {
  private readonly logger = new Logger(PaymentIntentController.name);

  constructor(private readonly intentService: PaymentIntentService) {}

  /**
   * 서비스에서 던진 Error를 HTTP 상태코드로 매핑 (CTO 스타일)
   */
  private mapErrorToHttpException(error: Error): HttpException {
    const message = error.message.toLowerCase();

    if (message.includes('not found')) {
      return new HttpException(error.message, HttpStatus.NOT_FOUND);
    }

    if (
      message.includes('policy.') ||
      message.includes('already processed') ||
      message.includes('exceeds') ||
      message.includes('required') ||
      message.includes('invalid') ||
      message.includes('failed')
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
  // Intent 생성
  // -------------------------------
  @Post('intents')
  @HttpCode(200) // v4 아키텍처 규칙: 모든 POST는 200
  @ApiOperation({
    summary: '결제 Intent 생성',
    description: `
결제 의도(Intent)를 생성합니다:
- 금액, 통화, 타입, 허용 Provider 설정
- 정책 검증 (타입별 Provider 제한, 금액 한도 등)
- 멱등성 지원

**하드가드**: BNPL_CAPTURE 타입은 반드시 CMS Provider만 허용
    `,
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: '멱등성 키 (선택사항)',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Intent 생성 성공',
    type: IntentResponseDto,
  })
  @ApiBadRequestResponse({ description: '정책 위반 또는 잘못된 요청' })
  @ApiInternalServerErrorResponse({ description: '서버 내부 오류' })
  async createIntent(
    @Body() dto: IntentCreateDto,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ): Promise<IntentResponseDto> {
    try {
      this.logger.log(
        `Intent 생성 요청: userId=${dto.userId}, type=${dto.type}, amount=${dto.amount}`,
      );

      const result = await this.intentService.createIntent(dto, idempotencyKey);

      this.logger.log(`Intent 생성 완료: ${result.intentId}`);
      return result;
    } catch (error) {
      this.logger.error(`Intent 생성 실패: ${error.message}`, error.stack);
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // Attempt 생성
  // -------------------------------
  @Post('intents/:id/attempts')
  @HttpCode(200)
  @ApiOperation({
    summary: '결제 Attempt 생성',
    description: `
특정 Intent에 대한 결제 시도(Attempt)를 생성합니다:
- Provider별 결제 실행
- 저장형(profileId) 또는 일시형(instrumentRef) 수단 지원
- 정책 검증 및 하드가드 적용

**검증 규칙**:
- requiresStoredProfile=true이면 profileId 필수
- allowsEphemeral=false이면 instrumentRef 금지
- BNPL_CAPTURE 타입은 CMS Provider만 허용
    `,
  })
  @ApiParam({
    name: 'id',
    description: 'Intent ID',
    example: 'pi_01HQZX8QJKMNPQRST9VWXY012',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: '멱등성 키 (선택사항)',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Attempt 생성 성공',
    type: AttemptResponseDto,
  })
  @ApiBadRequestResponse({ description: '정책 위반 또는 잘못된 요청' })
  @ApiNotFoundResponse({ description: 'Intent를 찾을 수 없음' })
  @ApiInternalServerErrorResponse({ description: '서버 내부 오류' })
  async createAttempt(
    @Param('id') intentId: string,
    @Body() dto: AttemptCreateDto,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ): Promise<AttemptResponseDto> {
    try {
      this.logger.log(
        `Attempt 생성 요청: intentId=${intentId}, provider=${dto.provider}`,
      );

      const result = await this.intentService.createAttempt(
        intentId,
        dto,
        idempotencyKey,
      );

      this.logger.log(`Attempt 생성 완료: ${result.attemptId}`);
      return result;
    } catch (error) {
      this.logger.error(`Attempt 생성 실패: ${error.message}`, error.stack);
      throw this.mapErrorToHttpException(error);
    }
  }

  // ===============================
  // v5 아키텍처: Universal Finalize API
  // ===============================

  /**
   * Universal Finalize API (v5 아키텍처)
   * 모든 PG사의 최종 결제 승인을 처리하는 단일 창구
   */
  @Post('intents/:id/attempts/finalize')
  @HttpCode(200)
  @ApiOperation({
    summary: '공용 결제 확정 API (v5)',
    description: `
모든 PG사의 최종 결제 승인을 처리하는 단일 창구:
- 토스, 카카오페이, 포인트, BNPL 등 모든 Provider 지원
- Provider별 instrumentRef(승인키) 기반 처리
- 금액 검증 및 최종 상태 업데이트
- 공용 API 계약으로 PG사 독립성 보장

**v5 핵심**: 하나의 API로 모든 PG사 처리, Provider별 분기 없음
    `,
  })
  @ApiParam({
    name: 'id',
    description: 'Intent ID',
    example: 'pi_01HQZX8QJKMNPQRST9VWXY012',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: '멱등성 키 (선택사항)',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: '공용 결제 확정 성공',
    type: UniversalFinalizeResponseDto,
  })
  @ApiBadRequestResponse({ description: '잘못된 승인키 또는 요청' })
  @ApiNotFoundResponse({ description: 'Intent를 찾을 수 없음' })
  @ApiInternalServerErrorResponse({ description: '서버 내부 오류' })
  async universalFinalize(
    @Param('id') intentId: string,
    @Body() dto: UniversalFinalizeDto,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ): Promise<UniversalFinalizeResponseDto> {
    try {
      this.logger.log(
        `Universal Finalize 요청: intentId=${intentId}, provider=${dto.provider}, instrumentRef=${dto.instrumentRef ? '***' : 'none'}`,
      );

      const result = await this.intentService.universalFinalize(
        intentId,
        dto,
        idempotencyKey,
      );

      this.logger.log(
        `Universal Finalize 완료: ${result.attemptId}, 상태: ${result.status}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Universal Finalize 실패: ${error.message}`,
        error.stack,
      );
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // Attempt 확정 (웹 결제 복귀용) - Legacy
  // -------------------------------
  @Post('intents/:id/attempts/finalize/legacy')
  @HttpCode(200)
  @ApiOperation({
    summary: '결제 Attempt 확정 (Legacy)',
    description: `
웹 결제 후 복귀 시 Attempt를 확정합니다:
- 카카오페이, 토스페이 등 승인키 기반 확정
- ephemeral 수단의 최종 처리
- Intent 상태 업데이트

**사용 시나리오**: 
1. createIntent → createCheckoutSession → 리다이렉트
2. 사용자 승인 후 복귀 → finalizeAttempt 호출
    `,
  })
  @ApiParam({
    name: 'id',
    description: 'Intent ID',
    example: 'pi_01HQZX8QJKMNPQRST9VWXY012',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: '멱등성 키 (선택사항)',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Attempt 확정 성공',
    type: AttemptResponseDto,
  })
  @ApiBadRequestResponse({ description: '잘못된 승인키 또는 요청' })
  @ApiNotFoundResponse({ description: 'Intent를 찾을 수 없음' })
  @ApiInternalServerErrorResponse({ description: '서버 내부 오류' })
  async legacyFinalizeAttempt(
    @Param('id') intentId: string,
    @Body() dto: AttemptFinalizeDto,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ): Promise<AttemptResponseDto> {
    try {
      this.logger.log(
        `Legacy Attempt 확정 요청: intentId=${intentId}, approvalKey=${dto.approvalKey ? '***' : 'none'}`,
      );

      const result = await this.intentService.finalizeAttempt(
        intentId,
        dto,
        idempotencyKey,
      );

      this.logger.log(`Legacy Attempt 확정 완료: ${result.attemptId}`);
      return result;
    } catch (error) {
      this.logger.error(
        `Legacy Attempt 확정 실패: ${error.message}`,
        error.stack,
      );
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // Intent 조회
  // -------------------------------
  @Get('intents/:id')
  @ApiOperation({
    summary: 'Intent 조회',
    description: 'Intent ID로 결제 의도 정보를 조회합니다.',
  })
  @ApiParam({
    name: 'id',
    description: 'Intent ID',
    example: 'pi_01HQZX8QJKMNPQRST9VWXY012',
  })
  @ApiResponse({
    status: 200,
    description: 'Intent 조회 성공',
    type: IntentResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Intent를 찾을 수 없음' })
  async getIntent(@Param('id') intentId: string): Promise<IntentResponseDto> {
    try {
      this.logger.log(`Intent 조회 요청: ${intentId}`);

      const result = await this.intentService.getIntent(intentId);

      return result;
    } catch (error) {
      this.logger.error(`Intent 조회 실패: ${error.message}`, error.stack);
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // Attempt 조회
  // -------------------------------
  @Get('attempts/:id')
  @ApiOperation({
    summary: 'Attempt 조회',
    description: 'Attempt ID로 결제 시도 정보를 조회합니다.',
  })
  @ApiParam({
    name: 'id',
    description: 'Attempt ID',
    example: 'pa_01HQZX8QJKMNPQRST9VWXY012',
  })
  @ApiResponse({
    status: 200,
    description: 'Attempt 조회 성공',
    type: AttemptResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Attempt를 찾을 수 없음' })
  async getAttempt(
    @Param('id') attemptId: string,
  ): Promise<AttemptResponseDto> {
    try {
      this.logger.log(`Attempt 조회 요청: ${attemptId}`);

      const result = await this.intentService.getAttempt(attemptId);

      return result;
    } catch (error) {
      this.logger.error(`Attempt 조회 실패: ${error.message}`, error.stack);
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // Intent의 모든 Attempts 조회
  // -------------------------------
  @Get('intents/:id/attempts')
  @ApiOperation({
    summary: 'Intent의 모든 Attempts 조회',
    description: 'Intent ID로 해당 Intent의 모든 결제 시도 목록을 조회합니다.',
  })
  @ApiParam({
    name: 'id',
    description: 'Intent ID',
    example: 'pi_01HQZX8QJKMNPQRST9VWXY012',
  })
  @ApiResponse({
    status: 200,
    description: 'Attempts 목록 조회 성공',
    type: [AttemptResponseDto],
  })
  @ApiNotFoundResponse({ description: 'Intent를 찾을 수 없음' })
  async getIntentAttempts(
    @Param('id') intentId: string,
  ): Promise<AttemptResponseDto[]> {
    try {
      this.logger.log(`Intent Attempts 조회 요청: ${intentId}`);

      const result = await this.intentService.getIntentAttempts(intentId);

      return result;
    } catch (error) {
      this.logger.error(
        `Intent Attempts 조회 실패: ${error.message}`,
        error.stack,
      );
      throw this.mapErrorToHttpException(error);
    }
  }
}
