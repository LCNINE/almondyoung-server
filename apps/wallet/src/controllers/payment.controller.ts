import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpException,
  HttpStatus,
  UsePipes,
  Headers,
  BadRequestException,
  Req,
  HttpCode,
  Logger, // ✨ 바로 이 부분이 @nestjs/common에서 온 것인지가 중요합니다.
} from '@nestjs/common';

import { PaymentService } from '../services/payment.service';
import { PaymentIntentService } from '../services/intents/intent.service';
import { PaymentProfileService } from '../services/profiles/payment-profile.service';
import { BnplAccountService } from '../services/bnpl-account.service';

import {
  PaymentError,
  PaymentType,
  ProviderType,
} from '../providers/payment-provider.interface';
import { ZodValidationPipe } from 'nestjs-zod';
import { runInTransaction } from '../shared/database';
import { IdempotencyService } from '../services/idempotency.service';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { walletSchema } from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import { FastifyRequest } from 'fastify';
import { Multipart, MultipartFile } from '@fastify/multipart';
import { HmsBnplRegisterInput } from '../providers/hms-bnpl.registrar';
import {
  ApiTags,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiHeader,
} from '@nestjs/swagger';
import { UploadedFile } from '../shared/types/fastify-file';

import { CheckoutSessionService } from '../services/checkout-session.service';
import { RefundService } from '../services/refund.service';

// Zod 스키마 및 DTO 임포트
import {
  CreateIntentSchema,
  AuthorizePaymentSchema,
  CapturePaymentSchema,
  CreateHmsCardProfileSchema,
  OnboardHmsBnplProfileSchema,
  CreateBnplAccountSchema,
  CreateCheckoutSessionSchema,
  ProcessIntentSchema,
  RefundPaymentSchema,
  // DTO 클래스들
  CreateIntentDto,
  AuthorizePaymentDto,
  CapturePaymentDto,
  CreateHmsCardProfileDto,
  OnboardHmsBnplProfileDto,
  CreateBnplAccountDto,
  CreateCheckoutSessionDto,
  ProcessIntentDto,
  RefundPaymentDto,
  // Response DTO 클래스들
  IntentResponseDto,
  AuthorizePaymentResponseDto,
  CapturePaymentResponseDto,
  ExecutePaymentResponseDto,
  HmsCardProfileResponseDto,
  OnboardHmsBnplProfileResponseDto,
  CreateBnplAccountResponseDto,
  CreateCheckoutSessionResponseDto,
  CheckoutUIDataResponseDto,
  RefundPaymentResponseDto,
  ErrorResponseDto,
  // 타입들 (기존 호환성)
  CreateIntentDtoType,
  AuthorizePaymentDtoType,
  CapturePaymentDtoType,
  CreateHmsCardProfileDtoType,
  OnboardHmsBnplProfileDtoType,
  CreateBnplAccountDtoType,
  CreateCheckoutSessionDtoType,
  ProcessIntentDtoType,
  RefundPaymentDtoType,
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
@Controller('v2/payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);
  constructor(
    private readonly paymentService: PaymentService,
    private readonly intentService: PaymentIntentService,
    private readonly profileService: PaymentProfileService,
    private readonly bnplAccountService: BnplAccountService,
    private readonly db: DbService<typeof walletSchema>,
    private readonly idempotencyService: IdempotencyService,
    private readonly checkoutSessionService: CheckoutSessionService,
    private readonly refundService: RefundService,
  ) {}

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
    return runInTransaction(this.db, async (tx) => {
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

      const intent = await this.intentService.findIntentById(intentId);

      if (!intent) {
        throw new HttpException(
          `Intent not found: ${intentId}`,
          HttpStatus.NOT_FOUND,
        );
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
      this.logger.log(`🔍 원본 요청 body:`, JSON.stringify(request.body));
      this.logger.log(`🔍 파싱된 DTO:`, JSON.stringify(dto));
      this.logger.log(
        `결제 승인 요청: Intent ${intentId}, Provider ${dto.provider || '포인트 전액'}`,
      );

      const intent = await this.intentService.findIntentById(intentId);
      if (!intent) {
        throw new HttpException('Intent not found', HttpStatus.NOT_FOUND);
      }

      // ✅ 포인트 전액 결제 (provider 없음)
      if (!dto.provider) {
        this.logger.log('포인트 전액 결제 처리');

        const result = await this.paymentService.authorizePaymentByIntent(
          intentId,
          null, // provider 없음
          {
            usePoints: dto.usePoints,
            source: 'point_full_payment_api',
            actor: 'frontend_user',
          },
        );

        this.logger.log(`🎯 포인트 결제 결과:`, JSON.stringify(result));

        if (result.success) {
          return {
            success: true,
            intentId: intentId,
            attemptId: result.attemptId,
            status: 'AUTHORIZED',
            provider: null,
            amount: intent.amount,
            paymentKey: null,
            pointEventId: result.pointEventId,
            breakdown: result.breakdown,
            message: '포인트 전액 결제가 성공적으로 완료되었습니다.',
          };
        } else {
          throw new HttpException(
            `포인트 결제 실패: ${result.message}`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      // Toss 결제 승인 처리
      if (dto.provider === 'TOSS') {
        this.logger.log(`Toss 결제 승인 처리: paymentKey=${dto.paymentKey}`);

        // TOSS Provider에게 oneTimeToken으로 paymentKey 전달
        const result = await this.paymentService.authorizePaymentByIntent(
          intentId,
          'TOSS' as any, // ProviderType
          {
            // paymentKey를 oneTimeToken으로 전달하기 위해 instrumentRef에 저장
            instrumentRef: dto.paymentKey, // 이것이 TossPayload.oneTimeToken이 됨
            usePoints: dto.usePoints, // 포인트 사용 금액 전달
            source: 'toss_authorize_api',
            actor: 'frontend_user',
          },
        );

        this.logger.log(`🎯 결제 승인 결과:`, JSON.stringify(result));

        if (result.success) {
          const response = {
            success: true,
            intentId: intentId,
            attemptId: result.attemptId,
            status: 'AUTHORIZED',
            provider: 'TOSS',
            amount: intent.amount,
            paymentKey: dto.paymentKey,
            pointEventId: result.pointEventId, // ✅ 포인트 정보 추가
            breakdown: result.breakdown, // ✅ 금액 분해 정보 추가
            message: 'Toss 결제 승인이 성공적으로 완료되었습니다.',
          };

          this.logger.log(
            `🎉 Toss 결제 승인 완료 응답:`,
            JSON.stringify(response),
          );
          return response;
        } else {
          throw new HttpException(
            `결제 승인 실패: ${result.message}`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      throw new HttpException(
        `지원하지 않는 Provider: ${dto.provider}`,
        HttpStatus.BAD_REQUEST,
      );
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

      this.logger.log(`🎯 결제 캡처 결과:`, JSON.stringify(result));

      if (result.success) {
        const response = {
          success: true,
          intentId: intentId,
          attemptId: dto.attemptId,
          status: 'CAPTURED',
          amount: dto.amount,
          message: '결제 캡처가 성공적으로 완료되었습니다.',
        };

        this.logger.log(`🎉 결제 캡처 완료 응답:`, JSON.stringify(response));
        return response;
      } else {
        throw new HttpException(
          `결제 캡처 실패: ${result.message}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    } catch (error) {
      this.handleError(error, '결제 캡처');
    }
  }

  @Post('profiles/hms-card')
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
          userId: 'user_12345',
          memberId: 'HM20250115001',
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
    status: 500,
    description: '프로필 생성 중 서버 오류',
    type: ErrorResponseDto,
  })
  async createHmsCardProfile(
    @Body(new ZodValidationPipe(CreateHmsCardProfileSchema))
    dto: CreateHmsCardProfileDto,
  ) {
    try {
      // 추후 userid jwt토큰에서 추출하는것으로 바꿀것.
      // const { userId, ...profileData } = dto;
      return await this.profileService.createHmsCardProfile(dto);
    } catch (error) {
      // ... (에러 처리)
      throw new HttpException(
        'Failed to create HMS card profile',
        HttpStatus.BAD_REQUEST,
      );
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

      const account = await this.bnplAccountService.createBnplAccount(
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

  @Get('checkout/ui-data/:intentId')
  @ApiOperation({
    summary: '체크아웃 UI 데이터 조회',
    description: `체크아웃 페이지 렌더링에 필요한 최소한의 데이터를 반환합니다.
    
**반환되는 정보:**
- Intent 기본 정보 (ID, 금액, 주문명)
- 지원 가능한 결제 제공자 목록
- 각 제공자별 클라이언트 설정 (API 키 등)

**보안 고려사항:**
- 민감한 정보는 제외 (시크릿 키, 개인정보 등)
- 클라이언트 측에서 안전하게 사용할 수 있는 정보만 포함
- Intent 상태가 PENDING인 경우에만 조회 가능

**사용 시나리오:**
- 체크아웃 페이지 초기화
- 결제 제공자별 SDK 초기화
- 결제 UI 구성`,
  })
  @ApiParam({
    name: 'intentId',
    description: '결제 의도 ID',
    example: 'intent_20250115_abc123',
  })
  @ApiResponse({
    status: 200,
    description: '체크아웃 UI 데이터 조회 성공',
    type: CheckoutUIDataResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Intent 상태가 PENDING이 아님',
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
  async getCheckoutUIData(@Param('intentId') intentId: string) {
    try {
      this.logger.log(`체크아웃 UI 데이터 요청: ${intentId}`);

      const intent = await this.intentService.findIntentById(intentId);

      if (!intent) {
        throw new HttpException(
          `Intent not found: ${intentId}`,
          HttpStatus.NOT_FOUND,
        );
      }

      if (intent.status !== 'PENDING') {
        throw new HttpException(
          `Intent is not in PENDING status: ${intent.status}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      // 민감하지 않은 UI 정보만 반환
      return {
        intentId: intent.id,
        amount: intent.amount,
        orderName: (intent.metadata as any)?.orderName || '결제',
        allowedProviders: ['TOSS'], // Toss 테스트 서버만 사용
        clientConfig: {
          TOSS: {
            clientKey:
              process.env.TOSS_CLIENT_KEY ||
              'test_ck_pP2YxJ4K87ZZmMga5K59rRGZwXLO', // 시크릿 키와 매칭되는 클라이언트 키
          },
        },
      };
    } catch (error) {
      this.handleError(error, '체크아웃 UI 데이터 조회');
    }
  }

  @Post('checkout/sessions')
  @ApiOperation({
    summary: '범용 체크아웃 세션 생성',
    description: `결제 의도를 기반으로 체크아웃 세션을 생성합니다.
    
**체크아웃 세션이란?**
- 결제 진행을 위한 임시 세션
- 보안이 강화된 결제 전용 URL 제공
- 세션 만료 시간 내에서만 유효

**세션 기반 결제 플로우:**
1. Intent 생성
2. 체크아웃 세션 생성 (이 API)
3. 반환된 paymentUrl로 사용자 리다이렉트
4. Wallet 결제 페이지에서 결제 진행
5. 완료 후 returnUrl 또는 cancelUrl로 리다이렉트

**보안 특징:**
- 세션 ID 기반 접근 제어
- 만료 시간 설정 (기본 30분)
- CSRF 보호
- 결제 완료 후 세션 자동 무효화

**URL 설정:**
- returnUrl: 결제 성공 시 리다이렉트
- cancelUrl: 결제 취소 시 리다이렉트`,
  })
  @ApiBody({
    description: '체크아웃 세션 생성 요청',
    type: CreateCheckoutSessionDto,
    examples: {
      session: {
        summary: '체크아웃 세션 생성',
        value: {
          intentId: 'intent_20250115_abc123',
          returnUrl: 'https://mystore.com/payment/success',
          cancelUrl: 'https://mystore.com/payment/cancel',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: '체크아웃 세션 생성 성공',
    type: CreateCheckoutSessionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 또는 Intent 상태 오류',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Intent를 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '세션 생성 중 서버 오류',
    type: ErrorResponseDto,
  })
  async createSession(
    @Body(new ZodValidationPipe(CreateCheckoutSessionSchema))
    dto: CreateCheckoutSessionDto,
  ) {
    try {
      this.logger.log(`체크아웃 세션 생성 요청: Intent ID ${dto.intentId}`);

      const session = await this.checkoutSessionService.createCheckoutSession(
        dto.intentId,
        {
          returnUrl: dto.returnUrl,
          cancelUrl: dto.cancelUrl,
        },
      );

      return session;
    } catch (error) {
      this.logger.error(
        `체크아웃 세션 생성 실패: ${error.message}`,
        error.stack,
      );
      if (error instanceof PaymentError) {
        if (error.code === 'INTENT_NOT_FOUND') {
          throw new HttpException(error.message, HttpStatus.NOT_FOUND);
        }
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        '세션 생성 중 서버 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
  async refundPayment(
    @Param('intentId') intentId: string,
    @Body(new ZodValidationPipe(RefundPaymentSchema)) dto: RefundPaymentDto,
  ) {
    try {
      this.logger.log(
        `환불 요청: Intent ${intentId}, Amount ${dto.amount || 'FULL'}, Reason ${dto.reason}`,
      );

      const result = await this.refundService.refundPayment(
        intentId,
        dto.amount,
        dto.reason || 'CUSTOMER_REQUEST',
      );

      this.logger.log(`🎯 환불 결과:`, JSON.stringify(result));

      return result;
    } catch (error) {
      this.handleError(error, '결제 환불');
    }
  }

  /**
   * 컨트롤러에서 발생하는 에러를 중앙에서 처리하여 HTTP 응답으로 변환합니다.
   * @param error 발생한 에러 객체
   * @param context 에러가 발생한 컨텍스트 (로깅용)
   */
  private handleError(error: unknown, context: string): never {
    // this.logger.error(
    //   `❌ ${context} 실패: ${error instanceof Error ? error.message : String(error)}`,
    //   error instanceof Error ? error.stack : undefined,
    // );

    if (error instanceof PaymentError) {
      // 서비스 계층에서 발생한 도메인 에러를 HTTP 에러로 매핑
      if (error.code === 'PROVIDER_FAILED') {
        throw new HttpException(error.message, HttpStatus.BAD_GATEWAY); // 502
      }
      throw new BadRequestException(error.message); // 400
    }

    if (error instanceof HttpException) {
      // 이미 HTTP 에러인 경우 그대로 다시 던짐
      throw error;
    }

    // 예측하지 못한 모든 에러는 500 서버 에러로 처리
    throw new HttpException(
      '서버 내부 오류가 발생했습니다.',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
