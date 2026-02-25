import { ApiProperty } from '@nestjs/swagger';

export class CommentResponseDto {
  @ApiProperty({ description: '댓글 ID' })
  id: string;

  @ApiProperty({ description: '리뷰 ID' })
  reviewId: string;

  @ApiProperty({ description: '관리자 사용자 ID' })
  adminUserId: string;

  @ApiProperty({ description: '댓글 내용' })
  content: string;

  @ApiProperty({ description: '생성일시 (ISO 8601)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '수정일시 (ISO 8601)', example: '2025-12-05T10:30:00.000Z' })
  updatedAt: string;
}
