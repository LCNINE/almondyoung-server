import { ApiProperty } from '@nestjs/swagger';

export class ChannelCategoryDto {
  @ApiProperty({ description: '분류 ID' })
  id: string;

  @ApiProperty({ description: '분류명 (예: 엘나산, 3PL)' })
  name: string;

  @ApiProperty({ description: '분류 설명', nullable: true })
  description: string | null;

  @ApiProperty({ description: '정렬 순서', default: 0 })
  displayOrder: number;

  @ApiProperty({ description: '이 분류에 속한 채널 수', required: false })
  channelCount?: number;

  @ApiProperty({ description: '생성일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '수정일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  updatedAt: string;
}

export class ChannelCategoryListResponseDto {
  @ApiProperty({ description: '분류 목록', type: [ChannelCategoryDto] })
  data: ChannelCategoryDto[];
}
