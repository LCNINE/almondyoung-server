import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LocationType, SystemLocationRole } from '../types';


export class BaseLocationResponseDto {
  @ApiProperty({ description: '로케이션 ID' })
  id: string;

  @ApiProperty({ description: '창고 ID' })
  warehouseId: string;

  @ApiProperty({ description: '로케이션 코드', example: 'A-01-01' })
  code: string;

  @ApiProperty({
    description: '로케이션 타입',
    enum: ['standard', 'zone'],
    example: 'standard'
  })
  locationType: LocationType;

  @ApiProperty({ description: '표시명', example: 'A-01-01' })
  displayName: string;

  @ApiProperty({ description: '로케이션 용량 제한', nullable: true })
  capacityLimit: number | null;

  @ApiProperty({ description: 'FIFO 순위 (낮을수록 먼저 출고)', nullable: true })
  fifoRank: number | null;

  @ApiProperty({ description: '유통기한별 분리 보관 여부' })
  isExpirySeparated: boolean;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiProperty({ description: '운영 메모', nullable: true })
  notes: string | null;

  @ApiProperty({ description: '시스템 로케이션 여부' })
  isSystem: boolean;

  @ApiProperty({ description: '시스템 로케이션 역할', nullable: true })
  systemRole: SystemLocationRole | null;

  @ApiProperty({ description: '생성일시' })
  createdAt: string;

  @ApiProperty({ description: '수정일시' })
  updatedAt: string;
}

export class StandardLocationResponseDto extends BaseLocationResponseDto {
  @ApiProperty({ description: '로케이션 타입', enum: ['standard'] })
  override readonly locationType: 'standard' = 'standard';

  @ApiProperty({ description: '랙 ID' })
  rackId: string;

  @ApiProperty({ description: '빈 식별자', example: '01' })
  binIdentifier: string;

  @ApiPropertyOptional({ description: '열 이름', example: 'A' })
  columnName?: string;

  @ApiPropertyOptional({ description: '랙 번호', example: 1 })
  rackNumber?: number;
}

export class ZoneLocationResponseDto extends BaseLocationResponseDto {
  @ApiProperty({ description: '로케이션 타입', enum: ['zone'] })
  override readonly locationType: 'zone' = 'zone';

  @ApiProperty({ description: '랙 ID는 항상 null', nullable: true })
  rackId: string | null;

  @ApiProperty({ description: '빈 식별자는 항상 null', nullable: true })
  binIdentifier: string | null;
}

export class LocationColumnResponseDto {
  @ApiProperty({ description: '열 ID' })
  id: string;

  @ApiProperty({ description: '창고 ID' })
  warehouseId: string;

  @ApiProperty({ description: '열 이름', example: 'A' })
  columnName: string;

  @ApiProperty({ description: '정렬 순서', nullable: true })
  displayOrder: number | null;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiProperty({ description: '생성일시' })
  createdAt: string;

  @ApiProperty({ description: '수정일시' })
  updatedAt: string;
}

export class LocationRackResponseDto {
  @ApiProperty({ description: '랙 ID' })
  id: string;

  @ApiProperty({ description: '열 ID' })
  columnId: string;

  @ApiProperty({ description: '열', type: LocationColumnResponseDto })
  column: LocationColumnResponseDto

  @ApiProperty({ description: '랙 번호', example: 1 })
  rackNumber: number;

  @ApiProperty({ description: '기본 빈 시작 번호', example: 1 })
  defaultBinStart: number;

  @ApiProperty({ description: '기본 빈 끝 번호', example: 20 })
  defaultBinEnd: number;

  @ApiProperty({ description: '빈 자동 생성 여부' })
  autoGenerateBins: boolean;

  @ApiProperty({ description: '물리적 너비', nullable: true })
  physicalWidth: number | null;

  @ApiProperty({ description: '물리적 높이', nullable: true })
  physicalHeight: number | null;

  @ApiProperty({ description: '메모', nullable: true })
  notes: string | null;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiProperty({ description: '생성일시' })
  createdAt: string;

  @ApiProperty({ description: '수정일시' })
  updatedAt: string;
}

export class LocationListResponseDto {
  @ApiProperty({
    description: '로케이션 목록',
    type: [BaseLocationResponseDto]
  })
  items: BaseLocationResponseDto[];

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