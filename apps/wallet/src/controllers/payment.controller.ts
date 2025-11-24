import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpException,
  HttpStatus,
  Headers,
  BadRequestException,
  Req,
  HttpCode,
  Logger,
  UseGuards,
  Query,
} from '@nestjs/common';
import { PaymentService } from '../services/payment.service';
import { IntentService } from '../services/intents/intent.service';
import { PaymentProfileService } from '../services/profiles/payment-profile.service';
import { BnplService } from '../services/bnpl/bnpl.service';
import { JwtAuthGuard } from '../../../../libs/auth-core/src/guards/jwt-auth.guard';
import { User } from '../../../../libs/auth-core/src/decorators/user.decorator';

import {
  PaymentError,
  ProviderType,
} from '../providers/payment-provider.interface';
import { ZodValidationPipe } from 'nestjs-zod';
import { runInTransaction } from '../shared/database';
import { IdempotencyService } from '../services/idempotency.service';
import { DbService } from '@app/db';

import { walletSchema } from '../shared/database/schema';

import { FastifyRequest } from 'fastify';

import {
  ApiTags,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiHeader,
} from '@nestjs/swagger';
import { RefundService } from '../services/refund.service';

// Zod 스키마 및 DTO 임포트
import {
  CreateIntentSchema,
  AuthorizePaymentSchema,
  CapturePaymentSchema,
  CreateHmsCardProfileSchema,
  OnboardHmsBnplProfileSchema,
  CreateBnplAccountSchema,
  RefundPaymentSchema,
  // DTO 클래스들
  CreateIntentDto,
  AuthorizePaymentDto,
  CapturePaymentDto,
  CreateHmsCardProfileDto,
  CreateBnplAccountDto,
  RefundPaymentDto,
  // Response DTO 클래스들
  IntentResponseDto,
  AuthorizePaymentResponseDto,
  CapturePaymentResponseDto,
  HmsCardProfileResponseDto,
  RefundPaymentResponseDto,
  ErrorResponseDto,
  // BNPL DTOs
  BnplHistoryQueryDto,
  BnplHistoryResponseDto,
  BnplSummaryResponseDto,
  // Schemas
  BnplHistoryQuerySchema,
} from './payment.controller.zod';

/**
 * 결제 API 컨트롤러 (v2)
 *
 * Wallet 서비스의 결제 처리를 위한 REST API를 제공합니다.
 * 결제 의도(Intent) 생성부터 승인, 캡처까지의 전체 결제 플로우를 지원하며,
 * HMS 카드/BNPL 프로필 관리 및 체크아웃 세션 생성 기능을 포함합니다.
 *
 * @version 2.0
 * @author Wallet Team
 * @since 2025-01-15
 */
@ApiTags('결제 (Payments)')
@Controller('/payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);
  constructor(
    private readonly paymentService: PaymentService,
    private readonly intentService: IntentService,
    private readonly profileService: PaymentProfileService,
    private readonly bnplService: BnplService,
    private readonly db: DbService<typeof walletSchema>,
    private readonly idempotencyService: IdempotencyService,
    private readonly refundService: RefundService,
  ) { }

  @Post('intents')
  @ApiOperation({
    summary: '결제 의도(Intent) 생성',
    description: `새로운 결제 의도를 생성합니다. 
    
**결제 의도(Payment Intent)란?**
- 실제 결제 전에 결제할 의향을 나타내는 객체
- 고객 정보, 금액, 결제 타입 등의 메타데이터를 포함
- 이후 승인(authorize) → 캡처(capture) 단계로 진행

**지원하는 결제 타입:**
- \`PAYMENT\`: 일반 결제
- \`SUBSCRIPTION\`: 정기 결제
- \`REFUND\`: 환불

**멱등성 보장:**
- \`Idempotency-Key\` 헤더를 통해 중복 요청 방지
- 동일한 키로 재요청 시 기존 결과 반환`,
  })
  @ApiBody({
    description: '결제 의도 생성 요청',
    type: CreateIntentDto,
    examples: {
      payment: {
        summary: '일반 결제 의도',
        description: '단건 상품 구매를 위한 결제 의도',
        value: {
          customerId: 'customer_12345',
          amount: 29900,
          type: 'PAYMENT',
        },
      },
      subscription: {
        summary: '정기 결제 의도',
        description: '구독 서비스를 위한 정기 결제 의도',
        value: {
          customerId: 'customer_67890',
          amount: 9900,
          type: 'SUBSCRIPTION',
        },
      },
    },
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: '멱등성 보장을 위한 고유 키 (선택사항)',
    required: false,
    example: 'intent_create_20250115_abc123',
  })
  @ApiResponse({
    status: 201,
    description: '결제 의도 생성 성공',
    type: IntentResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 데이터',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '서버 내부 오류',
    type: ErrorResponseDto,
  })
  async createPaymentIntent(
    @Body(new ZodValidationPipe(CreateIntentSchema)) dto: CreateIntentDto,
    @Headers('Idempotency-Key') idemKey?: string,
  ) {
    try {
      return await runInTransaction(this.db, async (tx) => {
        const { hit, response } = await this.idempotencyService.checkOrCreate(
          tx,
          idemKey,
          dto.customerId,
          dto,
          'v2/payments/intents',
        );
        if (hit) return response;

        const newIntent = await this.intentService.createIntent(dto, tx);

        await this.idempotencyService.complete(tx, idemKey, newIntent);
        return newIntent;
      });
    } catch (error) {
      this.handleError(error, '결제 의도 생성');
    }
  }

  @Get('intents/:intentId')
  @ApiOperation({
    summary: '결제 의도(Intent) 조회',
    description: `결제 의도 ID로 상세 정보를 조회합니다.
    
**조회 가능한 정보:**
- Intent 기본 정보 (ID, 고객 ID, 금액, 상태 등)
- 생성/수정 시각
- 메타데이터 (주문명, 상품 정보 등)
- 현재 처리 상태

**Intent 상태:**
- \`PENDING\`: 생성됨, 결제 대기 중
- \`AUTHORIZED\`: 승인 완료, 캡처 대기 중
- \`CAPTURED\`: 결제 완료
- \`FAILED\`: 결제 실패
- \`CANCELLED\`: 취소됨`,
  })
  @ApiParam({
    name: 'intentId',
    description: '결제 의도 ID',
    example: 'intent_20250115_abc123',
  })
  @ApiResponse({
    status: 200,
    description: 'Intent 조회 성공',
    type: IntentResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Intent를 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '서버 내부 오류',
    type: ErrorResponseDto,
  })
  async getIntent(@Param('intentId') intentId: string) {
    try {
      this.logger.log(`Intent 조회 요청: ${intentId}`);

      const intent = await this.intentService.findById(intentId);

      if (!intent) {
        throw new Error(`Intent not found: ${intentId}`);
      }

      return intent;
    } catch (error) {
      this.handleError(error, 'Intent 조회');
    }
  }

  @Post('intents/:intentId/authorize')
  @ApiOperation({
    summary: '결제 승인 (Authorize)',
    description: `결제 수단을 승인하여 결제 가능한 상태로 만듭니다.
    
**승인(Authorize)과 캡처(Capture)의 분리:**
- **승인**: 결제 수단 유효성 검증 및 금액 홀드 (실제 차감 X)
- **캡처**: 실제 금액 차감 및 정산 처리

**지원 결제 제공자:**
- \`TOSS\`: 토스페이먼츠 (테스트/운영 환경 지원)

**Toss 결제 플로우:**
1. 클라이언트에서 Toss SDK로 결제 수단 선택
2. Toss에서 paymentKey 발급
3. 이 API로 paymentKey 전달하여 승인 처리
4. 별도 캡처 API로 실제 결제 완료

**멱등성:**
- 동일한 paymentKey로 재요청 시 기존 결과 반환`,
  })
  @ApiParam({
    name: 'intentId',
    description: '결제 의도 ID',
    example: 'intent_20250115_abc123',
  })
  @ApiBody({
    description: '결제 승인 요청',
    type: AuthorizePaymentDto,
    examples: {
      toss: {
        summary: 'Toss 결제 승인',
        description: 'Toss SDK에서 받은 paymentKey로 승인 처리',
        value: {
          provider: 'TOSS',
          paymentKey: 'tgen_20250115123456_aB3Cd4Ef',
        },
      },
    },
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: '멱등성 보장을 위한 고유 키 (선택사항)',
    required: false,
    example: 'authorize_20250115_xyz789',
  })
  @ApiResponse({
    status: 200,
    description: '결제 승인 성공',
    type: AuthorizePaymentResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 또는 결제 승인 실패',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Intent를 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '서버 내부 오류',
    type: ErrorResponseDto,
  })
  async authorizePayment(
    @Param('intentId') intentId: string,
    @Body(new ZodValidationPipe(AuthorizePaymentSchema))
    dto: AuthorizePaymentDto,
    @Req() request: any,
    @Headers('Idempotency-Key') idemKey?: string,
  ) {
    try {
      this.logger.log(`🔍 AUTHORIZE 시작 - intentId: ${intentId}`);

      // Intent 존재 여부 확인 (서비스에서도 확인하지만, 404를 명확히 하기 위해)
      const intent = await this.intentService.findById(intentId);
      if (!intent) {
        throw new Error('Intent not found');
      }

      // Provider 타입 결정
      let providerType: ProviderType | null = null;
      if (dto.provider === 'TOSS') {
        providerType = ProviderType.TOSS;
      } else if (dto.provider === 'HMS_CARD') {
        providerType = ProviderType.HMS_CARD;
      } else if (dto.provider === 'HMS_BNPL') {
        providerType = ProviderType.HMS_BNPL;
      }

      // 서비스 호출
      const result = await this.paymentService.authorizePaymentByIntent(
        intentId,
        providerType,
        {
          authParams: dto.authParams,
          profileId: dto.profileId,
          usePoints: dto.usePoints,
          source: 'api',
          actor: 'frontend_user',
        },
      );

      // 서비스 실패 결과를 에러로 변환
      if (!result.success) {
        throw new Error(result.message || 'Payment authorization failed');
      }

      // 서비스 결과를 HTTP 응답 형식으로 변환 (전송 계층 책임)
      return {
        success: true,
        intentId: intentId,
        attemptId: result.attemptId,
        status: 'AUTHORIZED',
        provider: dto.provider,
        amount: intent.finalAmount,
        paymentKey:
          dto.provider === 'TOSS' && dto.authParams
            ? dto.authParams.paymentKey
            : null,
        pointEventId: result.pointEventId,
        breakdown: result.breakdown,
        message: '결제 승인이 성공적으로 완료되었습니다.',
      };
    } catch (error) {
      this.handleError(error, '결제 승인');
    }
  }

  @Post('intents/:intentId/capture')
  @ApiOperation({
    summary: '결제 캡처 (Capture)',
    description: `승인된 결제를 실제로 정산 처리합니다.
    
**캡처(Capture)란?**
- 승인 단계에서 홀드된 금액을 실제로 차감하는 과정
- 캡처 완료 후 고객에게 실제 청구되며, 판매자에게 정산됨
- 부분 캡처도 지원 (승인 금액보다 적은 금액 캡처 가능)

**사용 시나리오:**
- 상품 발송 완료 후 캡처 (배송 후 결제)
- 서비스 제공 완료 후 캡처
- 부분 취소 시 남은 금액만 캡처

**부분 캡처:**
- amount 파라미터로 캡처할 금액 지정
- 미지정 시 승인된 전체 금액 캡처
- 승인 금액보다 큰 금액 캡처는 불가

**주의사항:**
- 승인된 결제만 캡처 가능
- 캡처 후에는 취소 불가 (환불만 가능)`,
  })
  @ApiParam({
    name: 'intentId',
    description: '결제 의도 ID',
    example: 'intent_20250115_abc123',
  })
  @ApiBody({
    description: '결제 캡처 요청',
    type: CapturePaymentDto,
    examples: {
      full: {
        summary: '전체 금액 캡처',
        description: '승인된 전체 금액을 캡처',
        value: {
          attemptId: 'attempt_20250115_def456',
        },
      },
      partial: {
        summary: '부분 금액 캡처',
        description: '승인된 금액 중 일부만 캡처 (예: 29,900원 중 20,000원)',
        value: {
          attemptId: 'attempt_20250115_def456',
          amount: 20000,
        },
      },
    },
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: '멱등성 보장을 위한 고유 키 (선택사항)',
    required: false,
    example: 'capture_20250115_uvw123',
  })
  @ApiResponse({
    status: 200,
    description: '결제 캡처 성공',
    type: CapturePaymentResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 또는 캡처 실패',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Intent 또는 Attempt를 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '서버 내부 오류',
    type: ErrorResponseDto,
  })
  async capturePayment(
    @Param('intentId') intentId: string,
    @Body(new ZodValidationPipe(CapturePaymentSchema)) dto: CapturePaymentDto,
    @Headers('Idempotency-Key') idemKey?: string,
  ) {
    try {
      this.logger.log(
        `결제 캡처 요청: Intent ${intentId}, Attempt ${dto.attemptId}`,
      );

      const result = await this.paymentService.capturePaymentByIntent(
        intentId,
        dto.attemptId,
        dto.amount,
        {
          source: 'capture_api',
          actor: 'system',
        },
      );

      // 서비스 실패 결과를 에러로 변환
      if (!result.success) {
        throw new Error(result.message || 'Payment capture failed');
      }

      // 서비스 결과를 HTTP 응답 형식으로 변환
      return {
        success: true,
        intentId: intentId,
        attemptId: dto.attemptId,
        status: 'CAPTURED',
        amount: dto.amount,
        message: '결제 캡처가 성공적으로 완료되었습니다.',
      };
    } catch (error) {
      this.handleError(error, '결제 캡처');
    }
  }

  @Get('profiles')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: '결제 프로필 목록 조회',
    description: `사용자의 모든 결제 프로필을 조회합니다.
    
**반환 정보:**
- 프로필 ID
- 프로필 종류 (CARD, BANK_ACCOUNT, WALLET)
- 결제 제공자 (HMS_CARD, HMS_BNPL, TOSS)
- 프로필 상태
- 상세 정보 (카드사, 마스킹된 번호 등)`,
  })
  @ApiResponse({
    status: 200,
    description: '결제 프로필 목록 조회 성공',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '프로필 ID' },
          kind: { type: 'string', description: '프로필 종류' },
          provider: { type: 'string', description: '결제 제공자' },
          status: { type: 'string', description: '프로필 상태' },
          name: { type: 'string', description: '프로필 이름' },
          details: { type: 'object', description: '상세 정보' },
          createdAt: { type: 'string', description: '등록일시' },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: '인증 실패',
    type: ErrorResponseDto,
  })
  async getPaymentProfiles(@User('userId') userId: string) {
    try {
      this.logger.log(`결제 프로필 목록 조회: userId=${userId}`);

      const profiles = await this.profileService.getPaymentProfiles(userId);

      this.logger.log(`✅ 프로필 조회 성공: ${profiles.length}개`);
      return profiles;
    } catch (error) {
      this.logger.error(`❌ 프로필 조회 실패:`, error);
      this.handleError(error, '결제 프로필 조회');
    }
  }

  @Post('profiles/hms-card')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'HMS 카드 프로필 생성',
    description: `HMS(Hyundai Motor Service) 카드 결제를 위한 프로필을 생성합니다.
    
**HMS 카드 프로필이란?**
- 현대자동차 금융서비스 카드 결제를 위한 정보
- 카드 번호, 유효기간, 비밀번호 등을 안전하게 저장
- 이후 결제 시 프로필 ID로 간편 결제 가능

**보안 처리:**
- 민감한 카드 정보는 암호화하여 저장
- PCI-DSS 규정에 따른 보안 처리
- 카드 정보는 HMS 시스템에만 전달`,
  })
  @ApiBody({
    description: 'HMS 카드 프로필 생성 요청',
    type: CreateHmsCardProfileDto,
    examples: {
      hmsCard: {
        summary: 'HMS 카드 프로필',
        value: {
          memberName: '김현대',
          phone: '01012345678',
          payerNumber: '901201',
          paymentNumber: '1234567890123456',
          payerName: '김현대',
          validYear: '28',
          validMonth: '12',
          validUntil: '2812',
          password: '12',
          paymentCompany: 'HMC',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'HMS 카드 프로필 생성 성공',
    type: HmsCardProfileResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 카드 정보 또는 유효성 검증 실패',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: '인증 실패',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '프로필 생성 중 서버 오류',
    type: ErrorResponseDto,
  })
  async createHmsCardProfile(
    @User('userId') userId: string,
    @Body(new ZodValidationPipe(CreateHmsCardProfileSchema))
    dto: CreateHmsCardProfileDto,
  ) {
    try {
      this.logger.log(`📥 HMS 카드 프로필 생성 요청 - userId: ${userId}`);
      this.logger.debug(`📥 요청 데이터:`, JSON.stringify(dto, null, 2));

      // JWT에서 추출한 userId 사용
      const result = await this.profileService.createHmsCardProfile({
        ...dto,
        userId,
      });

      this.logger.log(`✅ HMS 카드 프로필 생성 성공 - profileId: ${result}`);
      return result;
    } catch (error) {
      this.handleError(error, 'HMS 카드 프로필 생성');
    }
  }

  @Post('/hms-bnpl/onboard')
  @HttpCode(201)
  @ApiOperation({ summary: 'HMS BNPL 프로필 및 동의서 등록' })
  @ApiConsumes('multipart/form-data')
  // Swagger를 위한 Body 스키마 명시 (실제 DTO는 파싱해서 사용)
  async onboardHmsBnplProfile(@Req() req: FastifyRequest) {
    try {
      // 1. Multipart 요청 파싱
      // @ts-ignore - fastify-multipart 타입 이슈
      const data = await req.file(); // fastify-multipart API 사용
      if (!data) {
        throw new BadRequestException(
          '동의서 파일을 포함한 multipart 요청이 필요합니다.',
        );
      }
      const buffer = await data.toBuffer();

      // 2. 필드 데이터 Zod 유효성 검사
      const fields: any = {};
      for (const key in data.fields) {
        fields[key] = (data.fields[key] as any).value;
      }

      const validation = OnboardHmsBnplProfileSchema.safeParse(fields);
      if (!validation.success) {
        throw new BadRequestException(validation.error.flatten().fieldErrors);
      }
      const dto = validation.data;

      // 3. 서비스 호출
      const result =
        await this.profileService.createHmsBnplProfileWithAgreement(
          dto.userId,
          {
            ...dto,
            agreementFile: {
              file: buffer,
              filename: data.filename,
            },
          },
        );
      return { success: true, ...result };
    } catch (error) {
      this.handleError(error, 'HMS BNPL 프로필 온보딩');
    }
  }

  @Get('bnpl/history')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'BNPL 월별 내역 조회',
    description: '특정 연/월의 BNPL 결제 내역을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: BnplHistoryResponseDto,
  })
  async getBnplHistory(
    @User('userId') userId: string,
    @Query(new ZodValidationPipe(BnplHistoryQuerySchema))
    query: BnplHistoryQueryDto,
  ) {
    try {
      return await this.bnplService.getBnplHistory(
        userId,
        query.year,
        query.month,
      );
    } catch (error) {
      this.handleError(error, 'BNPL 내역 조회');
    }
  }

  @Get('bnpl/summary')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'BNPL 요약 정보 조회',
    description: '이번 달 사용 금액, 한도, 결제일 정보를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: BnplSummaryResponseDto,
  })
  async getBnplSummary(@User('userId') userId: string) {
    try {
      return await this.bnplService.getBnplSummary(userId);
    } catch (error) {
      this.handleError(error, 'BNPL 요약 조회');
    }
  }

  @Post('bnpl/accounts')
  @HttpCode(201)
  @ApiOperation({ summary: 'BNPL 계정 생성' })
  @ApiResponse({
    status: 201,
    description: 'BNPL 계정 생성 성공',
  })
  async createBnplAccount(
    @Body(new ZodValidationPipe(CreateBnplAccountSchema))
    dto: CreateBnplAccountDto,
  ) {
    try {
      this.logger.log(`BNPL 계정 생성 요청: ${JSON.stringify(dto)}`);

      const account = await this.bnplService.createAccount(
        dto.userId,
        dto.creditLimit,
      );

      return {
        success: true,
        accountId: account.id,
        userId: account.userId,
        creditLimit: account.creditLimit,
        availableLimit: account.availableLimit,
        status: account.status,
      };
    } catch (error) {
      this.handleError(error, 'BNPL 계정 생성');
    }
  }

  @Post(':intentId/refund')
  @ApiOperation({
    summary: '결제 환불',
    description: `결제를 환불합니다.
    
**환불 처리 방식:**
- 포인트와 현금을 비율에 따라 환불
- 포인트는 즉시 복원
- 현금은 결제 수단에 따라 환불

**부분 환불:**
- amount 파라미터로 환불 금액 지정
- 미지정 시 전액 환불
- 포인트:현금 비율은 원래 결제 비율과 동일

**환불 비율 계산:**
- 비율 = 환불금액 / 총금액
- 포인트 환불 = floor(총포인트 * 비율)
- 현금 환불 = 환불금액 - 포인트환불

**BNPL 처리:**
- AUTHORIZED 상태: void 처리 (출금 취소)
- CAPTURED 상태: refund 처리 (환불)`,
  })
  @ApiParam({
    name: 'intentId',
    description: '환불할 결제 의도 ID',
    example: 'intent_20250115_abc123',
  })
  @ApiBody({
    description: '환불 요청',
    type: RefundPaymentDto,
    examples: {
      full: {
        summary: '전액 환불',
        description: '결제 전체를 환불',
        value: {
          reason: 'CUSTOMER_REQUEST',
        },
      },
      partial: {
        summary: '부분 환불',
        description: '결제 일부를 환불 (예: 29,900원 중 10,000원)',
        value: {
          amount: 10000,
          reason: 'PARTIAL_CANCEL',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '환불 성공',
    type: RefundPaymentResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '환불 불가 상태 또는 잘못된 요청',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Intent를 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '서버 내부 오류',
    type: ErrorResponseDto,
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: '멱등성 보장을 위한 고유 키 (선택사항)',
    required: false,
    example: 'refund_20250115_xyz789',
  })
  async refundPayment(
    @Param('intentId') intentId: string,
    @Body(new ZodValidationPipe(RefundPaymentSchema)) dto: RefundPaymentDto,
    @Headers('Idempotency-Key') idemKey?: string,
  ) {
    try {
      this.logger.log(
        `환불 요청: Intent ${intentId}, Amount ${dto.amount || 'FULL'}, ` +
        `Reason ${dto.reason}, IdemKey ${idemKey || 'none'}`,
      );

      return await runInTransaction(this.db, async (tx) => {
        // 멱등성 키 체크
        const { hit, response } = await this.idempotencyService.checkOrCreate(
          tx,
          idemKey,
          intentId,
          dto,
          `/payments/${intentId}/refund`,
        );

        if (hit) {
          this.logger.log(`멱등성 키 히트: ${idemKey}, 기존 결과 반환`);
          return response;
        }

        // 환불 처리
        const result = await this.refundService.refundPayment(
          intentId,
          dto.amount,
          dto.reason || 'CUSTOMER_REQUEST',
        );

        // 멱등성 키 완료 처리
        await this.idempotencyService.complete(tx, idemKey, result);

        this.logger.log(`🎯 환불 결과:`, JSON.stringify(result));
        return result;
      });
    } catch (error) {
      this.handleError(error, '결제 환불');
    }
  }

  /**
   * 컨트롤러에서 발생하는 에러를 중앙에서 처리하여 HTTP 응답으로 변환합니다.
   *
   * [CTO 스타일] 서비스에서 던진 일반 Error를 전송 방식에 맞게 변환합니다.
   *
   * 기본 정책:
   * - 대부분의 에러는 400(BadRequest)으로 처리하여 사용자에게 구체적 메시지 전달
   * - 404(Not Found)는 명시적인 리소스 없음 상황만
   * - 500(Internal Server Error)은 정말 예외적인 시스템 에러만
   *
   * 환경별 처리:
   * - 개발 환경: 모든 에러 메시지를 그대로 전달 (디버깅 편의)
   * - 운영 환경: 시스템 에러는 메시지 숨김, 비즈니스 에러는 전달
   *
   * @param error 발생한 에러 객체
   * @param context 에러가 발생한 컨텍스트 (로깅용)
   */
  private handleError(error: unknown, context: string): never {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const isDevelopment = process.env.NODE_ENV !== 'production';

    this.logger.error(`❌ ${context} 실패: ${errorMessage}`, errorStack);

    // 이미 HTTP 에러인 경우 그대로 다시 던짐
    if (error instanceof HttpException) {
      throw error;
    }

    // PaymentError는 도메인 에러로 특별 처리
    if (error instanceof PaymentError) {
      if (error.code === 'PROVIDER_FAILED') {
        throw new HttpException(error.message, HttpStatus.BAD_GATEWAY); // 502
      }
      throw new BadRequestException(error.message); // 400
    }

    // 문자열 패턴 기반 에러 매핑 (CTO 스타일)
    const message = errorMessage.toLowerCase();

    // 404: 리소스를 찾을 수 없는 경우
    if (message.includes('not found')) {
      throw new HttpException(errorMessage, HttpStatus.NOT_FOUND); // 404
    }

    // 500: 정말 예외적인 시스템 에러만 (DB 연결 실패, 예기치 않은 null 등)
    // 스택 트레이스를 통해 시스템 에러인지 판단
    const isSystemError =
      errorStack &&
      (errorStack.includes('ECONNREFUSED') || // DB 연결 실패
        errorStack.includes('ETIMEDOUT') || // 타임아웃
        errorStack.includes('Cannot read property') || // null/undefined 접근
        errorStack.includes('is not a function')); // 타입 에러

    if (isSystemError) {
      // 개발 환경: 디버깅을 위해 실제 에러 메시지 노출
      // 운영 환경: 민감한 정보 숨김
      const clientMessage = isDevelopment
        ? `[DEV] ${errorMessage}`
        : '서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';

      throw new HttpException(clientMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    // 기본값: 400 BadRequest - 비즈니스 로직/유효성 에러는 모두 여기로
    // 서비스에서 던진 에러 메시지를 그대로 사용자에게 전달
    throw new BadRequestException(errorMessage);
  }
}
