import { ApiProperty } from '@nestjs/swagger';

export class SkuGroupDto {
  @ApiProperty({
    description: 'Group ID',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  id: string;

  @ApiProperty({
    description: '그룹명 (Group name)',
    example: 'Eyelash Extensions - J Curl Collection'
  })
  name: string;

  @ApiProperty({
    description: '그룹 코드 (Group code)',
    example: 'GROUP-EYELASH-EXTENSIONS-J-CURL-20251027-ABC1'
  })
  code: string;

  @ApiProperty({
    description: '설명 (Description)',
    example: 'All J-curl lash combinations',
    nullable: true
  })
  description: string | null;

  @ApiProperty({
    description: '생성일시 (Created at)',
    example: '2025-10-27T10:30:00.000Z'
  })
  createdAt: Date;

  @ApiProperty({
    description: '수정일시 (Updated at)',
    example: '2025-10-27T10:30:00.000Z'
  })
  updatedAt: Date;
}

export class SkuGroupResponseDto extends SkuGroupDto {
  @ApiProperty({
    description: '그룹 멤버 수 (Number of SKUs in this group)',
    example: 24,
    minimum: 0
  })
  memberCount: number;
}

export class SkuGroupMemberDto {
  @ApiProperty({
    description: 'SKU ID',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  id: string;

  @ApiProperty({
    description: 'SKU 이름 (SKU name)',
    example: 'J-Curl Lash 0.15mm 10mm'
  })
  name: string;

  @ApiProperty({
    description: 'SKU 코드 (SKU code)',
    example: 'LASH-J-015-10'
  })
  code: string;

  @ApiProperty({
    description: '기본 바코드 (Default barcode)',
    example: '1234567890123',
    nullable: true
  })
  defaultBarcode: string | null;

  @ApiProperty({
    description: '안전 재고 (Safety stock)',
    example: 50,
    minimum: 0
  })
  safetyStock: number;

  @ApiProperty({
    description: '주 보관 위치 ID (Primary location ID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
    nullable: true
  })
  primaryLocationId: string | null;
}

export class SkuGroupMembersResponseDto {
  @ApiProperty({
    description: 'Group ID',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  groupId: string;

  @ApiProperty({
    description: 'Group name',
    example: 'Eyelash Extensions - J Curl Collection'
  })
  groupName: string;

  @ApiProperty({
    description: 'Total number of members',
    example: 24,
    minimum: 0
  })
  totalMembers: number;

  @ApiProperty({
    description: 'SKU members',
    type: [SkuGroupMemberDto]
  })
  members: SkuGroupMemberDto[];
}

export class BulkAddResultItemDto {
  @ApiProperty({
    description: 'SKU ID',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  skuId: string;

  @ApiProperty({
    description: 'Operation success',
    example: true
  })
  success: boolean;

  @ApiProperty({
    description: 'Error message (if failed)',
    example: 'SKU not found',
    required: false
  })
  error?: string;
}

export class BulkAddSkusResponseDto {
  @ApiProperty({
    description: 'Overall operation success (true if at least one succeeded)',
    example: true
  })
  success: boolean;

  @ApiProperty({
    description: 'Total number of SKUs in request',
    example: 10,
    minimum: 0
  })
  totalCount: number;

  @ApiProperty({
    description: 'Number of successfully added SKUs',
    example: 8,
    minimum: 0
  })
  successCount: number;

  @ApiProperty({
    description: 'Number of failed additions',
    example: 2,
    minimum: 0
  })
  failedCount: number;

  @ApiProperty({
    description: 'Detailed results for each SKU',
    type: [BulkAddResultItemDto]
  })
  results: BulkAddResultItemDto[];
}

