import { ApiProperty } from '@nestjs/swagger';

export class ProductTagDto {
  @ApiProperty({ description: '태그 값 ID' })
  id: string;

  @ApiProperty({ description: '태그 값 이름' })
  name: string;

  @ApiProperty({ description: '태그 그룹 ID' })
  groupId: string;

  @ApiProperty({ description: '태그 그룹 이름' })
  groupName: string;

  @ApiProperty({ description: '표시 순서', minimum: 0 })
  displayOrder: number;
}

