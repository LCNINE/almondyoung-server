import { ApiProperty } from '@nestjs/swagger';

export class CategoryPathInfoDto {
  @ApiProperty({ description: '카테고리 ID' })
  id: string;

  @ApiProperty({ description: '카테고리 이름' })
  name: string;

  @ApiProperty({ description: 'URL 슬러그' })
  slug: string;

  @ApiProperty({ description: '카테고리 레벨 (깊이)', minimum: 0 })
  level: number;
}

export class CategoryPathResponseDto {
  @ApiProperty({ description: '카테고리 ID' })
  categoryId: string;

  @ApiProperty({ 
    description: '루트부터 현재 카테고리까지의 경로',
    type: [CategoryPathInfoDto]
  })
  path: CategoryPathInfoDto[];

  @ApiProperty({ description: '전체 경로 문자열 (예: /전자제품/컴퓨터/노트북)' })
  fullPath: string;
}

