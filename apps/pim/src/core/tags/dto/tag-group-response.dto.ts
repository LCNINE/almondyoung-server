import { ApiProperty } from '@nestjs/swagger';

export class TagGroupResponseDto {
  @ApiProperty({ description: '태그 그룹 ID' })
  id: string;

  @ApiProperty({ description: '태그 그룹 이름' })
  name: string;

  @ApiProperty({ description: '태그 그룹 설명', nullable: true })
  description: string | null;

  @ApiProperty({ description: '표시 순서', minimum: 0 })
  displayOrder: number;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;

  @ApiProperty({ description: '태그 값 개수', required: false, minimum: 0 })
  valuesCount?: number;
}

