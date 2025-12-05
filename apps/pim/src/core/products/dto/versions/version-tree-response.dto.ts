import { ApiProperty } from '@nestjs/swagger';

export class VersionTreeResponseDto {
  @ApiProperty({ description: '버전 ID' })
  id: string;

  @ApiProperty({ description: 'Master ID' })
  masterId: string;

  @ApiProperty({ description: '버전 번호' })
  version: number;

  @ApiProperty({
    description: '버전 상태',
    enum: ['draft', 'inactive', 'active'],
  })
  status: 'draft' | 'inactive' | 'active';

  @ApiProperty({ description: '상품명' })
  name: string;

  @ApiProperty({
    description: '부모 버전 ID',
    required: false,
    nullable: true,
  })
  parentVersionId: string | null;

  @ApiProperty({
    description: '자식 버전들',
    type: [VersionTreeResponseDto],
  })
  children: VersionTreeResponseDto[];

  @ApiProperty({ description: '생성일시' })
  createdAt: string;

  @ApiProperty({ description: '수정일시' })
  updatedAt: string;

  @ApiProperty({
    description: 'Draft 소유자 ID',
    required: false,
    nullable: true,
  })
  draftOwnerId?: string | null;
}

