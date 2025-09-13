// shared/dtos/point.dto.ts - 포인트 시스템 DTO (Supabase 구조 기반)

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsPositive,
  IsOptional,
  IsEnum,
  IsDateString,
  IsObject,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';

// ================================================================
// 포인트 이벤트 타입 정의
// ================================================================

export enum PointEventType {
  EARN = 'EARN', // 포인트 적립
  REDEEM = 'REDEEM', // 포인트 사용
  CANCEL = 'CANCEL', // 적립/사용 취소
  EXPIRE = 'EXPIRE', // 포인트 만료
  REFUND = 'REFUND', // 환불로 인한 복원
}

export enum ReferralRewardType {
  SIGNUP = 'SIGNUP', // 회원가입 추천
  FIRST_PURCHASE = 'FIRST_PURCHASE', // 첫 구매 추천
  RECURRING_PURCHASE = 'RECURRING_PURCHASE', // 정기구매 추천
}

export enum ReferralRewardStatus {
  PENDING = 'PENDING', // 대기 중
  COMPLETED = 'COMPLETED', // 완료
  FAILED = 'FAILED', // 실패
}

// ================================================================
// 포인트 적립 관련 DTO
// ================================================================

export class PointEarnRequestDto {
  @ApiProperty({
    description: '사용자 ID',
    example: 'user_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsString()
  userId!: string;

  @ApiProperty({
    description: '적립할 포인트 금액',
    example: 1000,
    minimum: 1,
    maximum: 1000000,
  })
  @IsNumber()
  @IsPositive()
  @Min(1)
  @Max(1000000)
  amount!: number;

  @ApiProperty({
    description: '적립 사유',
    example: '주문 완료 적립',
  })
  @IsString()
  reason!: string;

  @ApiPropertyOptional({
    description: '포인트 만료 시점 (ISO 8601)',
    example: '2025-01-08T15:30:00Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({
    description: '출금 가능 시점 (ISO 8601)',
    example: '2024-01-15T15:30:00Z',
  })
  @IsOptional()
  @IsDateString()
  withdrawalAvailableAt?: string;

  @ApiPropertyOptional({
    description: '추천인 사용자 ID (추천 보상인 경우)',
    example: 'user_01HQZX8QJKMNPQRST9VWXY999',
  })
  @IsOptional()
  @IsString()
  referralUserId?: string;

  @ApiPropertyOptional({
    description: '추천 타입 (추천 보상인 경우)',
    enum: ReferralRewardType,
    example: ReferralRewardType.SIGNUP,
  })
  @IsOptional()
  @IsEnum(ReferralRewardType)
  referralType?: ReferralRewardType;

  @ApiPropertyOptional({
    description: '부가 정보 (주문 ID, 캠페인 정보 등)',
    example: {
      orderId: 'order_123',
      campaignId: 'welcome_bonus',
      source: 'purchase_reward',
    },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class PointEarnResponseDto {
  @ApiProperty({
    description: '포인트 이벤트 ID',
    example: 'pe_01HQZX8QJKMNPQRST9VWXY012',
  })
  eventId!: string;

  @ApiProperty({
    description: '포인트 이벤트 상세 ID',
    example: 'ped_01HQZX8QJKMNPQRST9VWXY012',
  })
  eventDetailId!: string;

  @ApiProperty({
    description: '적립된 포인트 금액',
    example: 1000,
  })
  amount!: number;

  @ApiProperty({
    description: '적립 후 총 잔액',
    example: 5000,
  })
  newBalance!: number;

  @ApiProperty({
    description: '적립 일시',
    example: '2024-01-08T10:30:00Z',
  })
  earnedAt!: string;

  @ApiPropertyOptional({
    description: '포인트 만료 시점',
    example: '2025-01-08T15:30:00Z',
  })
  expiresAt?: string;

  @ApiPropertyOptional({
    description: '출금 가능 시점',
    example: '2024-01-15T15:30:00Z',
  })
  withdrawalAvailableAt?: string;
}

// ================================================================
// 포인트 사용 관련 DTO
// ================================================================

export class PointRedeemRequestDto {
  @ApiProperty({
    description: '사용자 ID',
    example: 'user_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsString()
  userId!: string;

  @ApiProperty({
    description: '사용할 포인트 금액',
    example: 500,
    minimum: 1,
    maximum: 1000000,
  })
  @IsNumber()
  @IsPositive()
  @Min(1)
  @Max(1000000)
  amount!: number;

  @ApiProperty({
    description: '사용 사유',
    example: '주문 결제 사용',
  })
  @IsString()
  reason!: string;

  @ApiPropertyOptional({
    description: '부가 정보 (주문 ID, 결제 정보 등)',
    example: {
      orderId: 'order_456',
      paymentIntentId: 'pi_123',
    },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class PointRedeemResponseDto {
  @ApiProperty({
    description: '포인트 이벤트 ID',
    example: 'pe_01HQZX8QJKMNPQRST9VWXY012',
  })
  eventId!: string;

  @ApiProperty({
    description: '사용된 포인트 금액',
    example: 500,
  })
  amount!: number;

  @ApiProperty({
    description: '사용 후 총 잔액',
    example: 4500,
  })
  newBalance!: number;

  @ApiProperty({
    description: '사용 일시',
    example: '2024-01-08T10:35:00Z',
  })
  redeemedAt!: string;

  @ApiProperty({
    description: 'FIFO 차감 내역',
    type: [Object],
    example: [
      {
        eventDetailId: 'ped_01HQZX8QJKMNPQRST9VWXY001',
        earnedEventDetailId: 'ped_01HQZX8QJKMNPQRST9VWXY100',
        amount: -300,
        earnedAt: '2024-01-01T10:00:00Z',
      },
      {
        eventDetailId: 'ped_01HQZX8QJKMNPQRST9VWXY002',
        earnedEventDetailId: 'ped_01HQZX8QJKMNPQRST9VWXY101',
        amount: -200,
        earnedAt: '2024-01-02T10:00:00Z',
      },
    ],
  })
  fifoDetails!: Array<{
    eventDetailId: string;
    earnedEventDetailId: string;
    amount: number;
    earnedAt: string;
  }>;
}

// ================================================================
// 포인트 취소 관련 DTO
// ================================================================

export class PointCancelRequestDto {
  @ApiProperty({
    description: '취소할 원본 포인트 이벤트 ID',
    example: 'pe_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsString()
  originalEventId!: string;

  @ApiPropertyOptional({
    description: '부분 취소할 금액 (전액 취소시 생략)',
    example: 300,
    minimum: 1,
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Min(1)
  amount?: number;

  @ApiProperty({
    description: '취소 사유',
    example: '주문 취소로 인한 포인트 회수',
  })
  @IsString()
  reason!: string;

  @ApiPropertyOptional({
    description: '부가 정보',
    example: {
      cancelledOrderId: 'order_123',
      adminUserId: 'admin_001',
    },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class PointCancelResponseDto {
  @ApiProperty({
    description: '취소 이벤트 ID',
    example: 'pe_01HQZX8QJKMNPQRST9VWXY013',
  })
  eventId!: string;

  @ApiProperty({
    description: '취소된 포인트 금액',
    example: 300,
  })
  amount!: number;

  @ApiProperty({
    description: '취소 후 총 잔액',
    example: 4200,
  })
  newBalance!: number;

  @ApiProperty({
    description: '취소 일시',
    example: '2024-01-08T10:40:00Z',
  })
  cancelledAt!: string;

  @ApiProperty({
    description: '취소된 상세 내역',
    type: [Object],
    example: [
      {
        eventDetailId: 'ped_01HQZX8QJKMNPQRST9VWXY003',
        originalEventDetailId: 'ped_01HQZX8QJKMNPQRST9VWXY001',
        amount: -300,
      },
    ],
  })
  cancelDetails!: Array<{
    eventDetailId: string;
    originalEventDetailId: string;
    amount: number;
  }>;
}

// ================================================================
// 포인트 조회 관련 DTO
// ================================================================

export class PointBalanceResponseDto {
  @ApiProperty({
    description: '사용자 ID',
    example: 'user_01HQZX8QJKMNPQRST9VWXY012',
  })
  userId!: string;

  @ApiProperty({
    description: '총 포인트 잔액',
    example: 4200,
  })
  totalBalance!: number;

  @ApiProperty({
    description: '사용 가능한 포인트 (만료되지 않은)',
    example: 4000,
  })
  availableBalance!: number;

  @ApiProperty({
    description: '출금 가능한 포인트',
    example: 3500,
  })
  withdrawableBalance!: number;

  @ApiProperty({
    description: '만료 예정 포인트 (30일 이내)',
    example: 200,
  })
  expiringBalance!: number;

  @ApiProperty({
    description: '조회 일시',
    example: '2024-01-08T10:45:00Z',
  })
  queriedAt!: string;
}

export class PointHistoryQueryDto {
  @ApiProperty({
    description: '사용자 ID',
    example: 'user_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsString()
  userId!: string;

  @ApiPropertyOptional({
    description: '이벤트 타입 필터',
    enum: PointEventType,
    example: PointEventType.EARN,
  })
  @IsOptional()
  @IsEnum(PointEventType)
  eventType?: PointEventType;

  @ApiPropertyOptional({
    description: '시작 날짜 (ISO 8601)',
    example: '2024-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: '종료 날짜 (ISO 8601)',
    example: '2024-01-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: '페이지 번호 (1부터 시작)',
    example: 1,
    minimum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: '페이지당 항목 수',
    example: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class PointHistoryItemDto {
  @ApiProperty({
    description: '포인트 이벤트 ID',
    example: 'pe_01HQZX8QJKMNPQRST9VWXY012',
  })
  eventId!: string;

  @ApiProperty({
    description: '이벤트 타입',
    enum: PointEventType,
    example: PointEventType.EARN,
  })
  type!: PointEventType;

  @ApiProperty({
    description: '포인트 변동량',
    example: 1000,
  })
  amount!: number;

  @ApiProperty({
    description: '이벤트 발생 후 잔액',
    example: 5000,
  })
  balanceAfter!: number;

  @ApiProperty({
    description: '사유',
    example: '주문 완료 적립',
  })
  reason!: string;

  @ApiPropertyOptional({
    description: '만료 시점 (적립인 경우)',
    example: '2025-01-08T15:30:00Z',
  })
  expiresAt?: string;

  @ApiPropertyOptional({
    description: '출금 가능 시점 (적립인 경우)',
    example: '2024-01-15T15:30:00Z',
  })
  withdrawalAvailableAt?: string;

  @ApiProperty({
    description: '이벤트 발생 일시',
    example: '2024-01-08T10:30:00Z',
  })
  createdAt!: string;

  @ApiPropertyOptional({
    description: '부가 정보',
    example: {
      orderId: 'order_123',
      source: 'purchase_reward',
    },
  })
  metadata?: Record<string, any>;
}

export class PointHistoryResponseDto {
  @ApiProperty({
    description: '포인트 히스토리 목록',
    type: [PointHistoryItemDto],
  })
  items!: PointHistoryItemDto[];

  @ApiProperty({
    description: '총 항목 수',
    example: 150,
  })
  totalCount!: number;

  @ApiProperty({
    description: '현재 페이지',
    example: 1,
  })
  currentPage!: number;

  @ApiProperty({
    description: '페이지당 항목 수',
    example: 20,
  })
  pageSize!: number;

  @ApiProperty({
    description: '총 페이지 수',
    example: 8,
  })
  totalPages!: number;
}

// ================================================================
// 추천인 보상 관련 DTO
// ================================================================

export class ReferralRewardCreateDto {
  @ApiProperty({
    description: '추천한 사용자 ID',
    example: 'user_01HQZX8QJKMNPQRST9VWXY999',
  })
  @IsString()
  referrerId!: string;

  @ApiProperty({
    description: '추천받은 사용자 ID',
    example: 'user_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsString()
  referredUserId!: string;

  @ApiProperty({
    description: '보상 타입',
    enum: ReferralRewardType,
    example: ReferralRewardType.SIGNUP,
  })
  @IsEnum(ReferralRewardType)
  rewardType!: ReferralRewardType;

  @ApiProperty({
    description: '보상 포인트 금액',
    example: 1000,
    minimum: 1,
  })
  @IsNumber()
  @IsPositive()
  @Min(1)
  rewardAmount!: number;

  @ApiPropertyOptional({
    description: '외부 API 호출 여부',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  callExternalApi?: boolean = true;

  @ApiPropertyOptional({
    description: '부가 정보',
    example: {
      campaignId: 'referral_2024_q1',
      source: 'mobile_app',
    },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class ReferralRewardResponseDto {
  @ApiProperty({
    description: '추천 보상 ID',
    example: 'rr_01HQZX8QJKMNPQRST9VWXY012',
  })
  id!: string;

  @ApiProperty({
    description: '추천한 사용자 ID',
    example: 'user_01HQZX8QJKMNPQRST9VWXY999',
  })
  referrerId!: string;

  @ApiProperty({
    description: '추천받은 사용자 ID',
    example: 'user_01HQZX8QJKMNPQRST9VWXY012',
  })
  referredUserId!: string;

  @ApiProperty({
    description: '보상 타입',
    enum: ReferralRewardType,
    example: ReferralRewardType.SIGNUP,
  })
  rewardType!: ReferralRewardType;

  @ApiProperty({
    description: '보상 포인트 금액',
    example: 1000,
  })
  rewardAmount!: number;

  @ApiProperty({
    description: '처리 상태',
    enum: ReferralRewardStatus,
    example: ReferralRewardStatus.COMPLETED,
  })
  status!: ReferralRewardStatus;

  @ApiPropertyOptional({
    description: '연관된 포인트 이벤트 ID',
    example: 'pe_01HQZX8QJKMNPQRST9VWXY012',
  })
  pointEventId?: string;

  @ApiProperty({
    description: '외부 API 호출 여부',
    example: true,
  })
  externalApiCalled!: boolean;

  @ApiPropertyOptional({
    description: '외부 API 응답',
    example: {
      status: 'success',
      transactionId: 'ext_tx_123',
    },
  })
  externalApiResponse?: Record<string, any>;

  @ApiProperty({
    description: '생성 일시',
    example: '2024-01-08T10:30:00Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: '수정 일시',
    example: '2024-01-08T10:32:00Z',
  })
  updatedAt!: string;
}
