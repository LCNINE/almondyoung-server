// src/payment/dto/process-payment.dto.ts (리팩토링된 단순화 버전)

import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsNumber,
  IsEnum,
  IsOptional,
  Min,
  ValidateIf,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

// ═══════════════════════════════════════════
// 🔧 커스텀 검증 데코레이터
// ═══════════════════════════════════════════

/**
 * 결제 방식이 하나는 반드시 선택되었는지 검증하는 데코레이터
 */
function IsPaymentMethodSelected(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isPaymentMethodSelected',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          const obj = args.object as AuthorizePaymentDto;

          // 3가지 결제 방식 중 하나는 반드시 있어야 함
          const hasPaymentMethodId = !!obj.paymentMethodId;
          const hasPointAmount = !!obj.pointAmount && obj.pointAmount > 0;
          const hasPaymentMethods = !!obj.paymentMethods && obj.paymentMethods.length > 0;

          return hasPaymentMethodId || hasPointAmount || hasPaymentMethods;
        },
        defaultMessage(args: ValidationArguments) {
          return '결제수단을 선택해주세요. paymentMethodId, pointAmount, 또는 paymentMethods 중 하나를 지정하세요.';
        },
      },
    });
  };
}

/**
 * 여러 결제 방식이 동시에 선택되지 않았는지 검증하는 데코레이터
 */
function IsOnlyOnePaymentMethod(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isOnlyOnePaymentMethod',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          const obj = args.object as AuthorizePaymentDto;

          const methodCount = [
            !!obj.paymentMethodId,
            !!obj.pointAmount,
            !!obj.paymentMethods?.length
          ].filter(Boolean).length;

          return methodCount <= 1;
        },
        defaultMessage(args: ValidationArguments) {
          return '하나의 결제 방식만 선택할 수 있습니다. paymentMethodId, pointAmount, paymentMethods 중 하나만 사용하세요.';
        },
      },
    });
  };
}

// ═══════════════════════════════════════════
// 🎯 새로운 단순화된 DTO (스키마 기반)
// ═══════════════════════════════════════════

// 스키마의 paymentMethod.methodType과 일치하는 타입
export type PaymentMethodType = 'BNPL' | 'CARD' | 'BANK_ACCOUNT' | 'REWARD_POINT';

// 혼합 결제용 개별 결제수단 DTO
export class PaymentMethodDto {
  @IsEnum(['BNPL', 'CARD', 'BANK_ACCOUNT', 'REWARD_POINT'])
  @IsNotEmpty()
  type: PaymentMethodType;

  // BNPL, CARD, BANK_ACCOUNT의 경우 필수
  @ValidateIf((o) => ['BNPL', 'CARD', 'BANK_ACCOUNT'].includes(o.type))
  @IsString()
  @IsNotEmpty()
  paymentMethodId?: string;

  // REWARD_POINT나 부분 결제의 경우 필수
  @ValidateIf((o) => o.type === 'REWARD_POINT' || o.paymentMethodId === undefined)
  @IsNumber()
  @Min(1)
  amount?: number;
}

// ═══════════════════════════════════════════
// 🚀 새로운 단순화된 결제 승인 DTO
// ═══════════════════════════════════════════

export class AuthorizePaymentDto {
  @IsString()
  @IsNotEmpty()
  paymentSessionId: string;

  // ─────────────────────────────────────────
  // 3가지 결제 방식 중 하나만 사용
  // ─────────────────────────────────────────

  // 1️⃣ 단일 결제수단 (BNPL, 카드 등) - 90% 케이스
  @IsString()
  @IsOptional()
  @IsPaymentMethodSelected()
  @IsOnlyOnePaymentMethod()
  paymentMethodId?: string;

  // 2️⃣ 포인트 전용 결제 - 간단한 케이스
  @IsNumber()
  @IsOptional()
  @Min(1)
  pointAmount?: number;

  // 3️⃣ 혼합 결제 - 고급 사용자용
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentMethodDto)
  @IsOptional()
  paymentMethods?: PaymentMethodDto[];
}

// ═══════════════════════════════════════════
// 🔄 기존 DTO (하위 호환성용 - Deprecated)
// ═══════════════════════════════════════════

// @deprecated 새로운 AuthorizePaymentDto 사용 권장
export class PaymentDetailDto {
  @IsEnum(['BNPL', 'REWARD_POINT', 'CARD', 'TOSS_PAY', 'KAKAO_PAY', 'NAVER_PAY'])
  @IsNotEmpty()
  methodType: 'BNPL' | 'REWARD_POINT' | 'CARD' | 'TOSS_PAY' | 'KAKAO_PAY' | 'NAVER_PAY';

  @IsNumber()
  amount: number;

  @IsString()
  @IsOptional()
  paymentMethodId?: string;
}

// ═══════════════════════════════════════════
// 🔄 기존 DTO (하위 호환성용 - Deprecated)
// ═══════════════════════════════════════════

// @deprecated 새로운 AuthorizePaymentDto 사용 권장
export class ProcessPaymentDto {
  @IsString()
  @IsNotEmpty()
  paymentSessionId: string;

  @IsString()
  @IsNotEmpty()
  paymentLockId: string; // 결제 잠금 ID 필수 추가

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentDetailDto)
  payments: PaymentDetailDto[]; // ✅ 결제 정보를 배열로 받음

  // 하위 호환성을 위한 기존 필드 (deprecated)
  @IsString()
  @IsOptional()
  paymentMethodId?: string; // 기존 단일 결제 지원
}

// ═══════════════════════════════════════════
// 🎯 단순화된 결제 캡처 DTO
// ═══════════════════════════════════════════

export class CapturePaymentDto {
  @IsString()
  @IsNotEmpty()
  paymentEventId: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  amount?: number; // 부분 캡처 지원

  @IsString()
  @IsOptional()
  pgTransactionId?: string;
}
