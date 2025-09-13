// controllers/v2/checkout-session.controller.ts

import {
  Controller,
  Post,
  Get,
  Put,
  Param,
  Body,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import { CheckoutSessionService } from '../services/checkout-session.service';
import {
  CheckoutSessionCreateDto,
  CheckoutSessionResponseDto,
  CheckoutSessionCallbackDto,
} from '../shared/dtos/checkout-session.dto';
import {
  UniversalCheckoutSessionCreateDto,
  UniversalCheckoutSessionResponseDto,
  UniversalFinalizeDto,
  UniversalFinalizeResponseDto,
} from '../shared/dtos/universal-checkout.dto';

/**
 * CheckoutSession v2 Controller
 *
 * 책임:
 * - 웹 리다이렉트 결제창 UX 처리
 * - PG사 콜백 수신 및 처리
 * - Intent/Attempt 자동 연동
 * - CTO 스타일 오류 매핑
 */
@ApiTags('CheckoutSession')
@Controller('checkout')
export class CheckoutSessionController {
  private readonly logger = new Logger(CheckoutSessionController.name);

  constructor(
    private readonly checkoutSessionService: CheckoutSessionService,
  ) {}

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
      message.includes('failed') ||
      message.includes('expired')
    ) {
      return new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }

    if (message.includes('already.processed')) {
      return new HttpException(error.message, HttpStatus.CONFLICT);
    }

    // 기본: 서버 내부 오류
    return new HttpException(
      'Internal server error',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  // ===============================
  // v5 아키텍처: Universal Checkout Session API
  // ===============================

  /**
   * Universal Checkout Session 생성 (v5 아키텍처)
   * intentId만 받아서 UI 렌더링에 필요한 모든 데이터 제공
   */
  @Post('sessions')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Universal Checkout Session 생성 (v5)',
    description: `
공용 체크아웃 UI를 위한 세션 생성:
- Intent 정보 + Provider별 UI 설정 데이터 제공
- 모든 PG사를 하나의 공용 UI로 처리
- flow 기반 동적 렌더링 지원 (REDIRECT vs INLINE)
- SDK 지연 로드 지원

**v5 핵심**: PG사별 전용 API 없이 공용 API 계약만 사용
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Universal Checkout Session 생성 성공',
    type: UniversalCheckoutSessionResponseDto,
  })
  @ApiBadRequestResponse({ description: '정책 위반 또는 잘못된 요청' })
  @ApiNotFoundResponse({ description: 'Intent를 찾을 수 없음' })
  @ApiInternalServerErrorResponse({ description: '서버 내부 오류' })
  async createUniversalSession(
    @Body() dto: UniversalCheckoutSessionCreateDto,
  ): Promise<UniversalCheckoutSessionResponseDto> {
    this.logger.log(
      `Universal Checkout Session 생성 요청: intentId=${dto.intentId}`,
    );

    try {
      const result =
        await this.checkoutSessionService.createUniversalSession(dto);
      this.logger.log(
        `Universal Checkout Session 생성 완료: ${result.sessionId}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Universal Checkout Session 생성 실패: ${error.message}`,
      );
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // 기존 CheckoutSession 생성 (하위 호환)
  // -------------------------------
  @Post('sessions/legacy')
  @HttpCode(200) // v4 아키텍처 규칙: 모든 POST는 200
  @ApiOperation({
    summary: 'CheckoutSession 생성 (Legacy)',
    description: `
웹 리다이렉트 결제창을 위한 CheckoutSession을 생성합니다:
- Intent와 연결된 경량 세션 생성
- PG사별 리다이렉트 URL 설정
- 콜백 처리를 위한 세션 ID 발급

**플로우**: Session 생성 → PG사 리다이렉트 → 콜백 처리 → Intent/Attempt 자동 생성
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'CheckoutSession 생성 성공',
    type: CheckoutSessionResponseDto,
  })
  @ApiBadRequestResponse({ description: '정책 위반 또는 잘못된 요청' })
  @ApiNotFoundResponse({ description: 'Intent를 찾을 수 없음' })
  @ApiInternalServerErrorResponse({ description: '서버 내부 오류' })
  async createLegacySession(
    @Body() dto: CheckoutSessionCreateDto,
  ): Promise<CheckoutSessionResponseDto> {
    this.logger.log(
      `Legacy CheckoutSession 생성 요청: intentId=${dto.intentId}`,
    );

    try {
      const result = await this.checkoutSessionService.createSession(dto);
      this.logger.log(`Legacy CheckoutSession 생성 완료: ${result.sessionId}`);
      return result;
    } catch (error) {
      this.logger.error(`Legacy CheckoutSession 생성 실패: ${error.message}`);
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // CheckoutSession 조회
  // -------------------------------
  @Get('sessions/:sessionId')
  @ApiOperation({
    summary: 'CheckoutSession 조회',
    description: 'CheckoutSession 상태 및 정보를 조회합니다',
  })
  @ApiResponse({
    status: 200,
    description: 'CheckoutSession 조회 성공',
    type: CheckoutSessionResponseDto,
  })
  @ApiNotFoundResponse({ description: 'CheckoutSession을 찾을 수 없음' })
  async getSession(
    @Param('sessionId') sessionId: string,
  ): Promise<CheckoutSessionResponseDto> {
    this.logger.log(`CheckoutSession 조회: ${sessionId}`);

    try {
      const result = await this.checkoutSessionService.getSession(sessionId);
      return result;
    } catch (error) {
      this.logger.error(`CheckoutSession 조회 실패: ${error.message}`);
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // PG사 콜백 처리
  // -------------------------------
  @Post('sessions/:sessionId/callback')
  @HttpCode(200)
  @ApiOperation({
    summary: 'PG사 콜백 처리',
    description: `
PG사에서 전송하는 결제 결과 콜백을 처리합니다:
- 결제 성공/실패 상태 업데이트
- 자동으로 Intent/Attempt 생성 및 처리
- CheckoutSession 상태 완료 처리

**지원 PG사**: TOSS, KAKAOPAY, HMS 등
    `,
  })
  @ApiResponse({
    status: 200,
    description: '콜백 처리 성공',
    type: CheckoutSessionResponseDto,
  })
  @ApiBadRequestResponse({ description: '잘못된 콜백 데이터' })
  @ApiNotFoundResponse({ description: 'CheckoutSession을 찾을 수 없음' })
  async handleCallback(
    @Param('sessionId') sessionId: string,
    @Body() dto: CheckoutSessionCallbackDto,
  ): Promise<CheckoutSessionResponseDto> {
    this.logger.log(
      `PG사 콜백 수신: sessionId=${sessionId}, status=${dto.status}`,
    );

    try {
      const result = await this.checkoutSessionService.handleCallback(
        sessionId,
        dto,
      );
      this.logger.log(`콜백 처리 완료: ${sessionId} → ${result.status}`);
      return result;
    } catch (error) {
      this.logger.error(`콜백 처리 실패: ${error.message}`);
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // CheckoutSession 취소
  // -------------------------------
  @Put('sessions/:sessionId/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'CheckoutSession 취소',
    description:
      '사용자가 결제를 취소했을 때 CheckoutSession을 취소 상태로 변경합니다',
  })
  @ApiResponse({
    status: 200,
    description: 'CheckoutSession 취소 성공',
    type: CheckoutSessionResponseDto,
  })
  @ApiNotFoundResponse({ description: 'CheckoutSession을 찾을 수 없음' })
  @ApiBadRequestResponse({ description: '이미 처리된 세션' })
  async cancelSession(
    @Param('sessionId') sessionId: string,
  ): Promise<CheckoutSessionResponseDto> {
    this.logger.log(`CheckoutSession 취소: ${sessionId}`);

    try {
      const result = await this.checkoutSessionService.cancelSession(sessionId);
      this.logger.log(`CheckoutSession 취소 완료: ${sessionId}`);
      return result;
    } catch (error) {
      this.logger.error(`CheckoutSession 취소 실패: ${error.message}`);
      throw this.mapErrorToHttpException(error);
    }
  }
}
