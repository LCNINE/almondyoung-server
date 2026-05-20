import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommentResponseDto } from './comment-response.dto';

export class ReviewResponseDto {
  @ApiProperty({ description: '리뷰 ID' })
  id: string;

  @ApiProperty({
    description: '사용자 ID',
    nullable: true,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  userId: string | null;

  @ApiProperty({
    description: '상품 ID',
    example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  })
  productId: string;

  @ApiProperty({ description: '평점', minimum: 1, maximum: 5 })
  rating: number;

  @ApiProperty({ description: '리뷰 본문' })
  content: string;

  @ApiProperty({
    description: '레거시 작성자명',
    nullable: true,
    example: '홍길동',
  })
  legacy_author_name: string | null;

  @ApiProperty({ description: '첨부 미디어 파일 ID 목록', type: [String] })
  mediaFileIds: string[];

  @ApiProperty({ description: '도움이 됨 수', example: 5 })
  helpfulCount: number;

  @ApiProperty({ description: '좋아요 수', example: 10 })
  likeCount: number;

  @ApiProperty({ description: '싫어요 수', example: 2 })
  dislikeCount: number;

  @ApiProperty({ description: '상태', example: 'active' })
  status: string;

  @ApiProperty({
    description: '삭제일시 (ISO 8601 형식, 미삭제 시 null)',
    nullable: true,
    example: null,
  })
  deletedAt: string | null;

  @ApiProperty({
    description: '생성일시 (ISO 8601 형식)',
    example: '2025-12-05T10:30:00.000Z',
  })
  createdAt: string;

  @ApiProperty({
    description: '수정일시 (ISO 8601 형식)',
    example: '2025-12-05T10:30:00.000Z',
  })
  updatedAt: string;

  @ApiPropertyOptional({
    description: '관리자 댓글',
    type: CommentResponseDto,
    nullable: true,
  })
  adminComment: CommentResponseDto | null;
}
