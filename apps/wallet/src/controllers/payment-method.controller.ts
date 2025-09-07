// controllers/payment-methods.controller.ts
import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Headers,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiHeader,
} from '@nestjs/swagger';
import {
  PaymentMethodRequestDto,
  PaymentMethodResponseDto,
} from '../shared/dtos';
import { PaymentMethodService } from '../services/payment-method.service';

/**
 * 결제수단 관리 컨트롤러 v3.3
 * - Hybrid Approach: 용도(recurring/one-time)와 타입(card/bnpl)을 URL에 명시
 * - 개발자 직관성 향상 및 API 일관성 확보
 * - PaymentMethodService로 결제수단 관리 통합
 * - 모든 비즈니스 로직은 PaymentMethodService로 위임
 */
@ApiTags('결제수단 관리')
@Controller('payment-methods')
export class PaymentMethodController {
  constructor(private readonly paymentMethodService: PaymentMethodService) {}

  @Post('one-time/point')
  @HttpCode(201)
  @ApiOperation({
    summary: '포인트 결제수단 등록',
    description: '내부 리워드 포인트 결제수단을 등록합니다',
  })
  @ApiHeader({
    name: 'idempotency-key',
    required: false,
    description: '멱등성 키 (선택사항)',
  })
  @ApiResponse({
    status: 201,
    description: '결제수단 등록 성공',
    type: PaymentMethodResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'BNPL 또는 잘못된 요청 데이터',
  })
  async registerPointMethod(
    @Body() dto: PaymentMethodRequestDto,
    @Headers('idempotency-key') idemKey?: string,
  ): Promise<PaymentMethodResponseDto> {
    // 📝 지원하는 타입: REWARD_POINT만 (BNPL은 /bnpl/register 사용)

    // PaymentMethodService를 통해 포인트 등록 처리
    return await this.paymentMethodService.createWithIdempotency(
      dto as any,
      idemKey,
    );
  }
  @Post('recurring/card')
  @HttpCode(201)
  @ApiOperation({
    // ✅ [수정] Swagger Summary 개선
    summary: '정기결제용 카드 등록 (HMS)',
    description:
      'HMS CMS에 카드 정보를 등록하고, 내부 DB에 결제수단을 생성합니다. 등록 시에는 실제 카드번호와 소유주 생년월일(또는 사업자번호)이 필요합니다.',
  })
  @ApiHeader({
    name: 'idempotency-key',
    required: false,
    description: '멱등성 키 (선택사항)',
  })
  @ApiResponse({
    // ✅ [수정] Swagger Response 스키마를 실제 응답값에 맞게 상세히 정의
    status: 201,
    description: '카드 결제수단 등록 성공',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'pm_01HQZX8QJKMNPAAABBBCCC' },
        userId: { type: 'string', example: 'user_123493' },
        methodType: { type: 'string', example: 'CARD' },
        methodName: { type: 'string', example: '주 사용 카드' },
        status: { type: 'string', example: 'PENDING' },
        hmsMemberId: { type: 'string', example: '0MVMJHRZADWZB' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '카드 정보 누락 또는 HMS API 에러',
  })
  async registerRecurringCard(
    @Body() dto: PaymentMethodRequestDto,
    @Headers('idempotency-key') idemKey?: string,
  ) {
    // 1. 컨트롤러는 요청 데이터(DTO)의 유효성만 간단히 확인합니다.
    if (dto.methodType !== 'CARD' || !dto.cardInfo) {
      throw new BadRequestException('카드 정보(cardInfo)가 필요합니다.');
    }

    // 2. 구독용 카드 등록이므로 usage를 SUBSCRIPTION으로 설정
    const subscriptionDto = {
      ...dto,
      usage: 'SUBSCRIPTION' as const,
    };

    // 3. 데이터 가공 없이, DTO를 그대로 서비스 계층으로 전달합니다.
    //    복잡한 비즈니스 로직은 모두 서비스에서 처리합니다.
    const result = await this.paymentMethodService.createWithIdempotency(
      subscriptionDto as any,
      idemKey,
    );

    // 3. 서비스의 처리 결과를 클라이언트에 맞게 포맷하여 반환합니다.
    return {
      id: result.id,
      userId: result.userId,
      methodType: result.methodType,
      methodName: result.methodName,
      status: result.status,
      hmsMemberId: result.hmsMemberId,
      createdAt: result.createdAt,
    };
  }

  @Get('users/:userId')
  @ApiOperation({
    summary: '사용자 결제수단 목록 조회',
    description:
      'PENDING 상태 BNPL 포함, 모든 결제수단을 상태별로 분류하여 반환',
  })
  @ApiParam({
    name: 'userId',
    description: '사용자 ID',
    example: 'user_123456789',
  })
  @ApiResponse({
    status: 200,
    description: '결제수단 목록 조회 성공',
    type: [PaymentMethodResponseDto],
  })
  async getUserPaymentMethods(
    @Param('userId') userId: string,
  ): Promise<PaymentMethodResponseDto[]> {
    const result =
      await this.paymentMethodService.getUserMethodsWithStatus(userId);
    return result.usableMethods as any;
  }

  @Put(':id/set-default')
  @ApiOperation({
    summary: '기본 결제수단 설정',
    description: 'ACTIVE 상태의 결제수단만 기본으로 설정 가능',
  })
  @ApiParam({
    name: 'id',
    description: '결제수단 ID',
    example: 'pm_01HQZX8QJKMNPQRST9VWXY012',
  })
  @ApiResponse({
    status: 200,
    description: '기본 결제수단 설정 성공',
    type: PaymentMethodResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'PENDING 상태 결제수단은 기본으로 설정 불가',
  })
  async setDefaultPaymentMethod(
    @Param('id') methodId: string,
    @Body() dto: { userId: string },
  ): Promise<PaymentMethodResponseDto> {
    return await this.paymentMethodService.setAsDefault(methodId, dto.userId);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '결제수단 삭제',
    description: '외부 시스템 정리 후 DB에서 삭제',
  })
  @ApiParam({
    name: 'id',
    description: '결제수단 ID',
    example: 'pm_01HQZX8QJKMNPQRST9VWXY012',
  })
  @ApiResponse({
    status: 200,
    description: '결제수단 삭제 성공',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '결제수단이 삭제되었습니다' },
      },
    },
  })
  async deletePaymentMethod(@Param('id') methodId: string) {
    return await this.paymentMethodService.delete(methodId);
  }

  @Get(':id/verify')
  @ApiOperation({
    summary: '결제수단 검증',
    description: '외부 시스템에서 결제수단 유효성 확인',
  })
  async verifyPaymentMethod(@Param('id') methodId: string) {
    // 검증은 각 MethodService에서 처리
    throw new BadRequestException(
      '결제수단별 검증 API를 사용하세요 (/bnpl/status, /hms-cms/validate 등)',
    );
  }

  @Get('hms-cms/:hmsMemberId/validate')
  @ApiOperation({
    summary: 'HMS CMS Member ID 검증',
    description: '등록된 HMS CMS 회원 ID의 유효성을 확인합니다.',
  })
  @ApiParam({
    name: 'hmsMemberId',
    description: 'HMS Member ID',
    example: 'HMS_123456789',
  })
  @ApiResponse({
    status: 200,
    description: 'HMS Member ID 검증 결과',
    schema: {
      type: 'object',
      properties: {
        valid: { type: 'boolean', example: true },
        memberId: { type: 'string', example: 'HMS_123456789' },
        status: { type: 'string', example: 'ACTIVE' },
        message: { type: 'string', example: 'HMS Member ID 유효' },
      },
    },
  })
  async validateHmsCmsMember(@Param('hmsMemberId') hmsMemberId: string) {
    // TODO: PaymentMethodService로 이동 필요
    // 임시로 기본 응답 반환
    return {
      valid: true,
      memberId: hmsMemberId,
      status: 'ACTIVE',
      message: 'HMS Member ID 유효 (임시 구현)',
    };
  }

  /**
   * HMS API용 10자리 납부자 번호 생성
   * - 전화번호에서 10자리 추출 (01012345678 -> 0101234567)
   * - 전화번호가 부족하면 카드번호 뒷 10자리 사용
   */
  private extractPayerNumber(cardNumber: string, phone: string): string {
    // 전화번호에서 10자리 추출 (하이픈 제거 후 앞 10자리)
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length >= 10) {
      return cleanPhone.slice(0, 10);
    }

    // 전화번호가 10자리 미만이면 카드번호 뒷 10자리 사용
    const cleanCardNumber = cardNumber.replace(/[^0-9]/g, '');
    if (cleanCardNumber.length >= 10) {
      return cleanCardNumber.slice(-10);
    }

    // 둘 다 부족하면 기본값
    return '0000000000';
  }

  @Get('hms-cms/:hmsMemberId/info')
  @ApiOperation({
    summary: 'HMS CMS 회원 정보 조회',
    description: 'HMS CMS 정기결제 회원의 상세 정보를 조회합니다.',
  })
  @ApiParam({
    name: 'hmsMemberId',
    description: 'HMS Member ID',
    example: 'HMS_123456789',
  })
  @ApiResponse({
    status: 200,
    description: 'HMS CMS 회원 정보 조회 성공',
    schema: {
      type: 'object',
      properties: {
        memberId: { type: 'string', example: 'HMS_123456789' },
        status: { type: 'string', example: 'ACTIVE' },
        hmsStatus: { type: 'string', example: 'ACTIVE' },
        metadata: {
          type: 'object',
          properties: {
            message: { type: 'string', example: '임시 구현' },
          },
        },
      },
    },
  })
  async getHmsCmsMemberInfo(@Param('hmsMemberId') hmsMemberId: string) {
    // TODO: PaymentMethodService로 이동 필요
    // 임시로 기본 응답 반환
    return {
      memberId: hmsMemberId,
      status: 'ACTIVE',
      hmsStatus: 'ACTIVE',
      metadata: { message: '임시 구현' },
    };
  }
}
