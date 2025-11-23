import { ApiProperty } from '@nestjs/swagger';

export class TagValueItemDto {
  @ApiProperty({ description: '태그 값 ID' })
  id: string;

  @ApiProperty({ description: '태그 값 이름' })
  name: string;

  @ApiProperty({ description: '표시 순서', minimum: 0 })
  displayOrder: number;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;
}

