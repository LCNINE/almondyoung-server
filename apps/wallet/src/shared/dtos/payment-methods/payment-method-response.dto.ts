// shared/dtos/payment-methods/payment-method-response.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 결제수단 응답 DTO
 */
export class PaymentMethodResponseDto {
  @ApiProperty({
    description: '결제수단 ID',
    example: 'pm_01HQZX8QJKMNPQRST9VWXY012',
  })
  id: string;

  @ApiProperty({ description: '사용자 ID', example: 'user_123456789' })
  userId: string;

  @ApiProperty({
    description: '결제수단 타입',
    enum: ['CARD', 'BANK_ACCOUNT', 'REWARD_POINT', 'BNPL'],
    example: 'CARD',
  })
  methodType: 'CARD' | 'BANK_ACCOUNT' | 'REWARD_POINT' | 'BNPL';

  @ApiProperty({ description: '결제수단 별칭', example: '주 사용 카드' })
  methodName: string;

  @ApiProperty({
    description: '결제수단 상태',
    enum: ['PENDING', 'ACTIVE', 'INACTIVE'],
    example: 'ACTIVE',
  })
  status: 'PENDING' | 'ACTIVE' | 'INACTIVE';

  @ApiProperty({ description: '기본 결제수단 여부', example: false })
  isDefault: boolean;

  @ApiPropertyOptional({
    description: '마스킹된 정보 (카드번호, 계좌번호 등)',
    example: '**** **** **** 1234',
  })
  maskedInfo?: string;

  @ApiProperty({ description: '등록일시', example: '2024-01-15T10:30:00Z' })
  createdAt: string;

  @ApiPropertyOptional({
    description: 'HMS Member ID (HMS CMS 카드인 경우)',
    example: 'HMS_123456789',
  })
  hmsMemberId?: string;

  @ApiPropertyOptional({
    description: 'BNPL 승인 대기 정보 (BNPL PENDING인 경우만)',
    type: 'object',
    properties: {
      approvalStatus: { type: 'string', example: 'REGISTERED' },
      estimatedApprovalDate: { type: 'string', example: '2024-01-18' },
      remainingDays: { type: 'number', example: 2 },
      nextSteps: {
        type: 'array',
        items: { type: 'string' },
        example: ['HMS 심사 진행 중'],
      },
    },
  })
  bnplDetails?: {
    approvalStatus: string;
    estimatedApprovalDate: string;
    remainingDays: number;
    nextSteps: string[];
  };
}

/**
 * 사용자 결제수단 목록 응답 DTO
 */
export class UserPaymentMethodsResponseDto {
  @ApiProperty({
    description: '사용 가능한 결제수단 목록',
    type: [PaymentMethodResponseDto],
  })
  usableMethods: PaymentMethodResponseDto[];

  @ApiProperty({
    description: '승인 대기 중인 결제수단 목록 (BNPL 등)',
    type: [PaymentMethodResponseDto],
  })
  pendingMethods: PaymentMethodResponseDto[];

  @ApiProperty({
    description: '요약 정보',
    type: 'object',
    properties: {
      totalCount: { type: 'number', example: 3 },
      activeCount: { type: 'number', example: 2 },
      pendingCount: { type: 'number', example: 1 },
      defaultMethodId: {
        type: 'string',
        example: 'pm_01HQZX8QJKMNPQRST9VWXY012',
      },
    },
  })
  summary: {
    totalCount: number;
    activeCount: number;
    pendingCount: number;
    defaultMethodId?: string;
  };
}

/**
 * 기본 결제수단 설정 DTO
 */
export class SetDefaultPaymentMethodDto {
  @ApiProperty({ description: '사용자 ID', example: 'user_123456789' })
  userId: string;
}
