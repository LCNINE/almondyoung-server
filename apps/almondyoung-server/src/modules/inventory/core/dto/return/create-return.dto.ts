import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, IsOptional, IsArray, ValidateNested, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateReturnItemDto {
  @ApiProperty({
    description: 'SKU ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  skuId: string;

  @ApiProperty({
    description: '반품 요청 수량',
    example: 5,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  requestedQuantity: number;
}

export class CreateReturnDto {
  @ApiProperty({
    description: '주문 ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiProperty({
    description: '출하 ID',
    example: '550e8400-e29b-41d4-a716-446655440002',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  shipmentId?: string;

  @ApiProperty({
    description: '창고 ID',
    example: '550e8400-e29b-41d4-a716-446655440003',
  })
  @IsString()
  warehouseId: string;

  @ApiProperty({
    description: '반품 사유',
    example: 'Customer changed mind',
  })
  @IsString()
  returnReason: string;

  @ApiProperty({
    description: '반품 아이템 목록',
    type: [CreateReturnItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateReturnItemDto)
  items: CreateReturnItemDto[];
}

export class ReceiveReturnItemDto {
  @ApiProperty({
    description: '반품 아이템 ID',
    example: '550e8400-e29b-41d4-a716-446655440010',
  })
  @IsString()
  returnItemId: string;

  @ApiProperty({
    description: '실제 입고 수량',
    example: 5,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  receivedQuantity: number;

  @ApiProperty({
    description: '입고 위치 ID (선택적, 미지정시 return_default)',
    example: '550e8400-e29b-41d4-a716-446655440020',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  locationId?: string;
}

export class ReceiveReturnDto {
  @ApiProperty({
    description: '반품 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  returnId: string;

  @ApiProperty({
    description: '입고 아이템 목록',
    type: [ReceiveReturnItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveReturnItemDto)
  items: ReceiveReturnItemDto[];
}

export class InspectReturnItemDto {
  @ApiProperty({
    description: '반품 아이템 ID',
    example: '550e8400-e29b-41d4-a716-446655440010',
  })
  @IsString()
  returnItemId: string;

  @ApiProperty({
    description: 'QC 검사 결과',
    enum: ['passed', 'failed'],
    example: 'passed',
  })
  @IsEnum(['passed', 'failed'])
  qcStatus: 'passed' | 'failed';

  @ApiProperty({
    description: 'QC 검사 통과 수량',
    example: 4,
    minimum: 0,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  qcPassedQuantity?: number;

  @ApiProperty({
    description: 'QC 검사 실패 수량',
    example: 1,
    minimum: 0,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  qcFailedQuantity?: number;

  @ApiProperty({
    description: 'QC 결과 사유',
    example: 'Minor damage on packaging',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  qcReason?: string;
}

export class InspectReturnDto {
  @ApiProperty({
    description: '반품 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  returnId: string;

  @ApiProperty({
    description: '검사자 이름',
    example: 'John Doe',
  })
  @IsString()
  inspectedBy: string;

  @ApiProperty({
    description: '검사 아이템 목록',
    type: [InspectReturnItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InspectReturnItemDto)
  items: InspectReturnItemDto[];

  @ApiProperty({
    description: 'QC 검사 노트',
    example: 'Overall condition is acceptable',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  qcNotes?: string;
}

export class ProcessReturnItemDto {
  @ApiProperty({
    description: '반품 아이템 ID',
    example: '550e8400-e29b-41d4-a716-446655440010',
  })
  @IsString()
  returnItemId: string;

  @ApiProperty({
    description: '처리 액션',
    enum: ['restock', 'dispose'],
    example: 'restock',
  })
  @IsEnum(['restock', 'dispose'])
  action: 'restock' | 'dispose';

  @ApiProperty({
    description: '처리 수량',
    example: 5,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({
    description: '재입고 목표 위치 ID (restock 시 필수)',
    example: '550e8400-e29b-41d4-a716-446655440030',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  targetLocationId?: string;

  @ApiProperty({
    description: '처리 사유',
    example: 'QC passed - ready for resale',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ProcessReturnDto {
  @ApiProperty({
    description: '반품 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  returnId: string;

  @ApiProperty({
    description: '처리 아이템 목록',
    type: [ProcessReturnItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcessReturnItemDto)
  items: ProcessReturnItemDto[];
}
