import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  paymentAttemptOperationEnum,
  paymentAttemptStatusEnum,
  paymentIntentStatusEnum,
  paymentLegStatusEnum,
  paymentReferenceTypeEnum,
  refundRequestStatusEnum,
} from '../../schema';

export class PaymentIntentResponseDto {
  @ApiProperty({
    description: 'Intent identifier',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({
    description: 'Business reference type',
    enum: paymentReferenceTypeEnum.enumValues,
  })
  referenceType!: string;

  @ApiProperty({
    description: 'Business reference identifier',
  })
  referenceId!: string;

  @ApiProperty({
    description: 'User identifier',
  })
  userId!: string;

  @ApiProperty({
    description: 'ISO-4217 currency code',
    example: 'KRW',
  })
  currency!: string;

  @ApiProperty({
    description: 'Payable amount (minor units)',
    minimum: 0,
  })
  payableAmount!: number;

  @ApiProperty({
    description: 'Intent status',
    enum: paymentIntentStatusEnum.enumValues,
  })
  status!: string;

  @ApiProperty({
    description: 'Intent expiration time',
    format: 'date-time',
  })
  expiresAt!: string;

  @ApiProperty({
    description: 'Optimistic lock version',
    minimum: 0,
  })
  version!: number;

  @ApiProperty({
    description: 'Intent metadata',
    type: 'object',
    additionalProperties: true,
  })
  metadata!: Record<string, unknown>;

  @ApiProperty({
    description: 'Creation timestamp',
    format: 'date-time',
  })
  createdAt!: string;

  @ApiProperty({
    description: 'Last update timestamp',
    format: 'date-time',
  })
  updatedAt!: string;
}

export class PaymentLegResponseDto {
  @ApiProperty({
    description: 'Leg identifier',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({
    description: 'Parent intent identifier',
    format: 'uuid',
  })
  intentId!: string;

  @ApiProperty({
    description: 'Payment provider type',
    example: 'POINTS',
  })
  providerType!: string;

  @ApiProperty({
    description: 'Leg amount (minor units)',
    minimum: 1,
  })
  amount!: number;

  @ApiProperty({
    description: 'Leg status',
    enum: paymentLegStatusEnum.enumValues,
  })
  status!: string;

  @ApiProperty({
    description: 'Whether this leg is required',
  })
  isRequired!: boolean;

  @ApiProperty({
    description: 'Execution order',
    minimum: 1,
  })
  sequenceNo!: number;

  @ApiProperty({
    description: 'Optimistic lock version',
    minimum: 0,
  })
  version!: number;

  @ApiProperty({
    description: 'Leg metadata',
    type: 'object',
    additionalProperties: true,
  })
  metadata!: Record<string, unknown>;

  @ApiProperty({
    description: 'Creation timestamp',
    format: 'date-time',
  })
  createdAt!: string;

  @ApiProperty({
    description: 'Last update timestamp',
    format: 'date-time',
  })
  updatedAt!: string;
}

export class PaymentAttemptResponseDto {
  @ApiProperty({
    description: 'Attempt identifier',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({
    description: 'Parent intent identifier',
    format: 'uuid',
  })
  intentId!: string;

  @ApiProperty({
    description: 'Parent leg identifier',
    format: 'uuid',
  })
  legId!: string;

  @ApiProperty({
    description: 'Attempt sequence number per leg',
    minimum: 1,
  })
  attemptNo!: number;

  @ApiProperty({
    description: 'Attempt operation',
    enum: paymentAttemptOperationEnum.enumValues,
  })
  operation!: string;

  @ApiProperty({
    description: 'Attempt status',
    enum: paymentAttemptStatusEnum.enumValues,
  })
  status!: string;

  @ApiPropertyOptional({
    description: 'Provider transaction identifier',
    nullable: true,
  })
  providerTransactionId?: string | null;

  @ApiPropertyOptional({
    description: 'Provider request identifier',
    nullable: true,
  })
  providerRequestId?: string | null;

  @ApiPropertyOptional({
    description: 'Idempotency key from client request',
    nullable: true,
  })
  idempotencyKey?: string | null;

  @ApiProperty({
    description: 'Provider idempotency key',
  })
  providerIdempotencyKey!: string;

  @ApiPropertyOptional({
    description: 'Provider/business error code',
    nullable: true,
  })
  errorCode?: string | null;

  @ApiPropertyOptional({
    description: 'Provider/business error message',
    nullable: true,
  })
  errorMessage?: string | null;

  @ApiPropertyOptional({
    description: 'Provider request payload snapshot',
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  requestPayload?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    description: 'Provider response payload snapshot',
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  responsePayload?: Record<string, unknown> | null;

  @ApiProperty({
    description: 'Creation timestamp',
    format: 'date-time',
  })
  createdAt!: string;

  @ApiProperty({
    description: 'Last update timestamp',
    format: 'date-time',
  })
  updatedAt!: string;
}

export class LegOperationResultResponseDto {
  @ApiProperty({
    description: 'Updated intent',
    type: () => PaymentIntentResponseDto,
  })
  intent!: PaymentIntentResponseDto;

  @ApiProperty({
    description: 'Updated leg',
    type: () => PaymentLegResponseDto,
  })
  leg!: PaymentLegResponseDto;

  @ApiProperty({
    description: 'Operation attempt snapshot',
    type: () => PaymentAttemptResponseDto,
  })
  attempt!: PaymentAttemptResponseDto;
}

export class IntentTerminationResultResponseDto {
  @ApiProperty({
    description: 'Intent identifier',
    format: 'uuid',
  })
  intentId!: string;

  @ApiProperty({
    description: 'Resulting intent status',
    enum: paymentIntentStatusEnum.enumValues,
  })
  status!: string;
}

export class RefundRequestResponseDto {
  @ApiProperty({
    description: 'Refund request identifier',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({
    description: 'Parent intent identifier',
    format: 'uuid',
  })
  intentId!: string;

  @ApiProperty({
    description: 'Business reference type',
    enum: paymentReferenceTypeEnum.enumValues,
  })
  referenceType!: string;

  @ApiProperty({
    description: 'Business reference identifier',
  })
  referenceId!: string;

  @ApiProperty({
    description: 'Refund request status',
    enum: refundRequestStatusEnum.enumValues,
  })
  status!: string;

  @ApiProperty({
    description: 'Requested refund amount (minor units)',
    minimum: 1,
  })
  refundAmount!: number;

  @ApiProperty({
    description: 'ISO-4217 currency code',
    example: 'KRW',
  })
  currency!: string;

  @ApiProperty({
    description: 'Refund reason code',
  })
  reasonCode!: string;

  @ApiPropertyOptional({
    description: 'Refund reason message',
    nullable: true,
  })
  reasonMessage?: string | null;

  @ApiProperty({
    description: 'Requester identifier',
  })
  requestedBy!: string;

  @ApiPropertyOptional({
    description: 'Approver identifier',
    nullable: true,
  })
  approvedBy?: string | null;

  @ApiPropertyOptional({
    description: 'Rejector identifier',
    nullable: true,
  })
  rejectedBy?: string | null;

  @ApiProperty({
    description: 'Refund metadata',
    type: 'object',
    additionalProperties: true,
  })
  metadata!: Record<string, unknown>;

  @ApiProperty({
    description: 'Creation timestamp',
    format: 'date-time',
  })
  createdAt!: string;

  @ApiProperty({
    description: 'Last update timestamp',
    format: 'date-time',
  })
  updatedAt!: string;
}

export class RefundAllocationResponseDto {
  @ApiProperty({
    description: 'Allocation identifier',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({
    description: 'Parent refund request identifier',
    format: 'uuid',
  })
  refundRequestId!: string;

  @ApiProperty({
    description: 'Parent intent identifier',
    format: 'uuid',
  })
  intentId!: string;

  @ApiProperty({
    description: 'Leg identifier',
    format: 'uuid',
  })
  legId!: string;

  @ApiProperty({
    description: 'Allocated amount (minor units)',
    minimum: 1,
  })
  amount!: number;

  @ApiProperty({
    description: 'Creation timestamp',
    format: 'date-time',
  })
  createdAt!: string;
}

export class RefundRequestDetailResponseDto {
  @ApiProperty({
    description: 'Refund request detail',
    type: () => RefundRequestResponseDto,
  })
  refundRequest!: RefundRequestResponseDto;

  @ApiProperty({
    description: 'Refund allocation list',
    type: () => [RefundAllocationResponseDto],
  })
  allocations!: RefundAllocationResponseDto[];
}
