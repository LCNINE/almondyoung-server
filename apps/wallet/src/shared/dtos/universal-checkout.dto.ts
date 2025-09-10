// shared/dtos/universal-checkout.dto.ts - v5 아키텍처 Universal Checkout DTO

import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsArray,
  IsObject,
  IsOptional,
  IsEnum,
} from 'class-validator';

/**
 * Universal Checkout Session 생성 요청 DTO
 * v5 아키텍처: intentId만 받아서 UI 렌더링 데이터 제공
 */
export class UniversalCheckoutSessionCreateDto {
  @ApiProperty({
    description: '연결할 Payment Intent ID',
    example: 'pi_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsString()
  @IsNotEmpty()
  intentId!: string;
}

/**
 * Intent 정보 (UI 렌더링용)
 */
export class IntentInfoDto {
  @ApiProperty({
    description: 'Intent ID',
    example: 'pi_01HQZX8QJKMNPQRST9VWXY012',
  })
  id!: string;

  @ApiProperty({
    description: '결제 금액',
    example: 50000,
  })
  amount!: number;

  @ApiProperty({
    description: '통화',
    example: 'KRW',
  })
  currency!: string;

  @ApiProperty({
    description: '주문명',
    example: '아몬드 스페셜 에디션',
  })
  orderName!: string;

  @ApiProperty({
    description: '허용된 결제 Provider 목록',
    example: ['TOSS', 'POINTS', 'BNPL'],
  })
  allowedProviders!: string[];
}

/**
 * Provider 설정 정보 (UI 렌더링용)
 */
export class ProviderConfigDto {
  @ApiProperty({
    description: '결제 흐름 타입',
    enum: ['REDIRECT', 'INLINE'],
    example: 'REDIRECT',
  })
  flow!: 'REDIRECT' | 'INLINE';

  @ApiProperty({
    description: 'Provider별 UI 설정값',
    example: {
      clientKey: 'test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq',
      available: 1500,
      limit: 100000,
    },
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, any>;
}

/**
 * Universal Checkout Session 응답 DTO
 * v5 아키텍처: 공용 UI 렌더링에 필요한 모든 데이터 포함
 */
export class UniversalCheckoutSessionResponseDto {
  @ApiProperty({
    description: 'CheckoutSession ID',
    example: 'cs_01HQZX8QJKMNPQRST9VWXY012',
  })
  sessionId!: string;

  @ApiProperty({
    description: 'Intent 정보',
    type: IntentInfoDto,
  })
  intent!: IntentInfoDto;

  @ApiProperty({
    description: 'Provider별 설정 정보',
    example: {
      TOSS: { flow: 'REDIRECT', config: { clientKey: 'test_ck_...' } },
      POINTS: { flow: 'INLINE', config: { available: 1500 } },
      BNPL: { flow: 'INLINE', config: { limit: 100000 } },
    },
  })
  providers!: Record<string, ProviderConfigDto>;

  @ApiProperty({
    description: '세션 생성 시간',
    example: '2024-01-15T10:00:00Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: '세션 만료 시간',
    example: '2024-01-15T10:30:00Z',
  })
  expiresAt!: string;
}

/**
 * 공용 Finalize 요청 DTO
 * v5 아키텍처: 모든 PG사의 최종 승인을 처리하는 단일 API
 */
export class UniversalFinalizeDto {
  @ApiProperty({
    description: '사용한 결제 Provider',
    example: 'TOSS',
  })
  @IsString()
  @IsNotEmpty()
  provider!: string;

  @ApiProperty({
    description: 'Provider별 승인 키 (토스의 paymentKey 등)',
    example: 'toss_paymentKey_xxxxxx',
  })
  @IsString()
  @IsNotEmpty()
  instrumentRef!: string;

  @ApiProperty({
    description: '결제 금액 (검증용)',
    example: 50000,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiProperty({
    description: 'Provider별 추가 데이터',
    example: {
      orderId: 'pi_01HQZX8QJKMNPQRST9VWXY012',
      method: 'CARD',
    },
    required: false,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/**
 * 공용 Finalize 응답 DTO
 */
export class UniversalFinalizeResponseDto {
  @ApiProperty({
    description: '결제 성공 여부',
    example: true,
  })
  success!: boolean;

  @ApiProperty({
    description: 'Intent ID',
    example: 'pi_01HQZX8QJKMNPQRST9VWXY012',
  })
  intentId!: string;

  @ApiProperty({
    description: 'Attempt ID',
    example: 'pa_01HQZX8QJKMNPQRST9VWXY012',
  })
  attemptId!: string;

  @ApiProperty({
    description: '결제 금액',
    example: 50000,
  })
  amount!: number;

  @ApiProperty({
    description: '결제 상태',
    example: 'CAPTURED',
  })
  status!: string;

  @ApiProperty({
    description: '사용된 Provider',
    example: 'TOSS',
  })
  provider!: string;

  @ApiProperty({
    description: '처리 시간',
    example: '2024-01-15T10:05:00Z',
  })
  processedAt!: string;

  @ApiProperty({
    description: '실패 시 오류 메시지',
    example: '결제 승인에 실패했습니다.',
    required: false,
  })
  errorMessage?: string;
}
