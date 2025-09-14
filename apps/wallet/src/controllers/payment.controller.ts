import {
  Controller,
  Post,
  Body,
  Param,
  HttpException,
  HttpStatus,
  UsePipes,
} from '@nestjs/common';

import { PaymentService } from '../services/payment.service';
import { PaymentIntentService } from '../services/intents/intent.service';
import { PaymentProfileService } from '../services/profiles/payment-profile.service';

import { z } from 'zod';

import {
  PaymentError,
  PaymentType,
  ProviderType,
} from '../providers/payment-provider.interface'; // enum으로 변경했다고 가정
import { ZodValidationPipe } from 'nestjs-zod';
import { paymentIntentTypeEnum } from '../shared/database';

// Zod 스키마 정의
export const CreateIntentSchema = z.object({
  customerId: z.string().min(1),
  amount: z.number().int().positive(),
  // ✨ [수정] z.nativeEnum()을 사용하여 TypeScript enum을 Zod 스키마로 변환합니다.
  type: z.enum(paymentIntentTypeEnum.enumValues),
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

// DTO 타입 추론
export type CreateIntentDto = z.infer<typeof CreateIntentSchema>;
export type ProcessIntentDto = z.infer<typeof ProcessIntentSchema>;
export type CreateHmsCardProfileDto = z.infer<
  typeof CreateHmsCardProfileSchema
>;

@Controller('v2/payments') // API 버전 명시
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly intentService: PaymentIntentService,
    private readonly profileService: PaymentProfileService,
  ) {}

  @Post('intents')
  @UsePipes(new ZodValidationPipe(CreateIntentSchema))
  async createPaymentIntent(@Body() dto: CreateIntentDto) {
    try {
      return await this.intentService.createIntent(dto);
    } catch (error) {
      throw new HttpException(
        'Failed to create payment intent',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('intents/:intentId/process')
  @UsePipes(new ZodValidationPipe(ProcessIntentSchema))
  async processPayment(
    @Param('intentId') intentId: string,
    @Body() dto: ProcessIntentDto,
  ) {
    try {
      return await this.paymentService.processPaymentByIntent(
        intentId,
        dto.providerType,
        {
          profileId: dto.profileId,
          instrumentRef: dto.instrumentRef,
        },
      );
    } catch (error) {
      // ✨ 서비스 계층에서 던진 도메인 에러를 HTTP 에러로 변환
      if (error instanceof PaymentError) {
        switch (error.code) {
          case 'POLICY_FORBIDDEN':
            throw new HttpException(error.message, HttpStatus.FORBIDDEN);
          case 'INTENT_EXPIRED':
          case 'INTENT_ALREADY_PROCESSED':
            throw new HttpException(error.message, HttpStatus.CONFLICT);
          case 'CHARGE_NOT_SUPPORTED':
          case 'HMS_MEMBER_ID_INVALID':
            throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
          default:
            throw new HttpException(
              error.message,
              HttpStatus.SERVICE_UNAVAILABLE,
            );
        }
      }
      // 그 외 알 수 없는 에러
      throw new HttpException(
        'An unexpected error occurred during payment processing.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('profiles/hms-card')
  @UsePipes(new ZodValidationPipe(CreateHmsCardProfileSchema))
  async createHmsCardProfile(@Body() dto: CreateHmsCardProfileDto) {
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
}
