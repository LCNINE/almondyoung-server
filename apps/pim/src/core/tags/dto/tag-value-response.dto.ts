import { ApiProperty } from '@nestjs/swagger';

export class TagValueResponseDto {
  @ApiProperty({ description: '태그 값 ID' })
  id: string;

  @ApiProperty({ description: '태그 그룹 ID' })
  groupId: string;

  @ApiProperty({ description: '태그 값 이름' })
  name: string;

  @ApiProperty({ description: '표시 순서', minimum: 0 })
  displayOrder: number;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiProperty({ description: '생성일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '수정일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  updatedAt: string;

  @ApiProperty({ description: '태그 그룹 이름', required: false })
  groupName?: string;
}

