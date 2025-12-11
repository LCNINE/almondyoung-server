import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LocationType } from '../types';

export class LocationMetadataDto {
  @ApiPropertyOptional({ description: '로케이션 용량 제한' })
  capacityLimit?: number;

  @ApiPropertyOptional({ description: 'FIFO 순위 (낮을수록 먼저 출고)' })
  fifoRank?: number;

  @ApiPropertyOptional({ description: '유통기한별 분리 보관 여부' })
  isExpirySeparated?: boolean;

  @ApiPropertyOptional({ description: '운영 메모' })
  notes?: string;
}

export class LocationResponseDto {
  @ApiProperty({ description: '로케이션 ID' })
  id: string;

  @ApiProperty({ description: '로케이션 코드', example: 'A-01-01' })
  code: string;

  @ApiProperty({ description: '표시명', example: 'A-01-01' })
  displayName: string;

  @ApiProperty({
    description: '로케이션 타입',
    enum: ['standard', 'zone'],
    example: 'standard'
  })
  type: LocationType;

  @ApiProperty({ description: '창고 ID' })
  warehouseId: string;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiPropertyOptional({ description: '메타데이터' })
  metadata?: LocationMetadataDto;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;
}

export class StandardLocationResponseDto extends LocationResponseDto {
  @ApiProperty({ description: '로케이션 타입', enum: ['standard'] })
  override readonly type: 'standard' = 'standard';

  @ApiProperty({ description: '랙 ID' })
  rackId: string;

  @ApiProperty({ description: '빈 식별자', example: '01' })
  binIdentifier: string;

  @ApiPropertyOptional({ description: '열 이름', example: 'A' })
  columnName?: string;

  @ApiPropertyOptional({ description: '랙 번호', example: 1 })
  rackNumber?: number;
}

export class ZoneLocationResponseDto extends LocationResponseDto {
  @ApiProperty({ description: '로케이션 타입', enum: ['zone'] })
  override readonly type: 'zone' = 'zone';

  @ApiProperty({ description: '랙 ID는 항상 null', nullable: true })
  rackId: string;

  @ApiProperty({ description: '빈 식별자는 항상 null', nullable: true })
  binIdentifier: string;
}

export class LocationColumnResponseDto {
  @ApiProperty({ description: '열 ID' })
  id: string;

  @ApiProperty({ description: '창고 ID' })
  warehouseId: string;

  @ApiProperty({ description: '열 이름', example: 'A' })
  columnName: string;

  @ApiPropertyOptional({ description: '정렬 순서' })
  displayOrder?: number;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;
}

export class LocationRackResponseDto {
  @ApiProperty({ description: '랙 ID' })
  id: string;

  @ApiProperty({ description: '열 ID' })
  columnId: string;

  @ApiProperty({ description: '랙 번호', example: 1 })
  rackNumber: number;

  @ApiProperty({ description: '기본 빈 시작 번호', example: 1 })
  defaultBinStart: number;

  @ApiProperty({ description: '기본 빈 끝 번호', example: 20 })
  defaultBinEnd: number;

  @ApiProperty({ description: '빈 자동 생성 여부' })
  autoGenerateBins: boolean;

  @ApiPropertyOptional({ description: '물리적 너비' })
  physicalWidth?: number;

  @ApiPropertyOptional({ description: '물리적 높이' })
  physicalHeight?: number;

  @ApiPropertyOptional({ description: '메모' })
  notes?: string;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;
}

export class LocationListResponseDto {
  @ApiProperty({
    description: '로케이션 목록',
    type: [LocationResponseDto]
  })
  items: LocationResponseDto[];

  @ApiProperty({ description: '총 항목 수' })
  total: number;

  @ApiProperty({ description: '현재 페이지' })
  page: number;

  @ApiProperty({ description: '페이지당 항목 수' })
  limit: number;

  @ApiProperty({ description: '총 페이지 수' })
  totalPages: number;

  @ApiProperty({ description: '다음 페이지 존재 여부' })
  hasNext: boolean;

  @ApiProperty({ description: '이전 페이지 존재 여부' })
  hasPrev: boolean;
}