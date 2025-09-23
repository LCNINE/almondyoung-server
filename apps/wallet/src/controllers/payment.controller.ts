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

import { z } from 'zod';

import {
  PaymentError,
  PaymentType,
  ProviderType,
} from '../providers/payment-provider.interface'; // enum으로 변경했다고 가정
import { ZodValidationPipe } from 'nestjs-zod';
import { paymentIntentTypeEnum, runInTransaction } from '../shared/database';
import { IdempotencyService } from '../services/idempotency.service';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import { FastifyRequest } from 'fastify';
import { Multipart, MultipartFile } from '@fastify/multipart';
import { HmsBnplRegisterInput } from '../providers/hms-bnpl.registrar';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { UploadedFile } from '../shared/types/fastify-file';

import { CheckoutSessionService } from '../services/checkout-session.service';
// Zod 스키마 정의
export const CreateIntentSchema = z.object({
  customerId: z.string().min(1),
  amount: z.number().int().positive(),
  // ✨ [수정] z.nativeEnum()을 사용하여 TypeScript enum을 Zod 스키마로 변환합니다.
  type: z.enum(paymentIntentTypeEnum.enumValues),
});

export const ExecutePaymentSchema = z.object({
  provider: z.string().min(1),
  paymentKey: z.string().min(1),
});

export const ProcessIntentSchema = z.object({
  // ✨ [수정] z.nativeEnum()을 사용하여 TypeScript enum을 Zod 스키마로 변환합니다.
  providerType: z.nativeEnum(ProviderType),
  profileId: z.string().optional(),
  instrumentRef: z.string().optional(), // Toss의 paymentKey 등
});

export const CreateHmsCardProfileSchema = z.object({
  userId: z.string().min(1),
  memberId: z.string().min(1).max(20),
  memberName: z.string().min(1).max(25),
  phone: z
    .string()
    .max(12, '전화번호 형식이 잘못되었습니다')
    .min(1, '전화번호를 입력해주세요')
    .regex(/^\d+$/, '숫자만 입력해주세요'),
  payerNumber: z
    .string()
    .max(10, '10자 이내로 입력해주세요')
    .min(6, '6자리 생년월일을 입력해주세요')
    .regex(/^\d+$/, '숫자만 입력해주세요'),
  paymentNumber: z
    .string()
    .max(16, '16자 이내로 입력해주세요')
    .min(1, '카드번호를 입력해주세요')
    .regex(/^\d+$/, '숫자만 입력해주세요'),
  payerName: z
    .string()
    .max(10, '10자 이내로 입력해주세요')
    .min(1, '납부자명을 입력해주세요'),
  validYear: z
    .string()
    .max(2, '카드 유효기간 년도를 입력해주세요')
    .min(2, '카드 유효기간 년도를 입력해주세요')
    .regex(/^\d+$/, '숫자만 입력해주세요'),
  validMonth: z
    .string()
    .max(2, '카드 유효기간 월을 입력해주세요')
    .min(2, '카드 유효기간 월을 입력해주세요')
    .regex(/^\d+$/, '숫자만 입력해주세요'),
  validUntil: z
    .string()
    .max(4, '카드 유효기간을 입력해주세요')
    .min(4, '카드 유효기간을 입력해주세요'),
  password: z
    .string()
    .max(2, '비밀번호 앞 2자리를 입력해주세요')
    .min(2, '비밀번호 앞 2자리를 입력해주세요')
    .regex(/^\d+$/, '숫자만 입력해주세요'),
  paymentCompany: z.string().max(3, '결제 기관 코드를 입력해주세요'),
});

export const OnboardHmsBnplProfileSchema = z.object({
  userId: z.string().trim().min(1, '사용자 ID는 필수입니다.'),
  payerName: z.string().trim().min(1, '납부자명은 필수입니다.'),
  phone: z.string().trim().min(10, '올바른 전화번호를 입력해주세요.'),
  paymentCompany: z.string().trim().min(1, '은행 코드는 필수입니다.'),
  paymentNumber: z.string().trim().min(1, '계좌 번호는 필수입니다.'),
  payerNumber: z.string().trim().min(6, '생년월일 6자리를 입력해주세요.'),
  name: z.string().optional().nullable(), // 우리 시스템에서 사용할 프로필 별칭
});

export const CreateBnplAccountSchema = z.object({
  userId: z.string().trim().min(1, '사용자 ID는 필수입니다.'),
  creditLimit: z.number().int().positive('신용 한도는 양수여야 합니다.'),
});

// --- DTO 타입 추론 ---
// ... (기존 타입)
export type OnboardHmsBnplProfileDto = z.infer<
  typeof OnboardHmsBnplProfileSchema
>;
export type CreateBnplAccountDto = z.infer<typeof CreateBnplAccountSchema>;

// DTO 타입 추론
export type CreateIntentDto = z.infer<typeof CreateIntentSchema>;
export type ExecutePaymentDto = z.infer<typeof ExecutePaymentSchema>;
export type ProcessIntentDto = z.infer<typeof ProcessIntentSchema>;
export type CreateHmsCardProfileDto = z.infer<
  typeof CreateHmsCardProfileSchema
>;

export const CreateCheckoutSessionSchema = z.object({
  intentId: z.string().min(1, 'intentId는 필수입니다.'),
  returnUrl: z.string().url('올바른 URL 형식이 아닙니다.'),
  cancelUrl: z.string().url('올바른 URL 형식이 아닙니다.'),
});

export const AuthorizePaymentSchema = z.object({
  provider: z.string().min(1, 'provider는 필수입니다.'),
  paymentKey: z.string().min(1, 'paymentKey는 필수입니다.'),
});

export const CapturePaymentSchema = z.object({
  attemptId: z.string().min(1, 'attemptId는 필수입니다.'),
  amount: z.number().int().positive().optional(),
});

export type CreateCheckoutSessionDto = z.infer<
  typeof CreateCheckoutSessionSchema
>;
export type AuthorizePaymentDto = z.infer<typeof AuthorizePaymentSchema>;
export type CapturePaymentDto = z.infer<typeof CapturePaymentSchema>;

@Controller('v2/payments') // API 버전 명시
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);
  constructor(
    private readonly paymentService: PaymentService,
    private readonly intentService: PaymentIntentService,
    private readonly profileService: PaymentProfileService,
    private readonly bnplAccountService: BnplAccountService,
    private readonly db: DbService<typeof schema>,
    private readonly idempotencyService: IdempotencyService,
    private readonly checkoutSessionService: CheckoutSessionService,
  ) {}

  @Post('intents')
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
    summary: 'Intent 조회',
    description: '결제 의도(Intent) ID로 Intent 정보를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'Intent 조회 성공',
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
    summary: '결제 승인',
    description:
      '클라이언트에서 받은 결제 정보로 결제를 승인합니다 (캡처는 별도 처리).',
  })
  @ApiResponse({
    status: 200,
    description: '결제 승인 성공',
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
        `결제 승인 요청: Intent ${intentId}, Provider ${dto.provider}`,
      );

      // Toss 결제 승인 처리
      if (dto.provider === 'TOSS') {
        const intent = await this.intentService.findIntentById(intentId);
        if (!intent) {
          throw new HttpException('Intent not found', HttpStatus.NOT_FOUND);
        }

        this.logger.log(`Toss 결제 승인 처리: paymentKey=${dto.paymentKey}`);

        // TOSS Provider에게 oneTimeToken으로 paymentKey 전달
        const result = await this.paymentService.authorizePaymentByIntent(
          intentId,
          'TOSS' as any, // ProviderType
          {
            // paymentKey를 oneTimeToken으로 전달하기 위해 instrumentRef에 저장
            instrumentRef: dto.paymentKey, // 이것이 TossPayload.oneTimeToken이 됨
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
    summary: '결제 캡처',
    description: '승인된 결제를 실제로 정산 처리합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '결제 캡처 성공',
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

  @Post('intents/:intentId/execute')
  @ApiOperation({
    summary: '결제 실행 (레거시)',
    description:
      '클라이언트에서 받은 결제 정보로 실제 결제를 실행합니다. (auth + capture 통합)',
  })
  @ApiResponse({
    status: 200,
    description: '결제 실행 성공',
  })
  async executePayment(
    @Param('intentId') intentId: string,
    @Body(new ZodValidationPipe(AuthorizePaymentSchema))
    dto: AuthorizePaymentDto, // ExecutePaymentDto와 AuthorizePaymentDto가 동일한 구조
    @Req() request: any,
    @Headers('Idempotency-Key') idemKey?: string,
  ) {
    try {
      this.logger.log(`🔍 원본 요청 body:`, JSON.stringify(request.body));
      this.logger.log(`🔍 파싱된 DTO:`, JSON.stringify(dto));
      this.logger.log(
        `결제 실행 요청 (레거시): Intent ${intentId}, Provider ${dto.provider}`,
      );

      // 1단계: 승인
      const authResult = await this.authorizePayment(
        intentId,
        dto,
        request,
        idemKey,
      );

      // 2단계: 즉시 캡처 (레거시 호환을 위해)
      const captureDto = {
        attemptId: (authResult as any).attemptId,
        amount: (authResult as any).amount,
      };
      const captureResult = await this.capturePayment(
        intentId,
        captureDto,
        idemKey,
      );

      // 레거시 응답 형식으로 반환
      return {
        success: true,
        intentId: intentId,
        status: 'CAPTURED',
        provider: dto.provider,
        amount: (authResult as any).amount,
        paymentKey: dto.paymentKey,
        message: '결제가 성공적으로 완료되었습니다.',
      };
    } catch (error) {
      this.handleError(error, '결제 실행');
    }
  }

  @Post('profiles/hms-card')
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
    description:
      'Intent ID로 체크아웃 페이지에 필요한 최소한의 UI 데이터만 반환합니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'UI 데이터 조회 성공',
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
    description:
      '결제 의도(Intent) ID를 받아, Wallet 자체 결제 UI로 연결되는 세션을 생성합니다.',
  })
  @ApiResponse({
    status: 201,
    description: '세션 생성 성공. paymentUrl로 리다이렉트 하세요.',
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
