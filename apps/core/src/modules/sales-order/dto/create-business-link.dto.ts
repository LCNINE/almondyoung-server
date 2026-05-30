import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

export class BusinessLinkReferenceDto {
  @ApiProperty({ description: '도메인 엔티티 타입. 예: sales_order, sales_order_amendment, wallet_refund' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({ description: 'Core 내부 UUID. 외부 도메인 대상이면 생략 가능', required: false })
  @IsUUID()
  @IsOptional()
  id?: string;

  @ApiProperty({ description: '외부 서비스의 안정 참조값. 예: wallet:refund:rf_123', required: false })
  @IsString()
  @IsOptional()
  externalRef?: string;
}

export class CreateBusinessLinkDto {
  @ApiProperty({
    description: '관계명. 예: caused_refund, caused_fulfillment_adjustment, opened_amendment',
  })
  @IsString()
  @IsNotEmpty()
  relationName: string;

  @ApiProperty({
    description: '원인 쪽 참조. 생략하면 현재 SalesOrder가 source가 된다.',
    type: BusinessLinkReferenceDto,
    required: false,
  })
  @ValidateNested()
  @Type(() => BusinessLinkReferenceDto)
  @IsOptional()
  source?: BusinessLinkReferenceDto;

  @ApiProperty({ description: '결과/대상 쪽 참조', type: BusinessLinkReferenceDto })
  @ValidateNested()
  @Type(() => BusinessLinkReferenceDto)
  target: BusinessLinkReferenceDto;

  @ApiProperty({ description: '업무 사건 발생 시각', required: false, type: String, format: 'date-time' })
  @IsDateString()
  @IsOptional()
  occurredAt?: string;

  @ApiProperty({ description: '표시/추적용 부가 정보', required: false })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
