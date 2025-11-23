import { ApiProperty } from '@nestjs/swagger';
import { TagValueItemDto } from '../../tags/dto';

export class CategoryTagGroupItemDto {
  @ApiProperty({ description: '태그 그룹 ID' })
  id: string;

  @ApiProperty({ description: '태그 그룹 이름' })
  name: string;

  @ApiProperty({ description: '태그 그룹 설명', nullable: true })
  description: string | null;

  @ApiProperty({ description: '표시 순서', minimum: 0 })
  displayOrder: number;

  @ApiProperty({ description: '필수 여부' })
  isRequired: boolean;

  @ApiProperty({ description: '하위 카테고리 적용 여부' })
  appliesToDescendants: boolean;

  @ApiProperty({ description: '상속 여부 (조상 카테고리로부터 상속받은 것인지)' })
  isInherited: boolean;

  @ApiProperty({ 
    description: '상속 출처 카테고리 ID',
    nullable: true,
    required: false
  })
  inheritedFromCategoryId?: string | null;

  @ApiProperty({ 
    description: '상속 출처 카테고리 이름',
    nullable: true,
    required: false
  })
  inheritedFromCategoryName?: string | null;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiProperty({ 
    description: '태그 값 목록', 
    type: [TagValueItemDto] 
  })
  values: TagValueItemDto[];
}

export class CategoryTagGroupsResponseDto {
  @ApiProperty({ description: '카테고리 ID' })
  categoryId: string;

  @ApiProperty({ description: '카테고리 이름' })
  categoryName: string;

  @ApiProperty({ 
    description: '태그 그룹 목록',
    type: [CategoryTagGroupItemDto]
  })
  tagGroups: CategoryTagGroupItemDto[];
}

